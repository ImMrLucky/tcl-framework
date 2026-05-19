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
