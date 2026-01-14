/**
 * Issue Summary Computation
 *
 * Computes IssueSummaryV2 from an array of IssueV2 objects.
 * Used for read-time backfill when issueSummaryV2 is missing from older evaluations.
 */
/**
 * Compute IssueSummaryV2 from an array of IssueV2 issues
 *
 * Rules:
 * - Executive summary should count impact severity (severity), NOT display severity (severityDisplay)
 * - This ensures high/critical counts are accurate regardless of transcript-only mode
 * - severityDisplay is only for UI convenience, not for analytics
 * - Normalize severity to: low | medium | high | critical
 * - Count by type, category, and severity
 * - Handle missing fields gracefully
 */
export function computeIssueSummaryV2(issues) {
    if (!issues || issues.length === 0) {
        return {
            totalIssues: 0,
            byType: {},
            bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
            byCategory: {},
            topIssuesCount: 0,
            allIssuesCount: 0,
        };
    }
    // Initialize counters
    const byType = {};
    const bySeverity = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
    };
    const byCategory = {};
    // Count issues
    for (const issue of issues) {
        // Count by type
        const type = issue.type || 'OTHER';
        byType[type] = (byType[type] || 0) + 1;
        // Count by category
        const category = issue.category || 'other';
        byCategory[category] = (byCategory[category] || 0) + 1;
        // Count by severity: use severity (canonical)
        const sev = (issue.severity ?? 'medium');
        // Normalize severity to valid values only
        if (sev === 'low' || sev === 'medium' || sev === 'high' || sev === 'critical') {
            bySeverity[sev] = (bySeverity[sev] || 0) + 1;
        }
        else {
            // Unknown severity - count as medium (safe default)
            bySeverity.medium = (bySeverity.medium || 0) + 1;
        }
    }
    // CRITICAL: When computing from allIssuesV2, we don't know the topIssuesCount
    // In this case, set both to the same value (all issues are included)
    // The correct distinction (topIssuesCount vs allIssuesCount) should come from rankIssuesV2 summary
    return {
        totalIssues: issues.length,
        byType: byType,
        bySeverity,
        byCategory: byCategory,
        topIssuesCount: issues.length, // When computed from allIssuesV2, assume all are "top" (no filtering)
        allIssuesCount: issues.length, // Total count of all issues
    };
}
/**
 * Check if issueSummaryV2 is missing or incomplete
 */
export function isIssueSummaryV2MissingOrIncomplete(summary, issueCount) {
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
