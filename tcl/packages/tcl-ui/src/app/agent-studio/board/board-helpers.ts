import {
  Agent,
  BoardSettings,
  DEFAULT_BOARD_SETTINGS,
  ReviewGate,
  ReviewMode,
  Task,
  TaskPriority,
  TaskType,
} from '../agent-studio.types';

export function parseBoardSettings(raw: unknown): BoardSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_BOARD_SETTINGS, reviewPolicy: { ...DEFAULT_BOARD_SETTINGS.reviewPolicy, defaultGateTypes: [...DEFAULT_BOARD_SETTINGS.reviewPolicy.defaultGateTypes] } };
  }
  const o = raw as Record<string, unknown>;
  const rp =
    o['reviewPolicy'] && typeof o['reviewPolicy'] === 'object'
      ? (o['reviewPolicy'] as Record<string, unknown>)
      : {};
  const swim = o['swimlaneMode'];
  const mode = rp['defaultMode'];
  const gateTypes = rp['defaultGateTypes'];
  return {
    swimlaneMode:
      swim === 'agent' || swim === 'priority' || swim === 'type' || swim === 'none'
        ? swim
        : DEFAULT_BOARD_SETTINGS.swimlaneMode,
    reviewPolicy: {
      defaultMode:
        mode === 'AUTO_APPROVED' ||
        mode === 'HUMAN' ||
        mode === 'AGENT' ||
        mode === 'MIXED'
          ? mode
          : DEFAULT_BOARD_SETTINGS.reviewPolicy.defaultMode,
      requireGatesBeforeDone:
        typeof rp['requireGatesBeforeDone'] === 'boolean'
          ? rp['requireGatesBeforeDone']
          : DEFAULT_BOARD_SETTINGS.reviewPolicy.requireGatesBeforeDone,
      autoCreateGatesOnEnterReview:
        typeof rp['autoCreateGatesOnEnterReview'] === 'boolean'
          ? rp['autoCreateGatesOnEnterReview']
          : DEFAULT_BOARD_SETTINGS.reviewPolicy.autoCreateGatesOnEnterReview,
      defaultGateTypes: Array.isArray(gateTypes)
        ? (gateTypes.filter((g) => typeof g === 'string') as BoardSettings['reviewPolicy']['defaultGateTypes'])
        : [...DEFAULT_BOARD_SETTINGS.reviewPolicy.defaultGateTypes],
    },
  };
}

export function resolveEffectiveReviewMode(
  boardSettings: BoardSettings,
  task: Task
): ReviewMode {
  const override = task.metadata?.['reviewMode'];
  if (
    override === 'AUTO_APPROVED' ||
    override === 'HUMAN' ||
    override === 'AGENT' ||
    override === 'MIXED'
  ) {
    return override;
  }
  return boardSettings.reviewPolicy.defaultMode;
}

export function normalizeColumnKey(columnKey: string): string {
  return columnKey.trim().toLowerCase().replace(/\s+/g, '_');
}

export function isReviewColumn(columnKey: string): boolean {
  const k = normalizeColumnKey(columnKey);
  return k === 'review' || k === 'in_review' || k === 'approval' || k.includes('review');
}

export function isTerminalColumn(columnKey: string): boolean {
  const k = normalizeColumnKey(columnKey);
  return k === 'done' || k === 'ready_for_delivery' || k === 'release' || k === 'delivery';
}

/** Approximate % complete from column position + status (for board UX). */
export function estimateTaskProgressPercent(
  task: Task,
  columns: Array<{ key: string }>
): number {
  if (task.status === 'DONE' || task.status === 'CANCELLED') {
    return task.status === 'DONE' ? 100 : 0;
  }
  const stored = task.metadata?.['progressPercent'];
  if (typeof stored === 'number' && stored >= 0 && stored <= 100) {
    return Math.round(stored);
  }
  const keys = columns.map((c) => normalizeColumnKey(c.key));
  const idx = keys.indexOf(normalizeColumnKey(task.column_key));
  if (idx < 0) {
    if (task.status === 'IN_PROGRESS') return 40;
    if (task.status === 'REVIEW') return 75;
    if (task.status === 'BLOCKED') return 15;
    return 5;
  }
  const terminalIdx = keys.findIndex((k) => isTerminalColumn(k));
  const denom = terminalIdx > 0 ? terminalIdx : Math.max(keys.length - 1, 1);
  const base = Math.round((idx / denom) * 85);
  if (task.status === 'IN_PROGRESS') return Math.min(95, base + 10);
  if (task.status === 'REVIEW') return Math.min(98, base + 15);
  if (task.status === 'BLOCKED') return Math.max(5, base - 10);
  return Math.max(0, Math.min(100, base));
}

