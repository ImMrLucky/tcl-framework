/**
 * Agent Studio TCL API — exposes engine findings to UI and tcl-browser-runner.
 */

import express from 'express';
import { getOrgContext, type OrgContext } from '../auth-context.js';
import { supabaseAdmin } from '../supabase.js';
import { isTclSchemaError, runManualStudioTclAnalysis } from './tcl-studio-service.js';
import { subscribeTclStream } from './tcl-sse-hub.js';
import type { StudioWorkArtifact } from '../../studio/types.js';

const ANALYST_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']);

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

async function ensureContext(
  req: express.Request,
  res: express.Response
): Promise<AuthedContext | null> {
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

export function registerTclStudioRoutes(app: express.Application): void {
  /** Server-Sent Events — real-time TCL analysis updates (replaces polling). */
  app.get('/api/agent-studio/tcl/stream', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res)) return;

    const teamId = (req.query.teamId as string) || undefined;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, teamId: teamId ?? null })}\n\n`);

    const unsubscribe = subscribeTclStream(res, ctx.orgId, teamId);
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  /** Live feed for TCL browser runner + in-app panel (recent analyses). */
  app.get('/api/agent-studio/tcl/live-feed', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;

    const teamId = (req.query.teamId as string) || undefined;
    const since = (req.query.since as string) || undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 40, 100);

    let q = supabaseAdmin!
      .from('agent_studio_tcl_analyses')
      .select(
        'id, team_id, agent_run_id, agent_id, task_id, trigger, status, report, error, started_at, finished_at, created_at'
      )
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (teamId) q = q.eq('team_id', teamId);
    if (since) q = q.gt('created_at', since);

    const { data, error } = await q;
    if (error) {
      if (isTclSchemaError(error.message)) {
        return res.json({ analyses: [], migrationRequired: '054_agent_studio_tcl_analysis.sql' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ analyses: data ?? [] });
  });

  app.get('/api/agent-studio/teams/:teamId/tcl/analyses', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tcl_analyses')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', req.params.teamId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isTclSchemaError(error.message)) {
        return res.json({ analyses: [], migrationRequired: '054_agent_studio_tcl_analysis.sql' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ analyses: data ?? [] });
  });

  app.get('/api/agent-studio/teams/:teamId/tcl/analyses/:analysisId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;

    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tcl_analyses')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', req.params.teamId)
      .eq('id', req.params.analysisId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Analysis not found' });
    res.json({ analysis: data });
  });

  app.post('/api/agent-studio/teams/:teamId/tcl/analyze', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || dbDown(res)) return;

    const body = req.body ?? {};
    const artifact: StudioWorkArtifact = {
      question: String(body.question ?? ''),
      answer: String(body.answer ?? ''),
      sources: body.sources,
      teamId: req.params.teamId,
      agentId: body.agentId,
      taskId: body.taskId,
      agentRunId: body.agentRunId,
      teamRunId: body.teamRunId,
      useCase: body.useCase,
    };

    const result = await runManualStudioTclAnalysis({
      orgId: ctx.orgId,
      teamId: req.params.teamId,
      artifact,
      trigger: body.trigger ?? 'MANUAL',
      agentRunId: body.agentRunId ?? null,
      teamRunId: body.teamRunId ?? null,
      agentId: body.agentId ?? null,
      taskId: body.taskId ?? null,
    });

    if ('error' in result) {
      const status = result.error.includes('migration') ? 503 : 400;
      return res.status(status).json({ error: result.error });
    }
    res.status(201).json(result);
  });
}
