import type { SupabaseClient } from '@supabase/supabase-js';

/** Column keys that imply delivery / completion — require review gates cleared. */
const TERMINAL_NORMALIZED = new Set(['done', 'ready_for_delivery', 'release', 'delivery']);

function normalizeColumnKey(columnKey: string): string {
  return columnKey.trim().toLowerCase().replace(/\s+/g, '_');
}

export function isTerminalDeliveryColumn(columnKey: string): boolean {
  return TERMINAL_NORMALIZED.has(normalizeColumnKey(columnKey));
}

export type ReviewGateRow = {
  id: string;
  task_id: string;
  gate_type: string;
  status: string;
  required_role: string | null;
  comment: string | null;
};

/**
 * When moving a task into a terminal/delivery column, every review gate must be
 * APPROVED or SKIPPED. PENDING, CHANGES_REQUESTED, or REJECTED blocks the move.
 */
export async function assertReviewGatesAllowTerminalMove(
  supabase: SupabaseClient,
  orgId: string,
  taskId: string,
  newColumnKey: string
): Promise<{ ok: true } | { ok: false; pendingGates: ReviewGateRow[] }> {
  if (!isTerminalDeliveryColumn(newColumnKey)) {
    return { ok: true };
  }

  const { data: gates, error } = await supabase
    .from('agent_studio_review_gates')
    .select('id, task_id, gate_type, status, required_role, comment')
    .eq('org_id', orgId)
    .eq('task_id', taskId);

  if (error) {
    throw new Error(error.message);
  }

  const list = (gates ?? []) as ReviewGateRow[];
  const pending = list.filter((g) => g.status !== 'APPROVED' && g.status !== 'SKIPPED');

  if (pending.length > 0) {
    return { ok: false, pendingGates: pending };
  }

  return { ok: true };
}
