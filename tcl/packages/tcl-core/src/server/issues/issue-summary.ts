/**
 * Issue Summary Computation
 * 
 * Computes IssueSummaryV2 from an array of IssueV2 objects.
 * Used for read-time backfill when issueSummaryV2 is missing from older evaluations.
 */

import type { IssueV2, IssueSummaryV2, SeverityV2, IssueTypeV2, IssueCategoryV2 } from '../../types.js';

/**
 * Compute IssueSummaryV2 from an array of IssueV2 issues
 * 
 * Rules:
 * - Prefer severityDisplay over severity for display counts
 * - Normalize severity to: low | medium | high | critical
 * - Count by type, category, and severity
 * - Handle missing fields gracefully
 */
export function computeIssueSummaryV2(issues: IssueV2[]): IssueSummaryV2 {
  if (!issues || issues.length === 0) {
    return {
      totalIssues: 0,
      byType: {} as Record<IssueTypeV2, number>,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
      byCategory: {} as Record<IssueCategoryV2, number>,
      topIssuesCount: 0,
      allIssuesCount: 0,
    };
  }

  // Initialize counters
  const byType: Record<string, number> = {};
  const bySeverity: Record<SeverityV2, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const byCategory: Record<string, number> = {};

  // Count issues
  for (const issue of issues) {
    // Count by type
    const type = issue.type || 'OTHER';
    byType[type] = (byType[type] || 0) + 1;

    // Count by category
    const category = issue.category || 'other';
    byCategory[category] = (byCategory[category] || 0) + 1;

    // Count by severity - prefer severityDisplay, fall back to severity
    const severity = (issue.severityDisplay || issue.severity || 'medium') as SeverityV2;
    
    // Normalize severity to valid values only
    if (severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'critical') {
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    } else {
      // Unknown severity - count as medium (safe default)
      bySeverity.medium = (bySeverity.medium || 0) + 1;
    }
  }

  return {
    totalIssues: issues.length,
    byType: byType as Record<IssueTypeV2, number>,
    bySeverity,
    byCategory: byCategory as Record<IssueCategoryV2, number>,
    topIssuesCount: issues.length, // If we're computing from allIssuesV2, topIssuesCount = allIssuesCount
    allIssuesCount: issues.length,
  };
}

/**
 * Check if issueSummaryV2 is missing or incomplete
 */
export function isIssueSummaryV2MissingOrIncomplete(
  summary: any,
  issueCount: number
): boolean {
  // Missing entirely
  if (!summary) {
    return true;
  }

  // Missing bySeverity
  if (!summary.bySeverity) {
    return true;
  }

  // All severities are zero but we have issues
  const bySeverity = summary.bySeverity;
  const totalSeverityCount = (bySeverity.low || 0) + 
                              (bySeverity.medium || 0) + 
                              (bySeverity.high || 0) + 
                              (bySeverity.critical || 0);
  
  if (totalSeverityCount === 0 && issueCount > 0) {
    return true;
  }

  return false;
}

