/**
 * Executive Summary V3
 *
 * Computes summary counts from TclIssueV3 list.
 * Returns both severity counts (by impact) and confidence band counts.
 */
import type { TclIssueV3, SeverityCounts, VerificationCounts } from '../contracts/issue.contract.js';
export interface IssueSummaryV3 {
    totalIssues: number;
    severityCountsImpact: SeverityCounts;
    severityCountsByConfidenceBand: {
        high: SeverityCounts;
        medium: SeverityCounts;
        low: SeverityCounts;
    };
    verificationCounts: VerificationCounts;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
}
/**
 * Compute executive summary from TclIssueV3 list
 *
 * Rules:
 * - Compute counts from the same list you render
 * - Return both severityCountsImpact and severityCountsByConfidenceBand
 * - Never compute summary off a legacy issues array
 */
export declare function computeIssueSummaryV3(issues: TclIssueV3[]): IssueSummaryV3;
