/**
 * Risk Ranking Module
 *
 * Computes deterministic risk scores and ranks issues.
 * All thresholds and weights come from config - NO hard-coded values.
 *
 * NEW PIPELINE (no saturation, no circularity):
 * - impact01 from issue.impact
 * - evidence01 from issue.verification.level
 * - signal01 from graph + spectral (graceful degrade)
 * - category01 from config
 * - risk01 = weighted average
 * - severity derived from risk01
 * - severityDisplay capped for mode
 */
import type { IssueV2, SeverityV2 } from '../types.js';
import { type RiskRankingConfig } from '../config/risk-ranking.js';
export interface RankedIssues {
    allIssues: IssueV2[];
    topIssues: IssueV2[];
    summary: {
        totalIssues: number;
        byType: Record<string, number>;
        bySeverity: Record<SeverityV2, number>;
        byCategory: Record<string, number>;
        topIssuesCount: number;
        allIssuesCount: number;
    };
}
export interface ScoringContext {
    mode: 'transcript_only' | 'with_evidence';
    numSources: number;
    graphStatus?: string;
    templateId?: string;
    isRegulatedTemplate?: boolean;
}
/**
 * Rank issues by risk score (deterministic)
 * Uses new pipeline: impact + evidence + signal + category → risk01 → severity
 */
export declare function rankIssuesV2(issues: IssueV2[], config?: RiskRankingConfig, scoringContext?: ScoringContext): RankedIssues;
