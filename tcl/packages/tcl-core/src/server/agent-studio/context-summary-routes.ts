/**
 * Team shared context summary (control plane UI + Jarvis).
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext, type OrgContext } from '../auth-context.js';

type Ctx = OrgContext & { orgId: string };

async function ensureContext(
  req: express.Request,
  res: express.Response
): Promise<Ctx | null> {
  const ctx = await getOrgContext(req);
  if (!ctx?.orgId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return ctx as Ctx;
}

export function registerContextSummaryRoutes(app: express.Application): void {
  app.get('/api/agent-studio/teams/:teamId/context-summary', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !supabaseAdmin) return;
    const { teamId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('agent_studio_team_context_summaries')
      .select('*')
      .eq('team_id', teamId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
        return res.json({ summary: null, migrationRequired: true });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ summary: data });
  });

  app.patch('/api/agent-studio/teams/:teamId/context-summary', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !supabaseAdmin) return;
    const { teamId } = req.params;
    const patch = {
      summary: req.body?.summary,
      decisions: req.body?.decisions,
      risks: req.body?.risks,
      blockers: req.body?.blockers,
      agent_statuses: req.body?.agentStatuses,
      open_questions: req.body?.openQuestions,
      next_actions: req.body?.nextActions,
      last_event_sequence: req.body?.lastEventSequence,
    };
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    );

    const { data: existing } = await supabaseAdmin
      .from('agent_studio_team_context_summaries')
      .select('id')
      .eq('team_id', teamId)
      .maybeSingle();

    let data;
    let error;
    if (existing) {
      ({ data, error } = await supabaseAdmin
        .from('agent_studio_team_context_summaries')
        .update(cleaned)
        .eq('team_id', teamId)
        .select('*')
        .single());
    } else {
      ({ data, error } = await supabaseAdmin
        .from('agent_studio_team_context_summaries')
        .insert({ org_id: ctx.orgId, team_id: teamId, ...cleaned })
        .select('*')
        .single());
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ summary: data });
  });

  app.get('/api/agent-studio/teams/:teamId/agent-contexts', async (req, res) => {
    const ctx = await ensureContext(req, res);
    if (!ctx || !supabaseAdmin) return;
    const { teamId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('agent_studio_agent_private_context')
      .select('*, agent_studio_agents(name, role_template_key, status)')
      .eq('team_id', teamId)
      .eq('org_id', ctx.orgId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ contexts: data ?? [] });
  });
}
