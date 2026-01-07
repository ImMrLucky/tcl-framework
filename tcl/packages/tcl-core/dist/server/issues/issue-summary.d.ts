/**
 * Issue Summary Computation
 *
 * Computes IssueSummaryV2 from an array of IssueV2 objects.
 * Used for read-time backfill when issueSummaryV2 is missing from older evaluations.
 */
import type { IssueV2, IssueSummaryV2 } from '../../types.js';
/**
 * Compute IssueSummaryV2 from an array of IssueV2 issues
 *
 * Rules:
 * - Prefer severityDisplay over severity for display counts
 * - Normalize severity to: low | medium | high | critical
 * - Count by type, category, and severity
 * - Handle missing fields gracefully
 */
export declare function computeIssueSummaryV2(issues: IssueV2[]): IssueSummaryV2;
/**
 * Check if issueSummaryV2 is missing or incomplete
 */
export declare function isIssueSummaryV2MissingOrIncomplete(summary: any, issueCount: number): boolean;
