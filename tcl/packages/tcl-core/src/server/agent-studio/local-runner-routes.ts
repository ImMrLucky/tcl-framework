/**
 * Local Agent Runner execution-plane APIs (require runner bearer token).
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { appendTeamEvent } from './team-events.js';
import { readPauseGate, blockedByPause } from './pause-gate.js';
import { assertReviewGatesAllowTerminalMove } from './review-gate-move.js';
import { parseBoardSettings } from './board-settings.js';
import {
  assertRunnerOrgAccess,
  generateRunnerAuthToken,
  hashPairingCode,
  hashRunnerToken,
  requireRunnerAuth,
} from './runner-auth.js';
import {
  isAutonomousSchemaError,
  respondAutonomousDbError,
  respondAutonomousListEmpty,
} from './autonomous-db.js';

function dbDown(res: express.Response): boolean {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Database not configured' });
    return true;
  }
  return false;
}

async function loadTaskForRunner(
  taskId: string,
  orgId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin!
    .from('agent_studio_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

export function registerLocalRunnerExecutionRoutes(app: express.Application): void {
  // -------------------------------------------------------------------------
  // Jobs (runner auth required)
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/local-runner/jobs/poll', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;

    if (auth.runner['status'] === 'REVOKED') {
      return res.json({ jobs: [], revoked: true });
    }

    const { data: runs, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('*')
      .eq('org_id', auth.orgId)
      .in('status', ['QUEUED', 'RUNNING', 'PAUSED'])
      .or(`local_runner_id.eq.${auth.runnerId},and(local_runner_id.is.null,status.eq.QUEUED)`)
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) {
      if (isAutonomousSchemaError(error)) {
        respondAutonomousListEmpty(res, error, { jobs: [] });
        return;
      }
      return res.status(500).json({ error: error.message });
    }

    res.json({ jobs: runs ?? [] });
  });

  app.post('/api/agent-studio/local-runner/jobs/:jobId/claim', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { jobId } = req.params;
    const sessionId = (req.body?.sessionId as string) ?? `sess_${Date.now()}`;

    const { data: existing } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .select('org_id, local_runner_id, status')
      .eq('id', jobId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Job not found' });
    if (!(await assertRunnerOrgAccess(res, auth.orgId, existing.org_id as string))) return;
    if (
      existing.local_runner_id &&
      existing.local_runner_id !== auth.runnerId &&
      existing.status !== 'QUEUED'
    ) {
      return res.status(409).json({ error: 'Job claimed by another runner' });
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .update({
        status: 'RUNNING',
        local_runner_id: auth.runnerId,
        local_runner_session_id: sessionId,
        started_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Job not found' });
    res.json({ run: data });
  });

  app.post('/api/agent-studio/local-runner/jobs/:jobId/progress', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { jobId } = req.params;
    const { completedSteps, status, metadata } = req.body ?? {};
    const patch: Record<string, unknown> = { last_heartbeat_at: new Date().toISOString() };
    if (completedSteps != null) patch.completed_steps = completedSteps;
    if (status) patch.status = status;
    if (metadata) patch.metadata = metadata;

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .update(patch)
      .eq('id', jobId)
      .eq('org_id', auth.orgId)
      .eq('local_runner_id', auth.runnerId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Job not found or not owned by runner' });
    res.json({ run: data });
  });

  app.post('/api/agent-studio/local-runner/jobs/:jobId/complete', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { jobId } = req.params;
    const { status, metadata } = req.body ?? {};
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .update({
        status: status ?? 'SUCCEEDED',
        finished_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
        metadata: metadata ?? {},
      })
      .eq('id', jobId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Job not found' });
    res.json({ run: data });
  });

  app.post('/api/agent-studio/local-runner/jobs/:jobId/fail', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { jobId } = req.params;
    const { error: errMsg, metadata } = req.body ?? {};
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_team_runs')
      .update({
        status: 'FAILED',
        finished_at: new Date().toISOString(),
        metadata: { error: errMsg, ...(metadata ?? {}) },
      })
      .eq('id', jobId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Job not found' });
    res.json({ run: data });
  });

  app.post('/api/agent-studio/local-runners/:runnerId/heartbeat', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    if (auth.runnerId !== req.params.runnerId) {
      return res.status(403).json({ error: 'Runner ID mismatch' });
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_local_runners')
      .update({
        status: 'ONLINE',
        last_seen_at: new Date().toISOString(),
        capabilities: req.body?.capabilities ?? {},
      })
      .eq('id', auth.runnerId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Runner not found' });
    res.json({ runner: data });
  });

  app.post('/api/agent-studio/local-runner/vendors/register', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { provider, label, localKeyRef, keyPreview, supportedModels, capabilities } = req.body ?? {};
    if (!provider || !label || !localKeyRef) {
      return res.status(400).json({ error: 'provider, label, localKeyRef required' });
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_local_vendor_refs')
      .upsert(
        {
          org_id: auth.orgId,
          local_runner_id: auth.runnerId,
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
      if (respondAutonomousDbError(res, error)) return;
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ vendor: data });
  });

  app.post('/api/agent-studio/local-runner/teams/:teamId/events', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { teamId } = req.params;
    const { teamRunId, agentId, taskId, eventType, actorType, actorName, summary, jsonl } =
      req.body ?? {};
    if (!eventType || !summary) {
      return res.status(400).json({ error: 'eventType and summary are required' });
    }
    const row = await appendTeamEvent({
      supabase: supabaseAdmin!,
      orgId: auth.orgId,
      teamId,
      teamRunId: teamRunId ?? null,
      agentId: agentId ?? null,
      taskId: taskId ?? null,
      eventType: String(eventType),
      actorType: actorType ?? 'LOCAL_RUNNER',
      actorName: actorName ?? 'local-runner',
      summary: String(summary),
      jsonl: jsonl ?? {},
    });
    if (!row) return res.status(500).json({ error: 'Failed to append event' });
    res.status(201).json({ event: row });
  });

  // -------------------------------------------------------------------------
  // Board state + mutations
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/local-runner/teams/:teamId/board-state', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { teamId } = req.params;

    const { data: team } = await supabaseAdmin!
      .from('agent_studio_teams')
      .select('*')
      .eq('id', teamId)
      .eq('org_id', auth.orgId)
      .maybeSingle();
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const { data: board } = await supabaseAdmin!
      .from('agent_studio_boards')
      .select('*')
      .eq('team_id', teamId)
      .eq('org_id', auth.orgId)
      .eq('is_default', true)
      .maybeSingle();
    if (!board) return res.status(404).json({ error: 'Board not found' });

    const [{ data: tasks }, { data: agents }, { data: orgRow }] = await Promise.all([
      supabaseAdmin!.from('agent_studio_tasks').select('*').eq('team_id', teamId).eq('org_id', auth.orgId),
      supabaseAdmin!.from('agent_studio_agents').select('*').eq('team_id', teamId).eq('org_id', auth.orgId),
      supabaseAdmin!.from('agent_studio_orgs').select('paused_at').eq('org_id', auth.orgId).maybeSingle(),
    ]);

    const taskList = tasks ?? [];
    const taskIds = taskList.map((t) => t.id);
    const reviewGatesByTaskId: Record<string, unknown[]> = {};
    if (taskIds.length) {
      const { data: gates } = await supabaseAdmin!
        .from('agent_studio_review_gates')
        .select('*')
        .eq('org_id', auth.orgId)
        .in('task_id', taskIds);
      for (const g of gates ?? []) {
        const tid = g.task_id as string;
        (reviewGatesByTaskId[tid] = reviewGatesByTaskId[tid] || []).push(g);
      }
    }

    const pause = await readPauseGate({ orgId: auth.orgId, teamId });
    res.json({
      team,
      board: { ...board, settings: parseBoardSettings(board.settings) },
      columns: board.columns,
      tasks: taskList,
      agents: agents ?? [],
      reviewGatesByTaskId,
      pauseState: {
        orgPaused: !!orgRow?.paused_at,
        teamPaused: !!team.paused_at,
        reasons: pause.reasons,
      },
    });
  });

  app.post('/api/agent-studio/local-runner/tasks/:taskId/assign', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const task = await loadTaskForRunner(req.params.taskId, auth.orgId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const gate = await readPauseGate({
      orgId: auth.orgId,
      teamId: task.team_id as string,
      agentId: req.body?.agentId ?? null,
    });
    if (blockedByPause(res, gate)) return;

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .update({ assigned_agent_id: req.body?.agentId ?? null })
      .eq('id', req.params.taskId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ task: data });
  });

  app.post('/api/agent-studio/local-runner/tasks/:taskId/move', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const task = await loadTaskForRunner(req.params.taskId, auth.orgId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const columnKey = req.body?.columnKey as string;
    if (!columnKey) return res.status(400).json({ error: 'columnKey is required' });

    const gate = await readPauseGate({ orgId: auth.orgId, teamId: task.team_id as string });
    if (blockedByPause(res, gate)) return;

    const rv = await assertReviewGatesAllowTerminalMove(
      supabaseAdmin!,
      auth.orgId,
      req.params.taskId,
      columnKey
    );
    if (!rv.ok) {
      return res.status(409).json({
        error: 'REVIEW_GATE_BLOCKED',
        message: 'Pending review gates block this move.',
        pendingGates: rv.pendingGates,
      });
    }

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .update({ column_key: columnKey })
      .eq('id', req.params.taskId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ task: data });
  });

  app.post('/api/agent-studio/local-runner/tasks/:taskId/block', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const task = await loadTaskForRunner(req.params.taskId, auth.orgId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const gate = await readPauseGate({ orgId: auth.orgId, teamId: task.team_id as string });
    if (blockedByPause(res, gate)) return;

    const reason = (req.body?.reason as string) ?? 'Blocked by Jarvis';
    const meta = { ...(task.metadata as Record<string, unknown>), blockReason: reason };
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .update({ status: 'BLOCKED', metadata: meta })
      .eq('id', req.params.taskId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ task: data });
  });

  app.post('/api/agent-studio/local-runner/tasks/:taskId/unblock', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const task = await loadTaskForRunner(req.params.taskId, auth.orgId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const gate = await readPauseGate({ orgId: auth.orgId, teamId: task.team_id as string });
    if (blockedByPause(res, gate)) return;

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', req.params.taskId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ task: data });
  });

  app.post('/api/agent-studio/local-runner/tasks/:taskId/review-request', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const task = await loadTaskForRunner(req.params.taskId, auth.orgId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const gateType = (req.body?.gateType as string) ?? 'CODE_REVIEW';
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_review_gates')
      .insert({
        org_id: auth.orgId,
        task_id: req.params.taskId,
        gate_type: gateType,
        status: 'PENDING',
        required_role: req.body?.requiredRole ?? null,
        metadata: req.body?.metadata ?? {},
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin!
      .from('agent_studio_tasks')
      .update({ status: 'REVIEW', column_key: req.body?.columnKey ?? 'review' })
      .eq('id', req.params.taskId);

    res.status(201).json({ gate: data });
  });

  app.post('/api/agent-studio/local-runner/tasks', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { teamId, title, description, columnKey, taskType, priority, metadata } = req.body ?? {};
    if (!teamId || !title) return res.status(400).json({ error: 'teamId and title required' });

    const gate = await readPauseGate({ orgId: auth.orgId, teamId });
    if (blockedByPause(res, gate)) return;

    const { data: board } = await supabaseAdmin!
      .from('agent_studio_boards')
      .select('id')
      .eq('team_id', teamId)
      .eq('org_id', auth.orgId)
      .eq('is_default', true)
      .maybeSingle();
    if (!board) return res.status(404).json({ error: 'Board not found' });

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .insert({
        org_id: auth.orgId,
        team_id: teamId,
        board_id: board.id,
        column_key: columnKey ?? 'backlog',
        title,
        description: description ?? null,
        task_type: taskType ?? 'STORY',
        priority: priority ?? 'MEDIUM',
        metadata: metadata ?? {},
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ task: data });
  });

  // -------------------------------------------------------------------------
  // Agent runs + steps
  // -------------------------------------------------------------------------
  app.post('/api/agent-studio/local-runner/agent-runs', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const b = req.body ?? {};
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_runs')
      .insert({
        org_id: auth.orgId,
        team_id: b.teamId,
        team_run_id: b.teamRunId ?? null,
        agent_id: b.agentId,
        task_id: b.taskId ?? null,
        use_case: b.useCase ?? 'chat',
        status: b.status ?? 'RUNNING',
        provider: b.provider ?? null,
        model: b.model ?? null,
        local_provider_ref: b.localProviderRef ?? null,
        metadata: { executionMode: 'LOCAL_RUNNER_DEFAULT', ...(b.metadata ?? {}) },
        started_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) {
      if (respondAutonomousDbError(res, error)) return;
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ agentRun: data });
  });

  app.patch('/api/agent-studio/local-runner/agent-runs/:agentRunId', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const allowed: Record<string, unknown> = {};
    const map: Record<string, string> = {
      status: 'status',
      output: 'output',
      error: 'error',
      promptPreview: 'prompt_preview',
      inputTokens: 'input_tokens',
      outputTokens: 'output_tokens',
      metadata: 'metadata',
    };
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] !== undefined) allowed[col] = req.body[k];
    }
    if (req.body?.status === 'SUCCEEDED' || req.body?.status === 'FAILED') {
      allowed.finished_at = new Date().toISOString();
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_runs')
      .update(allowed)
      .eq('id', req.params.agentRunId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Agent run not found' });
    if (req.body?.status === 'SUCCEEDED' && data.output?.trim()) {
      const { scheduleTclAnalysisForAgentRun } = await import('./tcl-studio-service.js');
      scheduleTclAnalysisForAgentRun(data);
    }
    res.json({ agentRun: data });
  });

  app.post('/api/agent-studio/local-runner/agent-runs/:agentRunId/steps', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const b = req.body ?? {};
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_run_steps')
      .insert({
        org_id: auth.orgId,
        team_run_id: b.teamRunId ?? null,
        agent_run_id: req.params.agentRunId,
        team_id: b.teamId,
        agent_id: b.agentId ?? null,
        task_id: b.taskId ?? null,
        step_index: b.stepIndex ?? 0,
        step_type: b.stepType,
        label: b.label,
        status: b.status ?? 'RUNNING',
        input: b.input ?? {},
        output: b.output ?? {},
      })
      .select('*')
      .single();
    if (error) {
      if (respondAutonomousDbError(res, error)) return;
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ step: data });
  });

  app.patch('/api/agent-studio/local-runner/agent-run-steps/:stepId', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const allowed: Record<string, unknown> = {};
    if (req.body?.status) allowed.status = req.body.status;
    if (req.body?.output) allowed.output = req.body.output;
    if (req.body?.error) allowed.error = req.body.error;
    if (req.body?.status === 'SUCCEEDED' || req.body?.status === 'FAILED') {
      allowed.finished_at = new Date().toISOString();
    }
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_run_steps')
      .update(allowed)
      .eq('id', req.params.stepId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Step not found' });
    res.json({ step: data });
  });

  // -------------------------------------------------------------------------
  // Private agent context
  // -------------------------------------------------------------------------
  app.get('/api/agent-studio/local-runner/agents/:agentId/private-context', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_private_context')
      .select('*')
      .eq('agent_id', req.params.agentId)
      .eq('org_id', auth.orgId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ context: data ?? null });
  });

  app.patch('/api/agent-studio/local-runner/agents/:agentId/private-context', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const { agentId } = req.params;
    const { data: agent } = await supabaseAdmin!
      .from('agent_studio_agents')
      .select('team_id')
      .eq('id', agentId)
      .eq('org_id', auth.orgId)
      .maybeSingle();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const patch = {
      summary: req.body?.summary,
      current_task_id: req.body?.currentTaskId,
      memory: req.body?.memory,
      lessons: req.body?.lessons,
      open_questions: req.body?.openQuestions,
      blockers: req.body?.blockers,
      updated_by_agent_id: agentId,
      updated_at: new Date().toISOString(),
    };
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    );

    const { data: existing } = await supabaseAdmin!
      .from('agent_studio_agent_private_context')
      .select('id')
      .eq('agent_id', agentId)
      .maybeSingle();

    let data;
    let error;
    if (existing) {
      ({ data, error } = await supabaseAdmin!
        .from('agent_studio_agent_private_context')
        .update(cleaned)
        .eq('agent_id', agentId)
        .select('*')
        .single());
    } else {
      ({ data, error } = await supabaseAdmin!
        .from('agent_studio_agent_private_context')
        .insert({
          org_id: auth.orgId,
          team_id: agent.team_id,
          agent_id: agentId,
          summary: req.body?.summary ?? '',
          memory: req.body?.memory ?? {},
          lessons: req.body?.lessons ?? [],
          open_questions: req.body?.openQuestions ?? [],
          blockers: req.body?.blockers ?? [],
          ...cleaned,
        })
        .select('*')
        .single());
    }
    if (error) {
      if (respondAutonomousDbError(res, error)) return;
      return res.status(500).json({ error: error.message });
    }
    res.json({ context: data });
  });

  // -------------------------------------------------------------------------
  // TCL (Jarvis step analysis)
  // -------------------------------------------------------------------------
  app.post('/api/agent-studio/local-runner/tcl/jarvis-step', async (req, res) => {
    if (dbDown(res)) return;
    const auth = await requireRunnerAuth(req, res);
    if (!auth) return;
    const b = req.body ?? {};
    const teamId = String(b.teamId ?? '');
    const teamRunId = String(b.teamRunId ?? '');
    const agentId = String(b.agentId ?? '');
    if (!teamId || !teamRunId || !agentId || !b.jarvisOutput) {
      return res.status(400).json({ error: 'teamId, teamRunId, agentId, jarvisOutput required' });
    }
    const { scheduleTclAnalysisForJarvisStep } = await import('./tcl-studio-service.js');
    scheduleTclAnalysisForJarvisStep({
      orgId: auth.orgId,
      teamId,
      teamRunId,
      agentId,
      objective: String(b.objective ?? ''),
      jarvisOutput: String(b.jarvisOutput),
      actionSummary: String(b.actionSummary ?? 'Jarvis tick'),
    });
    res.status(202).json({ scheduled: true });
  });
}

/** Pair endpoint — public, returns runnerAuthToken once. */
export async function pairLocalRunnerHandler(req: express.Request, res: express.Response): Promise<void> {
  if (dbDown(res)) return;
  const { pairingCode, runnerPublicKey, deviceLabel } = req.body ?? {};
  if (!pairingCode) {
    res.status(400).json({ error: 'pairingCode is required' });
    return;
  }
  const hash = hashPairingCode(String(pairingCode));
  const { data: runner, error } = await supabaseAdmin!
    .from('agent_studio_local_runners')
    .select('*')
    .eq('pairing_code_hash', hash)
    .eq('status', 'NEW')
    .maybeSingle();
  if (error || !runner) {
    res.status(404).json({ error: 'Invalid or expired pairing code' });
    return;
  }
  const expires = runner.pairing_expires_at as string | null;
  if (expires && new Date(expires).getTime() < Date.now()) {
    res.status(410).json({ error: 'Pairing code expired' });
    return;
  }

  const runnerAuthToken = generateRunnerAuthToken();
  const tokenHash = hashRunnerToken(runnerAuthToken);

  const { data: updated, error: upErr } = await supabaseAdmin!
    .from('agent_studio_local_runners')
    .update({
      status: 'PAIRED',
      runner_public_key: runnerPublicKey ?? null,
      device_label: deviceLabel ?? runner.device_label,
      pairing_code_hash: null,
      pairing_expires_at: null,
      runner_auth_token_hash: tokenHash,
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', runner.id)
    .select('*')
    .single();
  if (upErr) {
    res.status(500).json({ error: upErr.message });
    return;
  }
  res.json({ runner: updated, runnerAuthToken });
}
