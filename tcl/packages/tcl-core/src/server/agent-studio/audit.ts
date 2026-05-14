/**
 * Agent Studio audit log writer.
 *
 * Intentionally separate from the platform-wide `audit_logs` table so we can
 * evolve event shape without coordinating with the rest of TCL. Spec decision
 * captured in docs/specs/agent-studio.md.
 */

import { supabaseAdmin } from '../supabase.js';

export type AgentStudioActorKind = 'USER' | 'AGENT' | 'SYSTEM';

export interface AgentStudioAuditEvent {
  orgId: string;
  teamId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  actorUserId?: string | null;
  actorKind?: AgentStudioActorKind;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit write. Never throws — failures are logged and
 * swallowed so the calling route can still respond successfully.
 */
export async function logAgentStudioAudit(event: AgentStudioAuditEvent): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('agent_studio_audit_logs').insert({
      org_id: event.orgId,
      team_id: event.teamId ?? null,
      agent_id: event.agentId ?? null,
      task_id: event.taskId ?? null,
      actor_user_id: event.actorUserId ?? null,
      actor_kind: event.actorKind ?? 'USER',
      event_type: event.eventType,
      resource_type: event.resourceType ?? null,
      resource_id: event.resourceId ?? null,
      payload: event.payload ?? {},
    });
  } catch (err) {
    console.warn('[agent-studio][audit] failed to write event', event.eventType, err);
  }
}
