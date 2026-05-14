/**
 * Agent Studio — Express routes (MVP).
 *
 * All routes are mounted under `/api/agent-studio/*`. They:
 *   - Reuse `getOrgContext` (same Org / Project / RBAC as the rest of TCL).
 *   - Available to any authenticated org member (RBAC still applies per route).
 *   - Honour pause state (org / team / agent) — paused entities can still be
 *     read but cannot be acted on (`POST` / mutating verbs return 423 Locked).
 *   - Write to `agent_studio_audit_logs` (the dedicated Agent Studio audit
 *     pipeline — separate from the platform `audit_logs`).
 *
 * BYOK provider keys + integration credentials are encrypted at rest via
 * `crypto.ts` (AES-256-GCM, AGENT_STUDIO_ENC_KEY). Plaintext is never stored
 * and never returned over the wire — only redacted previews.
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext, type OrgContext } from '../auth-context.js';
import { encryptString, decryptString, redact, type EncryptedBlob } from './crypto.js';
import { logAgentStudioAudit } from './audit.js';
import { loadRoleTemplates, loadWorkflowTemplates } from './templates.js';
import { bufFromDb, bufToDb } from './bytea.js';
import { readPauseGate, type PauseGateState } from './pause-gate.js';
import { handleAgentStudioDispatch } from './dispatch.js';
import { handleIntegrationPing } from './integration-ping.js';

const STAFF_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER']);
const ANALYST_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']);

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

interface AuthedContext extends OrgContext {
  orgId: string;
}

async function ensureContext(
  req: express.Request,
  res: express.Response
): Promise<AuthedContext | null> {
  const ctx = await getOrgContext(req);
  if (!ctx || (ctx as any).error || !ctx.orgId) {
    res.status(401).json({ error: (ctx as any)?.error || 'Authorization required' });
    return null;
  }
  return ctx as AuthedContext;
}

function requireStaff(ctx: AuthedContext, res: express.Response): boolean {
  if (!ctx.role || !STAFF_ROLES.has(ctx.role)) {
    res.status(403).json({ error: 'INSUFFICIENT_ROLE', requires: 'OWNER, ADMIN, or MANAGER' });
    return false;
  }
  return true;
}

function requireAnalyst(ctx: AuthedContext, res: express.Response): boolean {
  if (!ctx.role || !ANALYST_ROLES.has(ctx.role)) {
    res.status(403).json({ error: 'INSUFFICIENT_ROLE', requires: 'OWNER, ADMIN, MANAGER, or ANALYST' });
    return false;
  }
  return true;
}

function requireOwnerOrAdmin(ctx: AuthedContext, res: express.Response): boolean {
  if (!ctx.role || !['OWNER', 'ADMIN'].includes(ctx.role)) {
    res.status(403).json({ error: 'INSUFFICIENT_ROLE', requires: 'OWNER or ADMIN' });
    return false;
  }
  return true;
}

function dbDown(res: express.Response): boolean {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Supabase not configured' });
    return true;
  }
  return false;
}

/** Make sure agent_studio_orgs row exists for this org so pause / settings can be set. */
async function ensureOrgRow(orgId: string): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin.rpc('agent_studio_ensure_org_row', { p_org_id: orgId });
}

