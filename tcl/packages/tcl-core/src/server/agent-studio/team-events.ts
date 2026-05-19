import type { SupabaseClient } from '@supabase/supabase-js';

export type TeamEventActorType = 'SYSTEM' | 'USER' | 'AGENT' | 'JARVIS' | 'LOCAL_RUNNER';

export async function appendTeamEvent(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  eventType: string;
  summary: string;
  actorType?: TeamEventActorType;
  actorName?: string | null;
  teamRunId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  jsonl?: Record<string, unknown>;
}): Promise<{ id: string; sequence: number } | null> {
  const { data, error } = await opts.supabase
    .from('agent_studio_team_event_log')
    .insert({
      org_id: opts.orgId,
      team_id: opts.teamId,
      team_run_id: opts.teamRunId ?? null,
      agent_id: opts.agentId ?? null,
      task_id: opts.taskId ?? null,
      event_type: opts.eventType,
      actor_type: opts.actorType ?? 'SYSTEM',
      actor_name: opts.actorName ?? null,
      summary: opts.summary,
      jsonl: opts.jsonl ?? {},
    })
    .select('id, sequence')
    .single();
  if (error) {
    console.warn('[agent-studio][team-events] insert failed', error.message);
    return null;
  }
  return { id: data.id as string, sequence: Number(data.sequence) };
}
