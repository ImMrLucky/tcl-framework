/**
 * Patch proposal review — created from TCL suggested fixes.
 */

import express from 'express';
import { getOrgContext, type OrgContext } from '../auth-context.js';
import { supabaseAdmin } from '../supabase.js';

const ANALYST_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']);

type Ctx = OrgContext & { orgId: string };

async function ensureContext(req: express.Request, res: express.Response): Promise<Ctx | null> {
  const ctx = await getOrgContext(req);
  if (!ctx?.orgId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return ctx as Ctx;
}

function requireAnalyst(ctx: Ctx, res: express.Response): boolean {
  if (!ctx.role || !ANALYST_ROLES.has(ctx.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerPatchProposalRoutes(app: express.Application): void {
  app.get('/api/agent-studio/teams/:teamId/patches', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || !supabaseAdmin) return;

    const status = (req.query.status as string) || undefined;
    let q = supabaseAdmin
      .from('agent_studio_patch_proposals')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', req.params.teamId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) {
      if (error.message.includes('does not exist')) {
        return res.json({ patches: [], migrationRequired: '053_agent_studio_runner_security.sql' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ patches: data ?? [] });
  });

  app.get('/api/agent-studio/teams/:teamId/patches/:patchId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || !supabaseAdmin) return;

    const { data, error } = await supabaseAdmin
      .from('agent_studio_patch_proposals')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', req.params.teamId)
      .eq('id', req.params.patchId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Patch not found' });
    res.json({ patch: data });
  });

  app.patch('/api/agent-studio/teams/:teamId/patches/:patchId', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || !supabaseAdmin) return;

    const status = req.body?.status as string | undefined;
    if (!status || !['APPROVED', 'REJECTED', 'APPLIED', 'SUPERSEDED'].includes(status)) {
      return res.status(400).json({ error: 'status must be APPROVED, REJECTED, APPLIED, or SUPERSEDED' });
    }

    const { data, error } = await supabaseAdmin
      .from('agent_studio_patch_proposals')
      .update({ status })
      .eq('org_id', ctx.orgId)
      .eq('team_id', req.params.teamId)
      .eq('id', req.params.patchId)
      .select('*')
      .single();

    if (error || !data) return res.status(404).json({ error: 'Patch not found' });
    res.json({ patch: data });
  });

  /** Returns file map for IDE workspace merge (client applies to session storage). */
  app.post('/api/agent-studio/teams/:teamId/patches/:patchId/apply', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !requireAnalyst(ctx, res) || !supabaseAdmin) return;

    const { data, error } = await supabaseAdmin
      .from('agent_studio_patch_proposals')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('team_id', req.params.teamId)
      .eq('id', req.params.patchId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Patch not found' });
    if (data.status === 'REJECTED' || data.status === 'SUPERSEDED') {
      return res.status(400).json({ error: 'Patch is not applicable' });
    }

    const files = (data.files ?? []) as Array<{ path: string; content: string }>;
    const workspace: Record<string, string> = {};
    for (const f of files) {
      if (f.path && typeof f.content === 'string') workspace[f.path] = f.content;
    }

    await supabaseAdmin
      .from('agent_studio_patch_proposals')
      .update({ status: 'APPLIED' })
      .eq('id', data.id);

    res.json({ patch: data, workspace });
  });
}