function blockedByPause(res: express.Response, gate: PauseGateState): boolean {
  if (gate.orgPaused || gate.teamPaused || gate.agentPaused) {
    res.status(423).json({
      error: 'PAUSED',
      message: gate.orgPaused
        ? 'Organization-level pause is active.'
        : gate.teamPaused
        ? 'Team is paused.'
        : 'Agent is paused.',
      reasons: gate.reasons,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Route registration.
// ---------------------------------------------------------------------------

export function setupAgentStudioRoutes(app: express.Application): void {
  // ========================================================================
  // Org-level settings + global pause.
  // ========================================================================

  app.get('/api/agent-studio/settings', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    await ensureOrgRow(ctx.orgId);
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_orgs')
      .select('*')
      .eq('org_id', ctx.orgId)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ settings: data });
  });

  app.patch('/api/agent-studio/settings', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireOwnerOrAdmin(ctx, res) || dbDown(res)) return;
    await ensureOrgRow(ctx.orgId);
    const allowed: Record<string, unknown> = {};
    if (req.body?.defaultModel !== undefined) allowed.default_model = req.body.defaultModel;
    if (req.body?.settings !== undefined) allowed.settings = req.body.settings;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_orgs')
      .update(allowed)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'settings.update',
      resourceType: 'agent_studio_orgs',
      resourceId: ctx.orgId,
      payload: allowed,
    });
    res.json({ settings: data });
  });

  // Global pause / resume.
  app.post('/api/agent-studio/pause', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireOwnerOrAdmin(ctx, res) || dbDown(res)) return;
    await ensureOrgRow(ctx.orgId);
    const reason = (req.body?.reason as string | undefined) ?? null;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_orgs')
      .update({ paused_at: new Date().toISOString(), paused_by: ctx.userId ?? null, pause_reason: reason })
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'org.pause',
      resourceType: 'agent_studio_orgs',
      resourceId: ctx.orgId,
      payload: { reason },
    });
    res.json({ settings: data });
  });

  app.post('/api/agent-studio/resume', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireOwnerOrAdmin(ctx, res) || dbDown(res)) return;
    await ensureOrgRow(ctx.orgId);
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_orgs')
      .update({ paused_at: null, paused_by: null, pause_reason: null })
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'org.resume',
      resourceType: 'agent_studio_orgs',
      resourceId: ctx.orgId,
    });
    res.json({ settings: data });
  });

  // ========================================================================
  // Templates (read-only, served from packages/agent-core/templates).
  // Public GETs: no org/session required — payload is identical for all orgs
  // and does not leak tenant data. Avoids 401 when callers omit auth (e.g.
  // prefetch, tools, or stale client timing).
  // ========================================================================

  app.get('/api/agent-studio/templates/roles', (_req, res) => {
    res.json({ templates: loadRoleTemplates() });
  });

  app.get('/api/agent-studio/templates/workflows', (_req, res) => {
    res.json({ templates: loadWorkflowTemplates() });
  });

  // ========================================================================
  // Teams.
  // ========================================================================

  app.get('/api/agent-studio/teams', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_teams')
      .select('*')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ teams: data ?? [] });
  });

  app.post('/api/agent-studio/teams', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { name, description, projectId, workflowTemplateKey } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_teams')
      .insert({
        org_id: ctx.orgId,
        project_id: projectId ?? null,
        name,
        description: description ?? null,
        workflow_template_key: workflowTemplateKey ?? null,
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Auto-create a default board for this team.
    const { data: board } = await supabaseAdmin!
      .from('agent_studio_boards')
      .insert({ org_id: ctx.orgId, team_id: data.id })
      .select('*')
      .single();

    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.id,
      actorUserId: ctx.userId,
      eventType: 'team.create',
      resourceType: 'agent_studio_teams',
      resourceId: data.id,
      payload: { name, workflowTemplateKey },
    });

    res.status(201).json({ team: data, board });
  });

  app.get('/api/agent-studio/teams/:teamId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { teamId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_teams')
      .select('*')
      .eq('id', teamId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Team not found' });
    res.json({ team: data });
  });

  app.patch('/api/agent-studio/teams/:teamId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const allowed: Record<string, unknown> = {};
    if (req.body?.name !== undefined) allowed.name = req.body.name;
    if (req.body?.description !== undefined) allowed.description = req.body.description;
    if (req.body?.workflowTemplateKey !== undefined) allowed.workflow_template_key = req.body.workflowTemplateKey;
    if (req.body?.projectId !== undefined) allowed.project_id = req.body.projectId;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_teams')
      .update(allowed)
      .eq('id', teamId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      actorUserId: ctx.userId,
      eventType: 'team.update',
      resourceType: 'agent_studio_teams',
      resourceId: teamId,
      payload: allowed,
    });
    res.json({ team: data });
  });

  app.delete('/api/agent-studio/teams/:teamId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const { error } = await supabaseAdmin!
      .from('agent_studio_teams')
      .delete()
      .eq('id', teamId)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      actorUserId: ctx.userId,
      eventType: 'team.delete',
      resourceType: 'agent_studio_teams',
      resourceId: teamId,
    });
    res.status(204).end();
  });

  // Team pause / resume.
  app.post('/api/agent-studio/teams/:teamId/pause', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const reason = (req.body?.reason as string | undefined) ?? null;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_teams')
      .update({ paused_at: new Date().toISOString(), paused_by: ctx.userId ?? null, pause_reason: reason })
      .eq('id', teamId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      actorUserId: ctx.userId,
      eventType: 'team.pause',
      resourceType: 'agent_studio_teams',
      resourceId: teamId,
      payload: { reason },
    });
    res.json({ team: data });
  });

  app.post('/api/agent-studio/teams/:teamId/resume', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_teams')
      .update({ paused_at: null, paused_by: null, pause_reason: null })
      .eq('id', teamId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      actorUserId: ctx.userId,
      eventType: 'team.resume',
      resourceType: 'agent_studio_teams',
      resourceId: teamId,
    });
    res.json({ team: data });
  });

  // ========================================================================
  // Agents.
  // ========================================================================

  app.get('/api/agent-studio/teams/:teamId/agents', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { teamId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agents')
      .select('*')
      .eq('team_id', teamId)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ agents: data ?? [] });
  });

  app.post('/api/agent-studio/teams/:teamId/agents', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const {
      name,
      roleTemplateKey,
      isOrchestrator,
      persona,
      theme,
      capabilities,
      tools,
    } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agents')
      .insert({
        org_id: ctx.orgId,
        team_id: teamId,
        name,
        role_template_key: roleTemplateKey ?? null,
        is_orchestrator: !!isOrchestrator,
        persona: persona ?? null,
        theme: theme ?? {},
        capabilities: capabilities ?? [],
        tools: tools ?? [],
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      agentId: data.id,
      actorUserId: ctx.userId,
      eventType: 'agent.create',
      resourceType: 'agent_studio_agents',
      resourceId: data.id,
      payload: { name, roleTemplateKey, isOrchestrator: !!isOrchestrator },
    });
    res.status(201).json({ agent: data });
  });

  app.get('/api/agent-studio/agents/:agentId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { agentId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agents')
      .select('*')
      .eq('id', agentId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent: data });
  });

  app.patch('/api/agent-studio/agents/:agentId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { agentId } = req.params;
    const allowed: Record<string, unknown> = {};
    const map: Record<string, string> = {
      name: 'name',
      persona: 'persona',
      theme: 'theme',
      capabilities: 'capabilities',
      tools: 'tools',
      status: 'status',
      roleTemplateKey: 'role_template_key',
      isOrchestrator: 'is_orchestrator',
    };
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] !== undefined) allowed[col] = req.body[k];
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agents')
      .update(allowed)
      .eq('id', agentId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      agentId,
      actorUserId: ctx.userId,
      eventType: 'agent.update',
      resourceType: 'agent_studio_agents',
      resourceId: agentId,
      payload: allowed,
    });
    res.json({ agent: data });
  });

  app.delete('/api/agent-studio/agents/:agentId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { agentId } = req.params;
    const { data: existing } = await supabaseAdmin!
      .from('agent_studio_agents')
      .select('team_id')
      .eq('id', agentId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    const { error } = await supabaseAdmin!
      .from('agent_studio_agents')
      .delete()
      .eq('id', agentId)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: existing?.team_id ?? null,
      agentId,
      actorUserId: ctx.userId,
      eventType: 'agent.delete',
      resourceType: 'agent_studio_agents',
      resourceId: agentId,
    });
    res.status(204).end();
  });

  app.post('/api/agent-studio/agents/:agentId/pause', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { agentId } = req.params;
    const reason = (req.body?.reason as string | undefined) ?? null;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agents')
      .update({
        paused_at: new Date().toISOString(),
        paused_by: ctx.userId ?? null,
        pause_reason: reason,
        status: 'PAUSED',
      })
      .eq('id', agentId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      agentId,
      actorUserId: ctx.userId,
      eventType: 'agent.pause',
      resourceType: 'agent_studio_agents',
      resourceId: agentId,
      payload: { reason },
    });
    res.json({ agent: data });
  });

  app.post('/api/agent-studio/agents/:agentId/resume', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { agentId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agents')
      .update({
        paused_at: null,
        paused_by: null,
        pause_reason: null,
        status: 'IDLE',
      })
      .eq('id', agentId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      agentId,
      actorUserId: ctx.userId,
      eventType: 'agent.resume',
      resourceType: 'agent_studio_agents',
      resourceId: agentId,
    });
    res.json({ agent: data });
  });

  // ========================================================================
  // Agent configs (versioned).
  // ========================================================================

  app.get('/api/agent-studio/agents/:agentId/configs', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { agentId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_configs')
      .select('*')
      .eq('agent_id', agentId)
      .eq('org_id', ctx.orgId)
      .order('version', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ configs: data ?? [] });
  });

  app.post('/api/agent-studio/agents/:agentId/configs', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { agentId } = req.params;
    const { config, notes } = req.body ?? {};
    if (typeof config !== 'object' || config === null) {
      return res.status(400).json({ error: 'config (object) is required' });
    }

    // Determine next version + deactivate prior active.
    const { data: latest } = await supabaseAdmin!
      .from('agent_studio_agent_configs')
      .select('version')
      .eq('agent_id', agentId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (latest?.version ?? 0) + 1;

    await supabaseAdmin!
      .from('agent_studio_agent_configs')
      .update({ is_active: false })
      .eq('agent_id', agentId)
      .eq('is_active', true);

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_configs')
      .insert({
        org_id: ctx.orgId,
        agent_id: agentId,
        version: nextVersion,
        config,
        notes: notes ?? null,
        is_active: true,
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logAgentStudioAudit({
      orgId: ctx.orgId,
      agentId,
      actorUserId: ctx.userId,
      eventType: 'agent_config.publish',
      resourceType: 'agent_studio_agent_configs',
      resourceId: data.id,
      payload: { version: nextVersion },
    });

    res.status(201).json({ config: data });
  });

  // ========================================================================
  // Boards + tasks.
  // ========================================================================

  app.get('/api/agent-studio/teams/:teamId/board', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { teamId } = req.params;
    const { data: board } = await supabaseAdmin!
      .from('agent_studio_boards')
      .select('*')
      .eq('team_id', teamId)
      .eq('org_id', ctx.orgId)
      .eq('is_default', true)
      .maybeSingle();
    if (!board) return res.status(404).json({ error: 'Board not found' });

    const { data: tasks, error: tasksError } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .select('*')
      .eq('board_id', board.id)
      .eq('org_id', ctx.orgId)
      .order('column_key', { ascending: true })
      .order('position', { ascending: true });
    if (tasksError) return res.status(500).json({ error: tasksError.message });

    res.json({ board, tasks: tasks ?? [] });
  });

  app.post('/api/agent-studio/teams/:teamId/tasks', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { teamId } = req.params;
    const gate = await readPauseGate({ orgId: ctx.orgId, teamId });
    if (blockedByPause(res, gate)) return;

    const {
      title,
      description,
      columnKey,
      taskType,
      priority,
      assignedAgentId,
      externalRef,
      metadata,
    } = req.body ?? {};
    if (!title) return res.status(400).json({ error: 'title is required' });

    const { data: board } = await supabaseAdmin!
      .from('agent_studio_boards')
      .select('id')
      .eq('team_id', teamId)
      .eq('org_id', ctx.orgId)
      .eq('is_default', true)
      .maybeSingle();
    if (!board) return res.status(404).json({ error: 'Default board missing for team' });

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .insert({
        org_id: ctx.orgId,
        team_id: teamId,
        board_id: board.id,
        column_key: columnKey ?? 'backlog',
        title,
        description: description ?? null,
        task_type: taskType ?? 'STORY',
        priority: priority ?? 'MEDIUM',
        assigned_agent_id: assignedAgentId ?? null,
        external_ref: externalRef ?? {},
        metadata: metadata ?? {},
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      taskId: data.id,
      actorUserId: ctx.userId,
      eventType: 'task.create',
      resourceType: 'agent_studio_tasks',
      resourceId: data.id,
      payload: { title, columnKey: data.column_key },
    });

    res.status(201).json({ task: data });
  });

  app.patch('/api/agent-studio/tasks/:taskId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { taskId } = req.params;

    const { data: existing } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .select('team_id, assigned_agent_id')
      .eq('id', taskId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const gate = await readPauseGate({
      orgId: ctx.orgId,
      teamId: existing.team_id,
      agentId: existing.assigned_agent_id,
    });
    if (blockedByPause(res, gate)) return;

    const allowed: Record<string, unknown> = {};
    const map: Record<string, string> = {
      title: 'title',
      description: 'description',
      columnKey: 'column_key',
      position: 'position',
      taskType: 'task_type',
      priority: 'priority',
      status: 'status',
      assignedAgentId: 'assigned_agent_id',
      externalRef: 'external_ref',
      metadata: 'metadata',
    };
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] !== undefined) allowed[col] = req.body[k];
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .update(allowed)
      .eq('id', taskId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      taskId,
      agentId: data.assigned_agent_id,
      actorUserId: ctx.userId,
      eventType: 'task.update',
      resourceType: 'agent_studio_tasks',
      resourceId: taskId,
      payload: allowed,
    });

    res.json({ task: data });
  });

  app.delete('/api/agent-studio/tasks/:taskId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { taskId } = req.params;
    const { data: existing } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .select('team_id')
      .eq('id', taskId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    const { error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .delete()
      .eq('id', taskId)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: existing?.team_id ?? null,
      taskId,
      actorUserId: ctx.userId,
      eventType: 'task.delete',
      resourceType: 'agent_studio_tasks',
      resourceId: taskId,
    });
    res.status(204).end();
  });

  // ========================================================================
  // Review gates.
  // ========================================================================

  app.get('/api/agent-studio/tasks/:taskId/review-gates', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { taskId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_review_gates')
      .select('*')
      .eq('task_id', taskId)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ gates: data ?? [] });
  });

  app.post('/api/agent-studio/tasks/:taskId/review-gates', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { taskId } = req.params;
    const { gateType, requiredRole, metadata } = req.body ?? {};
    if (!gateType) return res.status(400).json({ error: 'gateType is required' });
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_review_gates')
      .insert({
        org_id: ctx.orgId,
        task_id: taskId,
        gate_type: gateType,
        required_role: requiredRole ?? null,
        metadata: metadata ?? {},
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      taskId,
      actorUserId: ctx.userId,
      eventType: 'review_gate.create',
      resourceType: 'agent_studio_review_gates',
      resourceId: data.id,
      payload: { gateType, requiredRole },
    });
    res.status(201).json({ gate: data });
  });

  app.post('/api/agent-studio/review-gates/:gateId/decision', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { gateId } = req.params;
    const { status, comment } = req.body ?? {};
    if (!status || !['APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'SKIPPED'].includes(status)) {
      return res.status(400).json({ error: 'status must be APPROVED|CHANGES_REQUESTED|REJECTED|SKIPPED' });
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_review_gates')
      .update({
        status,
        comment: comment ?? null,
        decided_by: ctx.userId ?? null,
        decided_at: new Date().toISOString(),
      })
      .eq('id', gateId)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      taskId: data.task_id,
      actorUserId: ctx.userId,
      eventType: 'review_gate.decide',
      resourceType: 'agent_studio_review_gates',
      resourceId: gateId,
      payload: { status, comment },
    });
    res.json({ gate: data });
  });

  // ========================================================================
  // Contexts (team + agent).
  // ========================================================================

  app.get('/api/agent-studio/contexts', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    let query = supabaseAdmin!.from('agent_studio_contexts').select('*').eq('org_id', ctx.orgId);
    const teamId = (req.query.teamId as string) || undefined;
    const agentId = (req.query.agentId as string) || undefined;
    const scope = (req.query.scope as 'TEAM' | 'AGENT') || undefined;
    if (teamId) query = query.eq('team_id', teamId);
    if (agentId) query = query.eq('agent_id', agentId);
    if (scope) query = query.eq('scope', scope);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ entries: data ?? [] });
  });

  app.post('/api/agent-studio/contexts', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { scope, teamId, agentId, key, content, data: payloadData, pinned, source } = req.body ?? {};
    if (!scope || !key) return res.status(400).json({ error: 'scope and key are required' });
    if (scope === 'TEAM' && !teamId) return res.status(400).json({ error: 'teamId required for scope=TEAM' });
    if (scope === 'AGENT' && !agentId) return res.status(400).json({ error: 'agentId required for scope=AGENT' });
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_contexts')
      .insert({
        org_id: ctx.orgId,
        scope,
        team_id: scope === 'TEAM' ? teamId : null,
        agent_id: scope === 'AGENT' ? agentId : null,
        key,
        content: content ?? null,
        data: payloadData ?? {},
        pinned: !!pinned,
        source: source ?? 'manual',
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      agentId: data.agent_id,
      actorUserId: ctx.userId,
      eventType: 'context.create',
      resourceType: 'agent_studio_contexts',
      resourceId: data.id,
      payload: { key, scope },
    });
    res.status(201).json({ entry: data });
  });

  app.patch('/api/agent-studio/contexts/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const allowed: Record<string, unknown> = {};
    if (req.body?.content !== undefined) allowed.content = req.body.content;
    if (req.body?.data !== undefined) allowed.data = req.body.data;
    if (req.body?.pinned !== undefined) allowed.pinned = !!req.body.pinned;
    if (req.body?.key !== undefined) allowed.key = req.body.key;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_contexts')
      .update(allowed)
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      agentId: data.agent_id,
      actorUserId: ctx.userId,
      eventType: 'context.update',
      resourceType: 'agent_studio_contexts',
      resourceId: id,
    });
    res.json({ entry: data });
  });

  app.delete('/api/agent-studio/contexts/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const { error } = await supabaseAdmin!
      .from('agent_studio_contexts')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'context.delete',
      resourceType: 'agent_studio_contexts',
      resourceId: id,
    });
    res.status(204).end();
  });

  // ========================================================================
  // Mistake / rule registry.
  // ========================================================================

  app.get('/api/agent-studio/mistakes', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    let q = supabaseAdmin!.from('agent_studio_mistakes').select('*').eq('org_id', ctx.orgId);
    const teamId = (req.query.teamId as string) || undefined;
    const agentId = (req.query.agentId as string) || undefined;
    if (teamId) q = q.eq('team_id', teamId);
    if (agentId) q = q.eq('agent_id', agentId);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ mistakes: data ?? [] });
  });

  app.post('/api/agent-studio/mistakes', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { teamId, agentId, scope, title, description, rule, severity, sourceTaskId } = req.body ?? {};
    if (!teamId || !scope || !title || !rule) {
      return res.status(400).json({ error: 'teamId, scope, title, rule are required' });
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_mistakes')
      .insert({
        org_id: ctx.orgId,
        team_id: teamId,
        agent_id: agentId ?? null,
        scope,
        title,
        description: description ?? null,
        rule,
        severity: severity ?? 'MEDIUM',
        source_task_id: sourceTaskId ?? null,
        created_by: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      agentId: agentId ?? null,
      actorUserId: ctx.userId,
      eventType: 'mistake.create',
      resourceType: 'agent_studio_mistakes',
      resourceId: data.id,
      payload: { title, scope, severity },
    });
    res.status(201).json({ mistake: data });
  });

  app.patch('/api/agent-studio/mistakes/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const allowed: Record<string, unknown> = {};
    if (req.body?.title !== undefined) allowed.title = req.body.title;
    if (req.body?.description !== undefined) allowed.description = req.body.description;
    if (req.body?.rule !== undefined) allowed.rule = req.body.rule;
    if (req.body?.severity !== undefined) allowed.severity = req.body.severity;
    if (req.body?.isActive !== undefined) allowed.is_active = !!req.body.isActive;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_mistakes')
      .update(allowed)
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      agentId: data.agent_id,
      actorUserId: ctx.userId,
      eventType: 'mistake.update',
      resourceType: 'agent_studio_mistakes',
      resourceId: id,
    });
    res.json({ mistake: data });
  });

  // ========================================================================
  // BYOK provider keys (encrypted at rest).
  // ========================================================================

  app.get('/api/agent-studio/provider-keys', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_provider_keys')
      .select('id, org_id, team_id, provider, label, key_alg, key_version, metadata, is_active, last_used_at, created_at, updated_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ keys: data ?? [] });
  });

  app.post('/api/agent-studio/provider-keys', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireOwnerOrAdmin(ctx, res) || dbDown(res)) return;
    const { provider, label, secret, teamId, metadata } = req.body ?? {};
    if (!provider || !label || !secret) {
      return res.status(400).json({ error: 'provider, label, and secret are required' });
    }

    let blob: EncryptedBlob;
    try {
      blob = encryptString(secret);
    } catch (err: any) {
      return res.status(500).json({ error: 'ENCRYPTION_FAILED', message: err?.message });
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_provider_keys')
      .insert({
        org_id: ctx.orgId,
        team_id: teamId ?? null,
        provider,
        label,
        key_ciphertext: bufToDb(blob.ciphertext),
        key_iv: bufToDb(blob.iv),
        key_tag: bufToDb(blob.tag),
        key_alg: blob.alg,
        key_version: blob.version,
        metadata: metadata ?? {},
        created_by: ctx.userId ?? null,
      })
      .select('id, org_id, team_id, provider, label, key_alg, key_version, metadata, is_active, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: teamId ?? null,
      actorUserId: ctx.userId,
      eventType: 'provider_key.create',
      resourceType: 'agent_studio_provider_keys',
      resourceId: data.id,
      payload: { provider, label, redactedSecret: redact(secret) },
    });

    res.status(201).json({ key: data });
  });

  app.delete('/api/agent-studio/provider-keys/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireOwnerOrAdmin(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const { error } = await supabaseAdmin!
      .from('agent_studio_provider_keys')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'provider_key.delete',
      resourceType: 'agent_studio_provider_keys',
      resourceId: id,
    });
    res.status(204).end();
  });

  /**
   * Reveal endpoint — returns a redacted preview only. The full plaintext is
   * never sent over the wire; only the orchestrator gateway uses
   * `decryptString` server-side when actually calling a model.
   */
  app.get('/api/agent-studio/provider-keys/:id/reveal', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireOwnerOrAdmin(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_provider_keys')
      .select('id, key_ciphertext, key_iv, key_tag, key_alg, provider, label, metadata')
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Key not found' });
    let preview = '';
    try {
      const plaintext = decryptString({
        ciphertext: bufFromDb(data.key_ciphertext),
        iv: bufFromDb(data.key_iv),
        tag: bufFromDb(data.key_tag),
        alg: data.key_alg,
      });
      preview = redact(plaintext);
    } catch (err: any) {
      return res.status(500).json({ error: 'DECRYPTION_FAILED', message: err?.message });
    }
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'provider_key.reveal',
      resourceType: 'agent_studio_provider_keys',
      resourceId: id,
    });
    res.json({
      id: data.id,
      provider: data.provider,
      label: data.label,
      preview,
      metadata: data.metadata,
    });
  });

  // ========================================================================
  // Model routing.
  // ========================================================================

  app.get('/api/agent-studio/model-routing', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_model_routing')
      .select('*')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ rules: data ?? [] });
  });

  app.post('/api/agent-studio/model-routing', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { scope, teamId, agentId, useCase, provider, model, providerKeyId, fallback, params } =
      req.body ?? {};
    if (!scope || !useCase || !provider || !model) {
      return res.status(400).json({ error: 'scope, useCase, provider, model are required' });
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_model_routing')
      .insert({
        org_id: ctx.orgId,
        team_id: scope === 'ORG' ? null : teamId ?? null,
        agent_id: scope === 'AGENT' ? agentId ?? null : null,
        scope,
        use_case: useCase,
        provider,
        model,
        provider_key_id: providerKeyId ?? null,
        fallback: fallback ?? [],
        params: params ?? {},
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: teamId ?? null,
      agentId: agentId ?? null,
      actorUserId: ctx.userId,
      eventType: 'model_routing.create',
      resourceType: 'agent_studio_model_routing',
      resourceId: data.id,
      payload: { scope, useCase, provider, model },
    });
    res.status(201).json({ rule: data });
  });

  app.patch('/api/agent-studio/model-routing/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const allowed: Record<string, unknown> = {};
    const map: Record<string, string> = {
      provider: 'provider',
      model: 'model',
      providerKeyId: 'provider_key_id',
      fallback: 'fallback',
      params: 'params',
      isActive: 'is_active',
    };
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] !== undefined) allowed[col] = req.body[k];
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_model_routing')
      .update(allowed)
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'model_routing.update',
      resourceType: 'agent_studio_model_routing',
      resourceId: id,
      payload: allowed,
    });
    res.json({ rule: data });
  });

  app.delete('/api/agent-studio/model-routing/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const { error } = await supabaseAdmin!
      .from('agent_studio_model_routing')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'model_routing.delete',
      resourceType: 'agent_studio_model_routing',
      resourceId: id,
    });
    res.status(204).end();
  });

  // ========================================================================
  // MCP servers.
  // ========================================================================

  app.get('/api/agent-studio/mcp-servers', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_mcp_servers')
      .select('id, org_id, team_id, name, transport, command, url, args, env, enabled_tools, is_active, metadata, created_at, updated_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ servers: data ?? [] });
  });

  app.post('/api/agent-studio/mcp-servers', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { teamId, name, transport, command, url, args, env, enabledTools, headers, metadata } =
      req.body ?? {};
    if (!name || !transport) return res.status(400).json({ error: 'name and transport are required' });
    if (transport === 'stdio' && !command) return res.status(400).json({ error: 'command required for stdio' });
    if (['sse', 'websocket', 'http'].includes(transport) && !url) {
      return res.status(400).json({ error: 'url required for sse/websocket/http' });
    }

    const insert: Record<string, unknown> = {
      org_id: ctx.orgId,
      team_id: teamId ?? null,
      name,
      transport,
      command: command ?? null,
      url: url ?? null,
      args: args ?? [],
      env: env ?? {},
      enabled_tools: enabledTools ?? [],
      metadata: metadata ?? {},
      created_by: ctx.userId ?? null,
    };

    if (headers && typeof headers === 'object') {
      try {
        const headerBlob = encryptString(JSON.stringify(headers));
        insert.headers_ciphertext = bufToDb(headerBlob.ciphertext);
        insert.headers_iv = bufToDb(headerBlob.iv);
        insert.headers_tag = bufToDb(headerBlob.tag);
      } catch (err: any) {
        return res.status(500).json({ error: 'ENCRYPTION_FAILED', message: err?.message });
      }
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_mcp_servers')
      .insert(insert)
      .select('id, org_id, team_id, name, transport, command, url, args, env, enabled_tools, is_active, metadata, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: teamId ?? null,
      actorUserId: ctx.userId,
      eventType: 'mcp_server.create',
      resourceType: 'agent_studio_mcp_servers',
      resourceId: data.id,
      payload: { name, transport },
    });
    res.status(201).json({ server: data });
  });

  app.patch('/api/agent-studio/mcp-servers/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const allowed: Record<string, unknown> = {};
    const map: Record<string, string> = {
      name: 'name',
      transport: 'transport',
      command: 'command',
      url: 'url',
      args: 'args',
      env: 'env',
      enabledTools: 'enabled_tools',
      metadata: 'metadata',
      isActive: 'is_active',
    };
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] !== undefined) allowed[col] = req.body[k];
    }
    if (req.body?.headers && typeof req.body.headers === 'object') {
      try {
        const headerBlob = encryptString(JSON.stringify(req.body.headers));
        allowed.headers_ciphertext = bufToDb(headerBlob.ciphertext);
        allowed.headers_iv = bufToDb(headerBlob.iv);
        allowed.headers_tag = bufToDb(headerBlob.tag);
      } catch (err: any) {
        return res.status(500).json({ error: 'ENCRYPTION_FAILED', message: err?.message });
      }
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_mcp_servers')
      .update(allowed)
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .select('id, org_id, team_id, name, transport, command, url, args, env, enabled_tools, is_active, metadata, updated_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: data.team_id,
      actorUserId: ctx.userId,
      eventType: 'mcp_server.update',
      resourceType: 'agent_studio_mcp_servers',
      resourceId: id,
    });
    res.json({ server: data });
  });

  app.delete('/api/agent-studio/mcp-servers/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const { error } = await supabaseAdmin!
      .from('agent_studio_mcp_servers')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'mcp_server.delete',
      resourceType: 'agent_studio_mcp_servers',
      resourceId: id,
    });
    res.status(204).end();
  });

  // ========================================================================
  // Integrations (Jira / Azure DevOps / GitHub / GitLab — CRUD only).
  // ========================================================================

  app.get('/api/agent-studio/integrations', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_integrations')
      .select('id, org_id, team_id, kind, name, config, status, last_synced_at, last_error, created_at, updated_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ integrations: data ?? [] });
  });

  app.post('/api/agent-studio/integrations', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { teamId, kind, name, config, credentials } = req.body ?? {};
    if (!kind || !name) return res.status(400).json({ error: 'kind and name are required' });

    const insert: Record<string, unknown> = {
      org_id: ctx.orgId,
      team_id: teamId ?? null,
      kind,
      name,
      config: config ?? {},
      created_by: ctx.userId ?? null,
    };

    if (credentials && typeof credentials === 'object' && Object.keys(credentials).length > 0) {
      try {
        const blob = encryptString(JSON.stringify(credentials));
        insert.credentials_ciphertext = bufToDb(blob.ciphertext);
        insert.credentials_iv = bufToDb(blob.iv);
        insert.credentials_tag = bufToDb(blob.tag);
      } catch (err: any) {
        return res.status(500).json({ error: 'ENCRYPTION_FAILED', message: err?.message });
      }
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_integrations')
      .insert(insert)
      .select('id, org_id, team_id, kind, name, config, status, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId: teamId ?? null,
      actorUserId: ctx.userId,
      eventType: 'integration.create',
      resourceType: 'agent_studio_integrations',
      resourceId: data.id,
      payload: { kind, name },
    });
    res.status(201).json({ integration: data });
  });

  app.delete('/api/agent-studio/integrations/:id', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const { id } = req.params;
    const { error } = await supabaseAdmin!
      .from('agent_studio_integrations')
      .delete()
      .eq('id', id)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    await logAgentStudioAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      eventType: 'integration.delete',
      resourceType: 'agent_studio_integrations',
      resourceId: id,
    });
    res.status(204).end();
  });

  // ========================================================================
  // Orchestrator dispatch (BYOK + model routing; pause-aware).
  // ========================================================================

  app.post('/api/agent-studio/dispatch', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;
    await handleAgentStudioDispatch(req, res, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      role: ctx.role,
    });
  });

  // ========================================================================
  // Integration connectivity test (decrypt + vendor ping).
  // ========================================================================

  app.post('/api/agent-studio/integrations/:id/ping', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    await handleIntegrationPing(req, res, { orgId: ctx.orgId, userId: ctx.userId });
  });

  // ========================================================================
  // Audit log (read-only — writes are server-side only).
  // ========================================================================

  app.get('/api/agent-studio/audit-logs', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireStaff(ctx, res) || dbDown(res)) return;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const teamId = (req.query.teamId as string) || undefined;
    let q = supabaseAdmin!
      .from('agent_studio_audit_logs')
      .select('*')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (teamId) q = q.eq('team_id', teamId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ events: data ?? [] });
  });
}
