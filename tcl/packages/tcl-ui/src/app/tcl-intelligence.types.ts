/**
 * TCL — Conversation Truth & Risk Intelligence (client models)
 * Aligns with @tcl/core validate output & persisted evaluation.report payloads.
 */

export type RiskLevelUi = 'low' | 'medium' | 'high' | 'critical';

export interface TclRiskBlockUi {
  level?: RiskLevelUi;
  primaryRisk?: string;
  reviewRequired?: boolean;
  recommendedAction?: string;
  businessImpact?: string;
  criticalCount?: number;
  highCount?: number;
  mediumCount?: number;
  lowCount?: number;
}

export interface TclDiagnosticsUi {
  status?: string;
  speakerConfidence?: number;
  claimContaminationIndex?: number;
  contaminatedClaims?: unknown[];
  unknownSpeakerLines?: number;
  agentClaimCount?: number;
  customerClaimCount?: number;
  aiClaimCount?: number;
  systemClaimCount?: number;
  evidenceGapCount?: number;
  driftIssueCount?: number;
  hallucinationIssueCount?: number;
  complianceIssueCount?: number;
}

export interface ConversationTrustScoreUi {
  label?: string;
  score?: number;
  subtitle?: string;
}

export interface DashboardRiskItemUi {
  title?: string;
  quote?: string;
  speaker?: string;
  turnIndex?: number;
  whyItMatters?: string;
  recommendedFix?: string;
  severity?: string;
}

export interface DashboardUnsupportedUi {
  claimText?: string;
  missingEvidence?: string[];
  requiredSource?: string;
  recommendedEvidenceSource?: string;
}

export interface DashboardDriftUi {
  earlierQuote?: string;
  laterQuote?: string;
  driftType?: string;
  recommendedFix?: string;
}

export interface BusinessInsightUi {
  type?: string;
  summary?: string;
  evidenceQuote?: string;
  speaker?: string;
  turnIndex?: number;
  confidence?: number;
  recommendedAction?: string;
  businessImpact?: string;
}

export interface DashboardSummaryUi {
  title?: string;
  subtitle?: string;
  dashboardMode?: 'protectqa' | 'tcl';
  plainEnglishSummary?: string;
  conversationTrustScore?: ConversationTrustScoreUi;
  topRisks?: DashboardRiskItemUi[];
  topUnsupportedClaims?: DashboardUnsupportedUi[];
  topDriftEvents?: DashboardDriftUi[];
  topBusinessInsights?: BusinessInsightUi[];
  nextBestActions?: string[];
}

/** Extended numeric scores returned from risk-adjusted pipeline */
export interface TclExtendedScoresUi {
  tcl?: number | null;
  overall?: number | null;
  truth?: number | null;
  transcriptGrounding?: number | null;
  compliance?: number | null;
  hallucination?: number | null;
  drift?: number | null;
  consistency?: number | null;
  coherence?: number | null;
  evidenceSupport?: number | null;
  speakerConfidence?: number | null;
  businessValue?: number | null;
}
