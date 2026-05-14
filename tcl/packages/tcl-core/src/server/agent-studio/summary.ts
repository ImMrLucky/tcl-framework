import type { SupabaseClient } from '@supabase/supabase-js';

export type NeedsAttentionItem = {
  type: 'task' | 'agent' | 'review' | 'integration' | 'mcp';
  label: string;
  description: string;
  teamId?: string;
  taskId?: string;
  agentId?: string;
};

export type AgentStudioSummary = {
  teamsTotal: number;
  teamsPaused: number;
  agentsTotal: number;
  agentsPaused: number;
  tasksTotal: number;
  tasksInProgress: number;
  tasksBlocked: number;
  reviewsPending: number;
  recentAuditEvents: unknown[];
  recentRuns: unknown[];
  needsAttention: NeedsAttentionItem[];
  orgPaused: boolean;
};

export type TeamCommandCenter = {
  team: Record<string, unknown>;
  agentsTotal: number;
  agentsPaused: number;
  orchestratorCount: number;
  tasksTotal: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksInReview: number;
  pendingReviewGates: number;
  recentCompleted: unknown[];
  recentAudit: unknown[];
  recentMistakes: unknown[];
  contextSummary: string | null;
  orgPaused: boolean;
};

async function teamIdsForOrg(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = await supabase.from('agent_studio_teams').select('id').eq('org_id', orgId);
  return (data ?? []).map((r: { id: string }) => r.id);
}