export function boardOverallProgress(
  tasks: Task[],
  columns: Array<{ key: string }>
): { done: number; total: number; percent: number } {
  const active = tasks.filter((t) => t.status !== 'CANCELLED');
  const total = active.length;
  if (!total) return { done: 0, total: 0, percent: 0 };
  let sum = 0;
  let done = 0;
  for (const t of active) {
    const p = estimateTaskProgressPercent(t, columns);
    sum += p;
    if (p >= 100 || t.status === 'DONE') done += 1;
  }
  return { done, total, percent: Math.round(sum / total) };
}

export interface Swimlane {
  key: string;
  label: string;
}

export function buildSwimlanes(
  mode: BoardSettings['swimlaneMode'],
  tasks: Task[],
  agents: Agent[]
): Swimlane[] {
  if (mode === 'none') {
    return [{ key: '_all', label: '' }];
  }
  if (mode === 'agent') {
    const lanes: Swimlane[] = [{ key: '_unassigned', label: 'Unassigned' }];
    const seen = new Set<string>();
    for (const a of agents) {
      lanes.push({ key: a.id, label: a.name });
      seen.add(a.id);
    }
    for (const t of tasks) {
      if (t.assigned_agent_id && !seen.has(t.assigned_agent_id)) {
        lanes.push({ key: t.assigned_agent_id, label: 'Unknown agent' });
        seen.add(t.assigned_agent_id);
      }
    }
    return lanes;
  }
  if (mode === 'priority') {
    const order: TaskPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    return order.map((p) => ({ key: p, label: p }));
  }
  if (mode === 'type') {
    const types = new Set<TaskType>();
    for (const t of tasks) types.add(t.task_type);
    const order: TaskType[] = ['STORY', 'BUG', 'SPEC', 'REVIEW', 'SPIKE', 'RESEARCH', 'CHORE'];
    return order.filter((t) => types.has(t)).map((t) => ({ key: t, label: t }));
  }
  return [{ key: '_all', label: '' }];
}

export function swimlaneKeyForTask(mode: BoardSettings['swimlaneMode'], task: Task): string {
  if (mode === 'none') return '_all';
  if (mode === 'agent') return task.assigned_agent_id ?? '_unassigned';
  if (mode === 'priority') return task.priority;
  if (mode === 'type') return task.task_type;
  return '_all';
}

export type TaskApprovalBadge =
  | 'none'
  | 'pending'
  | 'changes'
  | 'rejected'
  | 'approved'
  | 'auto';

export function taskApprovalBadge(
  gates: ReviewGate[],
  reviewMode: ReviewMode
): TaskApprovalBadge {
  if (!gates.length) {
    return reviewMode === 'AUTO_APPROVED' ? 'auto' : 'none';
  }
  if (gates.some((g) => g.status === 'REJECTED')) return 'rejected';
  if (gates.some((g) => g.status === 'CHANGES_REQUESTED')) return 'changes';
  if (gates.some((g) => g.status === 'PENDING')) return 'pending';
  if (gates.every((g) => g.status === 'APPROVED' || g.status === 'SKIPPED')) {
    return reviewMode === 'AUTO_APPROVED' ? 'auto' : 'approved';
  }
  return 'pending';
}

export function pendingGateCount(gates: ReviewGate[]): number {
  return gates.filter((g) => g.status === 'PENDING' || g.status === 'CHANGES_REQUESTED').length;
}

export function dropListId(columnKey: string, laneKey: string): string {
  return `col::${encodeURIComponent(columnKey)}::lane::${encodeURIComponent(laneKey)}`;
}

export function parseDropListId(id: string): { columnKey: string; laneKey: string } | null {
  const m = /^col::([^:]*)::lane::(.+)$/.exec(id);
  if (!m) return null;
  try {
    return { columnKey: decodeURIComponent(m[1]), laneKey: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}
