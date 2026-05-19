export type ReviewGateType =
  | 'SPEC_REVIEW'
  | 'CODE_REVIEW'
  | 'SECURITY_REVIEW'
  | 'QA_REVIEW'
  | 'RELEASE_APPROVAL'
  | 'CUSTOM';

export type ReviewMode = 'AUTO_APPROVED' | 'HUMAN' | 'AGENT' | 'MIXED';
export type SwimlaneMode = 'none' | 'agent' | 'priority' | 'type';

export interface BoardReviewPolicy {
  defaultMode: ReviewMode;
  requireGatesBeforeDone: boolean;
  autoCreateGatesOnEnterReview: boolean;
  defaultGateTypes: ReviewGateType[];
}

export interface BoardSettings {
  swimlaneMode: SwimlaneMode;
  reviewPolicy: BoardReviewPolicy;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  swimlaneMode: 'none',
  reviewPolicy: {
    defaultMode: 'HUMAN',
    requireGatesBeforeDone: true,
    autoCreateGatesOnEnterReview: true,
    defaultGateTypes: ['CODE_REVIEW', 'QA_REVIEW'],
  },
};

export function parseBoardSettings(raw: unknown): BoardSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rp =
    o.reviewPolicy && typeof o.reviewPolicy === 'object'
      ? (o.reviewPolicy as Record<string, unknown>)
      : {};
  const swim = o.swimlaneMode;
  const mode = rp.defaultMode;
  const gateTypes = rp.defaultGateTypes;
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
        typeof rp.requireGatesBeforeDone === 'boolean'
          ? rp.requireGatesBeforeDone
          : DEFAULT_BOARD_SETTINGS.reviewPolicy.requireGatesBeforeDone,
      autoCreateGatesOnEnterReview:
        typeof rp.autoCreateGatesOnEnterReview === 'boolean'
          ? rp.autoCreateGatesOnEnterReview
          : DEFAULT_BOARD_SETTINGS.reviewPolicy.autoCreateGatesOnEnterReview,
      defaultGateTypes: Array.isArray(gateTypes)
        ? (gateTypes.filter((g) => typeof g === 'string') as ReviewGateType[])
        : [...DEFAULT_BOARD_SETTINGS.reviewPolicy.defaultGateTypes],
    },
  };
}

export function resolveEffectiveReviewMode(
  boardSettings: BoardSettings,
  taskMetadata: Record<string, unknown> | null | undefined
): ReviewMode {
  const override = taskMetadata?.reviewMode;
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

export function isReviewColumnKey(columnKey: string): boolean {
  const k = columnKey.trim().toLowerCase().replace(/\s+/g, '_');
  return k === 'review' || k === 'in_review' || k === 'approval' || k.includes('review');
}
