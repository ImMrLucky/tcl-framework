/** Re-exports analysis contract types from `types.ts` for stable import path `types/analysis-result`. */
export type {
  ScoreBandV2 as ScoreBand,
  ScoredMetricV2 as ScoredMetric,
  EvidenceRefViewV2 as EvidenceRefView,
  AnalysisIssueV2 as AnalysisIssue,
  EvidenceCoverageStatsV2 as EvidenceCoverageStats,
  ClaimTimelineEventV2 as ClaimTimelineEvent,
  AnalysisResultPayload,
} from "../types.js";

export type { AnalysisResultPayload as AnalysisResult } from "../types.js";
