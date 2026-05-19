import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseBoardSettings,
  resolveEffectiveReviewMode,
  type BoardSettings,
} from './board-settings.js';

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
  metadata?: Record<string, unknown>;
};

function gateReviewerType(gate: ReviewGateRow): 'human' | 'agent' {
  const m = gate.metadata;
  const t = m && typeof m === 'object' ? (m as Record<string, unknown>).reviewerType : null;
  return t === 'agent' ? 'agent' : 'human';
}

function blockingPendingGates(
  pending: ReviewGateRow[],
  reviewMode: ReturnType<typeof resolveEffectiveReviewMode>
): ReviewGateRow[] {
  if (reviewMode === 'AUTO_APPROVED') {
    return [];
  }
  if (reviewMode === 'AGENT') {
    return pending.filter((g) => gateReviewerType(g) === 'human');
  }
  if (reviewMode === 'MIXED') {
    return pending.filter((g) => gateReviewerType(g) === 'human');
  }
  return pending;
}

async function autoSkipPendingGates(
  supabase: SupabaseClient,
  orgId: string,
  pending: ReviewGateRow[],
  note: string
): Promise<void> {
  if (!pending.length) return;
  const now = new Date().toISOString();
  await supabase
    .from('agent_studio_review_gates')
    .update({
      status: 'SKIPPED',
      comment: note,
      decided_at: now,
    })
    .eq('org_id', orgId)
    .in(
      'id',
      pending.map((g) => g.id)
    );
}

/**
 * When moving a task into a terminal/delivery column, review gates must be
 * APPROVED or SKIPPED — unless board/task policy is AUTO_APPROVED (auto-skip).
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

  const { data: task, error: taskErr } = await supabase
    .from('agent_studio_tasks')
    .select('metadata, board_id')
    .eq('org_id', orgId)
    .eq('id', taskId)
    .maybeSingle();
  if (taskErr) {
    throw new Error(taskErr.message);
  }
  if (!task) {
    return { ok: true };
  }

  let boardSettings: BoardSettings | null = null;
  if (task.board_id) {
    const { data: board } = await supabase
      .from('agent_studio_boards')
      .select('settings')
      .eq('id', task.board_id)
      .maybeSingle();
    boardSettings = parseBoardSettings(board?.settings);
  }

  const reviewMode = resolveEffectiveReviewMode(
    boardSettings ?? parseBoardSettings(null),
    (task.metadata as Record<string, unknown>) ?? {}
  );

  const { data: gates, error } = await supabase
    .from('agent_studio_review_gates')
    .select('id, task_id, gate_type, status, required_role, comment, metadata')
    .eq('org_id', orgId)
    .eq('task_id', taskId);

  if (error) {
    throw new Error(error.message);
  }

  const list = (gates ?? []) as ReviewGateRow[];
  const pending = list.filter((g) => g.status !== 'APPROVED' && g.status !== 'SKIPPED');

  if (reviewMode === 'AUTO_APPROVED' && pending.length > 0) {
    await autoSkipPendingGates(
      supabase,
      orgId,
      pending,
      'Auto-approved by board/task review policy'
    );
    return { ok: true };
  }

  const blocking = blockingPendingGates(pending, reviewMode);

  if (blocking.length > 0) {
    return { ok: false, pendingGates: blocking };
  }

  return { ok: true };
}
