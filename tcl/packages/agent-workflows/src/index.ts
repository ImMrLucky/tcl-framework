/**
 * agent-workflows — workflow state-machine helpers.
 *
 * The full workflow templates (generic delivery, BMAD Workflow Pack, Bug Fix Flow, etc.) live as JSON in
 * `packages/agent-core/templates/workflows.json`. This package describes the
 * minimal runtime shape and a single `evaluateTransition` helper.
 */

export interface WorkflowColumn {
  key: string;
  label: string;
}

export interface WorkflowReviewGate {
  afterColumnKey: string;
  gateType:
    | 'SPEC_REVIEW'
    | 'CODE_REVIEW'
    | 'SECURITY_REVIEW'
    | 'QA_REVIEW'
    | 'RELEASE_APPROVAL'
    | 'CUSTOM';
  requiredRole?: string;
}

export interface WorkflowDefinition {
  key: string;
  name: string;
  columns: WorkflowColumn[];
  reviewGates: WorkflowReviewGate[];
}

export type TransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: string }
  | { allowed: false; reason: 'GATE_REQUIRED'; gate: WorkflowReviewGate };

/**
 * Evaluate whether a card can move from `fromColumnKey` to `toColumnKey`.
 *
 * Rules:
 *   - The destination column must exist in the workflow.
 *   - You can move forward, backward, or skip — but if any review gate fires
 *     on the column you're leaving, the move is blocked until that gate is
 *     marked APPROVED by the caller.
 */
export function evaluateTransition(
  workflow: WorkflowDefinition,
  fromColumnKey: string,
  toColumnKey: string,
  approvedGateKeys: string[]
): TransitionDecision {
  const dest = workflow.columns.find((c) => c.key === toColumnKey);
  if (!dest) {
    return { allowed: false, reason: `Unknown column: ${toColumnKey}` };
  }

  const blockingGate = workflow.reviewGates.find(
    (g) =>
      g.afterColumnKey === fromColumnKey && !approvedGateKeys.includes(`${g.afterColumnKey}:${g.gateType}`)
  );

  if (blockingGate) {
    return { allowed: false, reason: 'GATE_REQUIRED', gate: blockingGate };
  }

  return { allowed: true };
}