export async function buildAgentStudioSummary(
  supabase: SupabaseClient,
  orgId: string
): Promise<AgentStudioSummary> {
  const teamIds = await teamIdsForOrg(supabase, orgId);

  const agentsCount = async (paused: boolean): Promise<number> => {
    if (!teamIds.length) return 0;
    let q = supabase
      .from('agent_studio_agents')
      .select('id', { count: 'exact', head: true })
      .in('team_id', teamIds);
    if (paused) q = q.not('paused_at', 'is', null);
    const { count } = await q;
    return count ?? 0;
  };

  const pausedAgentsPromise =
    teamIds.length > 0
      ? supabase
          .from('agent_studio_agents')
          .select('id, name, team_id')
          .in('team_id', teamIds)
          .not('paused_at', 'is', null)
          .limit(15)
      : Promise.resolve({ data: [] as { id: string; name: string; team_id: string }[], error: null });

  const [
    teamsRes,
    teamsPausedRes,
    tasksRes,
    tasksIpRes,
    tasksBlockedRes,
    gatesPendingRes,
    auditRes,
    orgRowRes,
    blockedTasksRes,
    pausedAgentsRes,
    agentsTotal,
    agentsPaused,
    pendingGatesList,
  ] = await Promise.all([
    supabase.from('agent_studio_teams').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase
      .from('agent_studio_teams')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('paused_at', 'is', null),
    supabase.from('agent_studio_tasks').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase
      .from('agent_studio_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'IN_PROGRESS'),
    supabase
      .from('agent_studio_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'BLOCKED'),
    supabase
      .from('agent_studio_review_gates')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'PENDING'),
    supabase
      .from('agent_studio_audit_logs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(12),
    supabase.from('agent_studio_orgs').select('paused_at').eq('org_id', orgId).maybeSingle(),
    supabase
      .from('agent_studio_tasks')
      .select('id, title, team_id')
      .eq('org_id', orgId)
      .eq('status', 'BLOCKED')
      .limit(20),
    pausedAgentsPromise,
    agentsCount(false),
    agentsCount(true),
    supabase
      .from('agent_studio_review_gates')
      .select('id, task_id, gate_type')
      .eq('org_id', orgId)
      .eq('status', 'PENDING')
      .limit(40),
  ]);

  const needsAttention: NeedsAttentionItem[] = [];

  for (const t of (blockedTasksRes.data as { id: string; title: string; team_id: string }[]) ?? []) {
    needsAttention.push({
      type: 'task',
      label: 'Blocked task',
      description: t.title,
      teamId: t.team_id,
      taskId: t.id,
    });
  }

  const gateRows = (pendingGatesList.data as { id: string; task_id: string; gate_type: string }[]) ?? [];
  const taskIds = [...new Set(gateRows.map((g) => g.task_id))];
  const taskTitleById = new Map<string, { title: string; team_id: string }>();
  if (taskIds.length) {
    const { data: trows } = await supabase
      .from('agent_studio_tasks')
      .select('id, title, team_id')
      .in('id', taskIds);
    for (const row of (trows as { id: string; title: string; team_id: string }[]) ?? []) {
      taskTitleById.set(row.id, { title: row.title, team_id: row.team_id });
    }
  }
  for (const g of gateRows.slice(0, 15)) {
    const t = taskTitleById.get(g.task_id);
    needsAttention.push({
      type: 'review',
      label: `Review: ${g.gate_type}`,
      description: t ? `Task: ${t.title}` : 'Pending review gate',
      teamId: t?.team_id,
      taskId: g.task_id,
    });
  }

  if (teamIds.length) {
    for (const a of (pausedAgentsRes.data as { id: string; name: string; team_id: string }[]) ?? []) {
      if (teamIds.includes(a.team_id)) {
        needsAttention.push({
          type: 'agent',
          label: 'Paused agent',
          description: a.name,
          teamId: a.team_id,
          agentId: a.id,
        });
      }
    }
  }

  const orgPaused = !!(orgRowRes.data as { paused_at?: string | null } | null)?.paused_at;

  return {
    teamsTotal: teamsRes.count ?? 0,
    teamsPaused: teamsPausedRes.count ?? 0,
    agentsTotal,
    agentsPaused,
    tasksTotal: tasksRes.count ?? 0,
    tasksInProgress: tasksIpRes.count ?? 0,
    tasksBlocked: tasksBlockedRes.count ?? 0,
    reviewsPending: gatesPendingRes.count ?? 0,
    recentAuditEvents: auditRes.data ?? [],
    recentRuns: [],
    needsAttention: needsAttention.slice(0, 35),
    orgPaused,
  };
}

export async function buildTeamCommandCenter(
  supabase: SupabaseClient,
  orgId: string,
  teamId: string
): Promise<TeamCommandCenter | null> {
  const { data: team, error: teamErr } = await supabase
    .from('agent_studio_teams')
    .select('*')
    .eq('id', teamId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (teamErr || !team) return null;

  const [
    agentsRes,
    agentsPausedRes,
    orchRes,
    tasksRes,
    tipRes,
    tbRes,
    trRes,
    doneRes,
    auditRes,
    mistakesRes,
    ctxRes,
    orgRowRes,
  ] = await Promise.all([
    supabase.from('agent_studio_agents').select('id', { count: 'exact', head: true }).eq('team_id', teamId),
    supabase
      .from('agent_studio_agents')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .not('paused_at', 'is', null),
    supabase
      .from('agent_studio_agents')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('is_orchestrator', true),
    supabase.from('agent_studio_tasks').select('id', { count: 'exact', head: true }).eq('team_id', teamId),
    supabase.from('agent_studio_tasks').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('status', 'IN_PROGRESS'),
    supabase.from('agent_studio_tasks').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('status', 'BLOCKED'),
    supabase.from('agent_studio_tasks').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('status', 'REVIEW'),
    supabase
      .from('agent_studio_tasks')
      .select('*')
      .eq('team_id', teamId)
      .eq('status', 'DONE')
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('agent_studio_audit_logs')
      .select('*')
      .eq('org_id', orgId)
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('agent_studio_mistakes')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('agent_studio_contexts')
      .select('content, key, pinned')
      .eq('org_id', orgId)
      .eq('team_id', teamId)
      .eq('scope', 'TEAM')
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(4),
    supabase.from('agent_studio_orgs').select('paused_at').eq('org_id', orgId).maybeSingle(),
  ]);

  let pendingReviewGates = 0;
  const { data: teamTaskIds } = await supabase.from('agent_studio_tasks').select('id').eq('team_id', teamId);
  const ids = (teamTaskIds ?? []).map((r: { id: string }) => r.id);
  if (ids.length) {
    const { count } = await supabase
      .from('agent_studio_review_gates')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'PENDING')
      .in('task_id', ids);
    pendingReviewGates = count ?? 0;
  }

  const ctxLines = (ctxRes.data as { content: string | null; key: string; pinned: boolean }[]) ?? [];
  const contextSummary =
    ctxLines.length > 0
      ? ctxLines
          .map((c) =>
            c.pinned ? `[pinned] ${c.key}: ${(c.content ?? '').slice(0, 220)}` : `${c.key}: ${(c.content ?? '').slice(0, 180)}`
          )
          .join('\n')
      : null;

  return {
    team,
    agentsTotal: agentsRes.count ?? 0,
    agentsPaused: agentsPausedRes.count ?? 0,
    orchestratorCount: orchRes.count ?? 0,
    tasksTotal: tasksRes.count ?? 0,
    tasksInProgress: tipRes.count ?? 0,
    tasksBlocked: tbRes.count ?? 0,
    tasksInReview: trRes.count ?? 0,
    pendingReviewGates,
    recentCompleted: doneRes.data ?? [],
    recentAudit: auditRes.data ?? [],
    recentMistakes: mistakesRes.data ?? [],
    contextSummary,
    orgPaused: !!(orgRowRes.data as { paused_at?: string | null } | null)?.paused_at,
  };
}
