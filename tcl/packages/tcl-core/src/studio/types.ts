import type { IssueV2, ReviewItem, Suggestion, ValidateOutput } from '../types.js';

/** What triggered a studio TCL pass. */
export type StudioTclTrigger =
  | 'AGENT_RUN_COMPLETE'
  | 'MANUAL'
  | 'IDE_DISPATCH'
  | 'JARVIS_STEP'
  | 'TEAM_EVENT';

export type StudioWorkArtifact = {
  /** Task or spec the agent was asked to satisfy. */
  question: string;
  /** Agent output, diff summary, or combined transcript slice. */
  answer: string;
  /** Grounding: specs, acceptance criteria, repo excerpts, prior context. */
  sources?: Array<{ id: string; text: string; label?: string }>;
  teamId?: string;
  agentId?: string;
  taskId?: string;
  agentRunId?: string;
  teamRunId?: string;
  useCase?: string;
};

export type StudioTclIssueSummary = {
  id: string;
  title: string;
  severity: string;
  category: string;
  whyItMatters: string;
  recommendedAction: string;
};

export type StudioTclReport = {
  analysisId?: string;
  trigger: StudioTclTrigger;
  teamId?: string;
  agentRunId?: string;
  scores: {
    truth: number | null;
    evidence: number | null;
    consistency: number | null;
    overall: number | null;
  };
  refusal: boolean;
  claimCount: number;
  issueCount: number;
  issues: StudioTclIssueSummary[];
  suggestions: Suggestion[];
  /** Compact executive summary when available from engine. */
  summary?: string;
  durationMs: number;
  engineVersion?: string;
};

export type StudioTclAnalysisRow = {
  id: string;
  org_id: string;
  team_id: string;
  agent_run_id: string | null;
  team_run_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  trigger: StudioTclTrigger;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  input_snapshot: StudioWorkArtifact;
  report: StudioTclReport | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

function mapIssueV2ToSummary(i: IssueV2): StudioTclIssueSummary {
  return {
    id: i.issueId,
    title: i.what.issueSummary,
    severity: i.severityDisplay ?? i.severity,
    category: String(i.primaryCategory ?? i.category),
    whyItMatters: i.what.whyItMatters ?? i.what.plainEnglishSummary ?? i.what.issueDetail,
    recommendedAction:
      i.recommendedAction?.explanation ??
      i.what.recommendedActionLabel ??
      'Review and resolve this finding.',
  };
}

function mapReviewItemToSummary(r: ReviewItem): StudioTclIssueSummary {
  return {
    id: r.id,
    title: r.title,
    severity: r.severity,
    category: r.category,
    whyItMatters: r.whyItMatters,
    recommendedAction: r.recommendedAction,
  };
}

export function mapValidateOutputToStudioReport(
  trigger: StudioTclTrigger,
  output: ValidateOutput,
  durationMs: number,
  ctx?: { teamId?: string; agentRunId?: string; analysisId?: string }
): StudioTclReport {
  const fromV2 = output.analysisResult?.issuesV2 ?? [];
  const fromReview = output.report?.reviewItems ?? [];
  const issues: StudioTclIssueSummary[] =
    fromV2.length > 0
      ? fromV2.slice(0, 24).map(mapIssueV2ToSummary)
      : fromReview.slice(0, 24).map(mapReviewItemToSummary);

  const summary =
    output.executiveSummary?.headline ??
    output.dashboardSummary?.plainEnglishSummary ??
    output.dashboardSummary?.title;

  return {
    analysisId: ctx?.analysisId,
    trigger,
    teamId: ctx?.teamId,
    agentRunId: ctx?.agentRunId,
    scores: {
      truth: output.scores.truth ?? null,
      evidence: output.scores.evidenceSupport ?? null,
      consistency: output.scores.consistency ?? null,
      overall: output.scores.tcl ?? output.scores.overall ?? null,
    },
    refusal: output.refusal,
    claimCount: output.report?.claims?.length ?? 0,
    issueCount: issues.length,
    issues,
    suggestions: output.report?.suggestions ?? [],
    summary: typeof summary === 'string' ? summary : undefined,
    durationMs,
    engineVersion: output.engineVersion,
  };
}
