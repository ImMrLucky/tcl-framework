/**
 * Remove specialist agents and re-home open board tasks (Jarvis or unassigned).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { appendTeamEvent } from './team-events.js';

export type AgentTaskDisposition = 'jarvis' | 'unassign';

const OPEN_TASK_STATUSES = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW'] as const;

export interface AgentRemovalImpact {
  agentId: string;
  agentName: string;
  isOrchestrator: boolean;
  assignedOpenTaskCount: number;
  jarvisAgentId: string | null;
  jarvisAgentName: string | null;
  defaultDisposition: AgentTaskDisposition;
}

export interface AgentRemovalResult {
  agentId: string;
  agentName: string;
  teamId: string;
  tasksUpdated: number;
  disposition: AgentTaskDisposition;
  jarvisAgentId: string | null;
}

async function loadAgent(
  supabase: SupabaseClient,
  orgId: string,
  agentId: string
): Promise<{ id: string; name: string; team_id: string; is_orchestrator: boolean } | null> {
  const { data } = await supabase
    .from('agent_studio_agents')
    .select('id, name, team_id, is_orchestrator')
    .eq('id', agentId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data as { id: string; name: string; team_id: string; is_orchestrator: boolean } | null;
}

async function findTeamJarvis(
  supabase: SupabaseClient,
  orgId: string,
  teamId: string,
  excludeAgentId?: string
): Promise<{ id: string; name: string } | null> {
  let q = supabase
    .from('agent_studio_agents')
    .select('id, name')
    .eq('team_id', teamId)
    .eq('org_id', orgId)
    .eq('is_orchestrator', true);
  if (excludeAgentId) {
    q = q.neq('id', excludeAgentId);
  }
  const { data } = await q.maybeSingle();
  return data ? { id: data.id as string, name: data.name as string } : null;
}

async function countOpenAssignedTasks(
  supabase: SupabaseClient,
  orgId: string,
  agentId: string
): Promise<number> {
  const { count } = await supabase
    .from('agent_studio_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('assigned_agent_id', agentId)
    .in('status', [...OPEN_TASK_STATUSES]);
  return count ?? 0;
}

async function listOpenAssignedTasks(
  supabase: SupabaseClient,
  orgId: string,
  agentId: string
): Promise<Array<{ id: string; title: string; metadata: Record<string, unknown> }>> {
  const { data } = await supabase
    .from('agent_studio_tasks')
    .select('id, title, metadata')
    .eq('org_id', orgId)
    .eq('assigned_agent_id', agentId)
    .in('status', [...OPEN_TASK_STATUSES]);
  return (data ?? []) as Array<{ id: string; title: string; metadata: Record<string, unknown> }>;
}

export async function getAgentRemovalImpact(opts: {
  supabase: SupabaseClient;
  orgId: string;
  agentId: string;
}): Promise<AgentRemovalImpact | null> {
  const agent = await loadAgent(opts.supabase, opts.orgId, opts.agentId);
  if (!agent) return null;

  const jarvis = await findTeamJarvis(opts.supabase, opts.orgId, agent.team_id, agent.id);
  const assignedOpenTaskCount = await countOpenAssignedTasks(opts.supabase, opts.orgId, agent.id);

  return {
    agentId: agent.id,
    agentName: agent.name,
    isOrchestrator: !!agent.is_orchestrator,
    assignedOpenTaskCount,
    jarvisAgentId: jarvis?.id ?? null,
    jarvisAgentName: jarvis?.name ?? null,
    defaultDisposition: jarvis ? 'jarvis' : 'unassign',
  };
}

export async function removeAgentWithTaskHandling(opts: {
  supabase: SupabaseClient;
  orgId: string;
  agentId: string;
  userId: string | null;
  taskDisposition?: AgentTaskDisposition | null;
}): Promise<
  | { ok: true; result: AgentRemovalResult }
  | { ok: false; status: number; error: string }
> {
  const agent = await loadAgent(opts.supabase, opts.orgId, opts.agentId);
  if (!agent) {
    return { ok: false, status: 404, error: 'Agent not found' };
  }
  if (agent.is_orchestrator) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot remove the team orchestrator (Jarvis). Pause the agent instead.',
    };
  }

  const jarvis = await findTeamJarvis(opts.supabase, opts.orgId, agent.team_id, agent.id);
  let disposition: AgentTaskDisposition = opts.taskDisposition ?? (jarvis ? 'jarvis' : 'unassign');
  if (disposition === 'jarvis' && !jarvis) {
    disposition = 'unassign';
  }

  const tasks = await listOpenAssignedTasks(opts.supabase, opts.orgId, agent.id);
  const now = new Date().toISOString();

  for (const task of tasks) {
    const priorMeta = (task.metadata ?? {}) as Record<string, unknown>;
    const metadata = {
      ...priorMeta,
      reassignment: {
        fromAgentId: agent.id,
        fromAgentName: agent.name,
        at: now,
        reason: 'agent_removed',
        disposition,
      },
      needsReassignment: disposition === 'unassign',
    };
    const patch: Record<string, unknown> = {
      metadata,
      updated_at: now,
    };
    patch.assigned_agent_id = disposition === 'jarvis' && jarvis ? jarvis.id : null;

    const { error } = await opts.supabase
      .from('agent_studio_tasks')
      .update(patch)
      .eq('id', task.id)
      .eq('org_id', opts.orgId);
    if (error) {
      return { ok: false, status: 500, error: `Failed to update task "${task.title}": ${error.message}` };
    }
  }

  const { error: deleteError } = await opts.supabase
    .from('agent_studio_agents')
    .delete()
    .eq('id', agent.id)
    .eq('org_id', opts.orgId);
  if (deleteError) {
    return { ok: false, status: 500, error: deleteError.message };
  }

  if (tasks.length) {
    await appendTeamEvent({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId: agent.team_id,
      agentId: jarvis?.id ?? null,
      eventType: 'agent.removed_tasks_rehomed',
      actorType: 'USER',
      actorName: opts.userId,
      summary:
        disposition === 'jarvis' && jarvis
          ? `Removed ${agent.name}; ${tasks.length} open task(s) assigned to ${jarvis.name} for reassignment.`
          : `Removed ${agent.name}; ${tasks.length} open task(s) unassigned for reassignment.`,
      jsonl: {
        removedAgentId: agent.id,
        removedAgentName: agent.name,
        taskIds: tasks.map((t) => t.id),
        disposition,
        jarvisAgentId: jarvis?.id ?? null,
      },
    });
  }

  return {
    ok: true,
    result: {
      agentId: agent.id,
      agentName: agent.name,
      teamId: agent.team_id,
      tasksUpdated: tasks.length,
      disposition,
      jarvisAgentId: jarvis?.id ?? null,
    },
  };
}
