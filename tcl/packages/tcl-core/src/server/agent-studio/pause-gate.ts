import type express from 'express';
import { supabaseAdmin } from '../supabase.js';

export interface PauseGateState {
  orgPaused: boolean;
  teamPaused: boolean;
  agentPaused: boolean;
  reasons: { org?: string | null; team?: string | null; agent?: string | null };
}

/**
 * Read effective pause gate for the supplied scope. Any layer paused blocks
 * dispatch / mutation paths (orchestrator gateway uses the same helper).
 */
export async function readPauseGate(input: {
  orgId: string;
  teamId?: string | null;
  agentId?: string | null;
}): Promise<PauseGateState> {
  const result: PauseGateState = {
    orgPaused: false,
    teamPaused: false,
    agentPaused: false,
    reasons: {},
  };
  if (!supabaseAdmin) return result;

  const { data: orgRow } = await supabaseAdmin
    .from('agent_studio_orgs')
    .select('paused_at, pause_reason')
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (orgRow?.paused_at) {
    result.orgPaused = true;
    result.reasons.org = orgRow.pause_reason ?? null;
  }

  if (input.teamId) {
    const { data: teamRow } = await supabaseAdmin
      .from('agent_studio_teams')
      .select('paused_at, pause_reason')
      .eq('id', input.teamId)
      .maybeSingle();
    if (teamRow?.paused_at) {
      result.teamPaused = true;
      result.reasons.team = teamRow.pause_reason ?? null;
    }
  }

  if (input.agentId) {
    const { data: agentRow } = await supabaseAdmin
      .from('agent_studio_agents')
      .select('paused_at, pause_reason')
      .eq('id', input.agentId)
      .maybeSingle();
    if (agentRow?.paused_at) {
      result.agentPaused = true;
      result.reasons.agent = agentRow.pause_reason ?? null;
    }
  }

  return result;
}

export function blockedByPause(res: express.Response, gate: PauseGateState): boolean {
  if (gate.orgPaused || gate.teamPaused || gate.agentPaused) {
    res.status(423).json({
      error: 'PAUSED',
      message: 'Operation blocked while pause is active.',
      gate,
    });
    return true;
  }
  return false;
}
