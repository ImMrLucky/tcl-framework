/**
 * Autonomous runs, JSONL team events, local runner pairing (control plane).
 */

import express from 'express';
import { randomBytes } from 'node:crypto';
import { hashPairingCode } from './runner-auth.js';
import {
  pairLocalRunnerHandler,
  registerLocalRunnerExecutionRoutes,
} from './local-runner-routes.js';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext, type OrgContext } from '../auth-context.js';
import { logAgentStudioAudit } from './audit.js';
import { readPauseGate, blockedByPause } from './pause-gate.js';
import { appendTeamEvent } from './team-events.js';
import { getJarvisAgentId } from './jarvis.js';
import {
  AUTONOMOUS_MIGRATION_FILE,
  isAutonomousSchemaError,
  respondAutonomousDbError,
  respondAutonomousListEmpty,
} from './autonomous-db.js';
import { resolveModelRouting, type DbRoutingRule } from './model-routing.js';

const ANALYST_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']);
const STAFF_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER']);

interface AuthedContext extends OrgContext {
  orgId: string;
}

function dbDown(res: express.Response): boolean {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Database not configured' });
    return true;
  }
  return false;
}

async function ensureContext(req: express.Request, res: express.Response): Promise<AuthedContext | null> {
  const ctx = await getOrgContext(req);
  if (!ctx?.orgId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return { ...ctx, orgId: ctx.orgId };
}

function requireAnalyst(ctx: AuthedContext, res: express.Response): boolean {
  if (!ctx.role || !ANALYST_ROLES.has(ctx.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function requireStaff(ctx: AuthedContext, res: express.Response): boolean {
  if (!ctx.role || !STAFF_ROLES.has(ctx.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function sendAutonomousListError(
  res: express.Response,
  error: { code?: string; message: string },
  emptyPayload: Record<string, unknown>
): void {
  if (respondAutonomousListEmpty(res, error, emptyPayload)) return;
  res.status(500).json({ error: error.message });
}

function sendAutonomousMutationError(
  res: express.Response,
  error: { code?: string; message: string }
): void {
  if (respondAutonomousDbError(res, error)) return;
  res.status(500).json({ error: error.message });
}

const ORCHESTRATE_USE_CASES = new Set([
  'orchestrate',
  'plan',
  'spec',
  'code',
  'review',
  'qa',
  'security',
  'research',
  'summarize',
  'tool_use',
  'context_update',
  'chat',
]);

export function registerAutonomousAgentStudioRoutes(app: express.Application): void {
  app.get('/api/agent-studio/autonomous/health', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('id')
      .eq('org_id', ctx.orgId)
      .limit(1);
    if (error && isAutonomousSchemaError(error)) {
      return res.status(503).json({
        ready: false,
        code: 'MIGRATION_REQUIRED',
        migration: AUTONOMOUS_MIGRATION_FILE,
      });
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ready: true });
  });

  // -------------------------------------------------------------------------
  // Team events (shared JSONL log)
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/teams/:teamId/events', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { teamId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const teamRunId = (req.query.teamRunId as string) || undefined;
    let q = supabaseAdmin!
      .from('agent_studio_team_event_log')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', teamId)
      .order('sequence', { ascending: true })
      .limit(limit);
    if (teamRunId) q = q.eq('team_run_id', teamRunId);
    const { data, error } = await q;
    if (error) {
      sendAutonomousListError(res, error, { events: [] });
      return;
    }
    res.json({ events: data ?? [] });
  });

  app.post('/api/agent-studio/teams/:teamId/events', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const gate = await readPauseGate({ orgId: ctx.orgId, teamId });
    if (blockedByPause(res, gate)) return;

    const {
      teamRunId,
      agentId,
      taskId,
      eventType,
      actorType,
      actorName,
      summary,
      jsonl,
    } = req.body ?? {};
    if (!eventType || !summary) {
      return res.status(400).json({ error: 'eventType and summary are required' });
    }

    const row = await appendTeamEvent({
      supabase: supabaseAdmin!,
      orgId: ctx.orgId,
      teamId,
      teamRunId: teamRunId ?? null,
      agentId: agentId ?? null,
      taskId: taskId ?? null,
      eventType: String(eventType),
      actorType: actorType ?? 'USER',
      actorName: actorName ?? ctx.userId ?? 'user',
      summary: String(summary),
      jsonl: jsonl ?? {},
    });
    if (!row) return res.status(500).json({ error: 'Failed to append event' });
    res.status(201).json({ event: row });
  });

  app.get('/api/agent-studio/team-runs/:runId/events', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { runId } = req.params;
    const { data: run } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('team_id')
      .eq('id', runId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_event_log')
      .select('*')
      .eq('team_run_id', runId)
      .eq('org_id', ctx.orgId)
      .order('sequence', { ascending: true })
      .limit(200);
    if (error) {
      sendAutonomousListError(res, error, { events: [] });
      return;
    }
    res.json({ events: data ?? [] });
  });

  // -------------------------------------------------------------------------
  // Team runs
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/teams/:teamId/runs', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { teamId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      sendAutonomousListError(res, error, { runs: [] });
      return;
    }
    res.json({ runs: data ?? [] });
  });

  app.post('/api/agent-studio/teams/:teamId/runs', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const gate = await readPauseGate({ orgId: ctx.orgId, teamId });
    if (blockedByPause(res, gate)) return;

    const {
      name,
      objective,
      runMode,
      maxSteps,
      localRunnerId,
      useJarvis = true,
      metadata,
    } = req.body ?? {};
    if (!objective?.trim()) {
      return res.status(400).json({ error: 'objective is required' });
    }

    let orchestratorAgentId: string | null = null;
    if (useJarvis !== false) {
      orchestratorAgentId = await getJarvisAgentId(supabaseAdmin!, ctx.orgId, teamId);
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .insert({
        org_id: ctx.orgId,
        team_id: teamId,
        name: name ?? 'Team Run',
        objective: objective.trim(),
        run_mode: runMode ?? 'RUN_UNTIL_BLOCKED',
        status: 'QUEUED',
        orchestrator_agent_id: orchestratorAgentId,
        max_steps: maxSteps ?? 25,
        local_runner_id: localRunnerId ?? null,
        created_by: ctx.userId ?? null,
        metadata: {
          executionMode: 'LOCAL_RUNNER_DEFAULT',
          ...(metadata ?? {}),
        },
      })
      .select('*')
      .single();
    if (error) {
      sendAutonomousMutationError(res, error);
      return;
    }

    await appendTeamEvent({
      supabase: supabaseAdmin!,
      orgId: ctx.orgId,
      teamId,
      teamRunId: data.id,
      eventType: 'team_run.created',
      actorType: 'USER',
      actorName: 'user',
      summary: `Team run queued: ${objective.trim().slice(0, 120)}`,
      jsonl: { runId: data.id, runMode: data.run_mode },
    });

    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      actorUserId: ctx.userId,
      eventType: 'team_run.create',
      resourceType: 'agent_studio_team_runs',
      resourceId: data.id,
      payload: { objective, runMode: data.run_mode },
    });

    res.status(201).json({ run: data });
  });

  app.get('/api/agent-studio/team-runs/:runId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { runId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('*')
      .eq('id', runId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (error) {
      sendAutonomousMutationError(res, error);
      return;
    }
    if (!data) return res.status(404).json({ error: 'Run not found' });

    const { data: steps } = await supabaseAdmin!
      .from('agent_studio_agent_run_steps')
      .select('*')
      .eq('team_run_id', runId)
      .order('step_index', { ascending: true });

    const { data: agentRuns } = await supabaseAdmin!
      .from('agent_studio_agent_runs')
      .select('*')
      .eq('team_run_id', runId)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({ run: data, steps: steps ?? [], agentRuns: agentRuns ?? [] });
  });

  async function mutateRunStatus(
    runId: string,
    ctx: AuthedContext,
    res: express.Response,
    status: string,
    eventType: string
  ): Promise<void> {
    const { data: run } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('team_id, status')
      .eq('id', runId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const gate = await readPauseGate({ orgId: ctx.orgId, teamId: run.team_id });
    if (status === 'RUNNING' && blockedByPause(res, gate)) return;

    const patch: Record<string, unknown> = { status };
    if (status === 'RUNNING') patch.started_at = new Date().toISOString();
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status)) {
      patch.finished_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .update(patch)
      .eq('id', runId)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await appendTeamEvent({
      supabase: supabaseAdmin!,
      orgId: ctx.orgId,
      teamId: run.team_id,
      teamRunId: runId,
      eventType,
      actorType: 'USER',
      summary: `Team run ${status.toLowerCase()}`,
      jsonl: { runId, previousStatus: run.status },
    });

    res.json({ run: data });
  }

  app.post('/api/agent-studio/team-runs/:runId/pause', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    await mutateRunStatus(req.params.runId, ctx, res, 'PAUSED', 'team_run.paused');
  });

  app.post('/api/agent-studio/team-runs/:runId/resume', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    await mutateRunStatus(req.params.runId, ctx, res, 'RUNNING', 'team_run.resumed');
  });

  app.post('/api/agent-studio/team-runs/:runId/cancel', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    await mutateRunStatus(req.params.runId, ctx, res, 'CANCELLED', 'team_run.cancelled');
  });

  app.post('/api/agent-studio/team-runs/:runId/step', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { runId } = req.params;
    const { data: run } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('*')
      .eq('id', runId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const gate = await readPauseGate({ orgId: ctx.orgId, teamId: run.team_id });
    if (blockedByPause(res, gate)) return;

    const stepIndex = (run.completed_steps as number) + 1;
    const { data: step, error: stepErr } = await supabaseAdmin!
      .from('agent_studio_agent_run_steps')
      .insert({
        org_id: ctx.orgId,
        team_run_id: runId,
        team_id: run.team_id,
        step_index: stepIndex,
        step_type: 'ORCHESTRATION_TICK',
        label: 'Manual step — awaiting local runner',
        status: 'PENDING',
        input: req.body ?? {},
      })
      .select('*')
      .single();
    if (stepErr) return res.status(500).json({ error: stepErr.message });

    const { data: updated, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .update({
        status: run.status === 'QUEUED' ? 'RUNNING' : run.status,
        completed_steps: stepIndex,
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .select('*')
      .single();
    if (error) {
      sendAutonomousMutationError(res, error);
      return;
    }

    await appendTeamEvent({
      supabase: supabaseAdmin!,
      orgId: ctx.orgId,
      teamId: run.team_id,
      teamRunId: runId,
      eventType: 'team_run.step',
      actorType: 'USER',
      summary: `Manual orchestration step ${stepIndex} queued for local runner`,
      jsonl: { stepId: step.id },
    });

    res.json({ run: updated, step });
  });

  // -------------------------------------------------------------------------
  // Agent private context
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/teams/:teamId/agent-contexts', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_private_context')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', req.params.teamId);
    if (error) {
      sendAutonomousListError(res, error, { contexts: [] });
      return;
    }
    res.json({ contexts: data ?? [] });
  });

  // -------------------------------------------------------------------------
  // Local runners
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/local-runners', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_local_runners')
      .select('*')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false });
    if (error) {
      sendAutonomousListError(res, error, { runners: [] });
      return;
    }
    res.json({ runners: data ?? [] });
  });

  app.post('/api/agent-studio/local-runners/pairing-code', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const code = randomBytes(4).toString('hex').toUpperCase();
    const hash = hashPairingCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const name = req.body?.name ?? 'Local Runner';
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_local_runners')
      .insert({
        org_id: ctx.orgId,
        name,
        device_label: req.body?.deviceLabel ?? null,
        pairing_code_hash: hash,
        pairing_expires_at: expiresAt,
        status: 'NEW',
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) {
      sendAutonomousMutationError(res, error);
      return;
    }
    res.status(201).json({
      runner: data,
      pairingCode: code,
      expiresInSeconds: 600,
    });
  });

  app.post('/api/agent-studio/local-runners/pair', (req, res) => {
    void pairLocalRunnerHandler(req, res);
  });

  app.post('/api/agent-studio/local-runners/:runnerId/revoke', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_local_runners')
      .update({
        status: 'REVOKED',
        runner_auth_token_hash: null,
        runner_session_token_hash: null,
        pairing_code_hash: null,
      })
      .eq('id', req.params.runnerId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Runner not found' });
    res.json({ runner: data });
  });

  // -------------------------------------------------------------------------
  // Local vendor refs (metadata only)
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/local-vendors', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    let q = supabaseAdmin!
      .from('agent_studio_local_vendor_refs')
      .select('*')
      .eq('org_id', ctx.orgId);
    const runnerId = req.query.runnerId as string | undefined;
    if (runnerId) q = q.eq('local_runner_id', runnerId);
    const { data, error } = await q.order('provider', { ascending: true });
    if (error) {
      sendAutonomousListError(res, error, { vendors: [] });
      return;
    }
    res.json({ vendors: data ?? [] });
  });

  app.post('/api/agent-studio/local-vendors/register', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { localRunnerId, provider, label, localKeyRef, keyPreview, supportedModels, capabilities } =
      req.body ?? {};
    if (!provider || !label || !localKeyRef) {
      return res.status(400).json({ error: 'provider, label, localKeyRef required' });
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_local_vendor_refs')
      .upsert(
        {
          org_id: ctx.orgId,
          local_runner_id: localRunnerId ?? null,
          provider,
          label,
          local_key_ref: localKeyRef,
          key_preview: keyPreview ?? null,
          status: 'READY',
          supported_models: supportedModels ?? [],
          capabilities: capabilities ?? {},
        },
        { onConflict: 'org_id,local_runner_id,provider,label' }
      )
      .select('*')
      .single();
    if (error) {
      sendAutonomousMutationError(res, error);
      return;
    }
    res.status(201).json({ vendor: data });
  });

  app.delete('/api/agent-studio/local-vendors/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { error } = await supabaseAdmin!
      .from('agent_studio_local_vendor_refs')
      .delete()
      .eq('id', req.params.id)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).end();
  });

  registerLocalRunnerExecutionRoutes(app);

  // -------------------------------------------------------------------------
  // Model routing preview
  // -------------------------------------------------------------------------
  app.post('/api/agent-studio/model-routing/preview', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { teamId, agentId, useCase, executionMode } = req.body ?? {};
    if (!teamId || !useCase) {
      return res.status(400).json({ error: 'teamId and useCase are required' });
    }
    const uc = String(useCase);
    if (!ORCHESTRATE_USE_CASES.has(uc)) {
      return res.status(400).json({ error: 'Invalid useCase' });
    }

    const mode = executionMode ?? 'LOCAL_RUNNER_DEFAULT';
    const keyMode =
      mode === 'CLOUD_ENCRYPTED_OPTIONAL' ? 'CLOUD_ENCRYPTED' : 'LOCAL_COMPANION_VAULT';

    const { data: rules } = await supabaseAdmin!
      .from('agent_studio_model_routing')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('is_active', true);

    const resolved = resolveModelRouting((rules ?? []) as DbRoutingRule[], {
      orgId: ctx.orgId,
      teamId: String(teamId),
      agentId: agentId ? String(agentId) : '',
      useCase: uc,
    });

    res.json({
      provider: resolved.provider,
      model: resolved.model,
      source: resolved.source,
      providerKeyId: resolved.providerKeyId,
      keyMode,
      executionMode: mode,
      reason:
        keyMode === 'LOCAL_COMPANION_VAULT'
          ? 'Default: inference runs on your local Agent Runner with keys in the local vault.'
          : 'Optional cloud mode uses encrypted BYOK keys on the server.',
    });
  });
}
