/**
 * Executive Summary V3
 *
 * Computes summary counts from TclIssueV3 list.
 * Returns both severity counts (by impact) and confidence band counts.
 */
/**
 * Compute executive summary from TclIssueV3 list
 *
 * Rules:
 * - Compute counts from the same list you render
 * - Return both severityCountsImpact and severityCountsByConfidenceBand
 * - Never compute summary off a legacy issues array
 */
export function computeIssueSummaryV3(issues) {
    if (!issues || issues.length === 0) {
        return {
            totalIssues: 0,
            severityCountsImpact: { critical: 0, high: 0, medium: 0, low: 0 },
            severityCountsByConfidenceBand: {
                high: { critical: 0, high: 0, medium: 0, low: 0 },
                medium: { critical: 0, high: 0, medium: 0, low: 0 },
                low: { critical: 0, high: 0, medium: 0, low: 0 },
            },
            verificationCounts: {
                TRANSCRIPT_ONLY: 0,
                DOC_BACKED: 0,
                EXTERNALLY_VERIFIED: 0,
            },
            byType: {},
            byCategory: {},
        };
    }
    // Initialize counters
    const severityCountsImpact = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
    };
    const severityCountsByConfidenceBand = {
        high: { critical: 0, high: 0, medium: 0, low: 0 },
        medium: { critical: 0, high: 0, medium: 0, low: 0 },
        low: { critical: 0, high: 0, medium: 0, low: 0 },
    };
    const verificationCounts = {
        TRANSCRIPT_ONLY: 0,
        DOC_BACKED: 0,
        EXTERNALLY_VERIFIED: 0,
    };
    const byType = {};
    const byCategory = {};
    // Count issues
    for (const issue of issues) {
        // Count by impact severity (mode-independent)
        severityCountsImpact[issue.impactSeverity]++;
        // Count by confidence band + severity
        const bandCounts = severityCountsByConfidenceBand[issue.confidenceBand];
        bandCounts[issue.impactSeverity]++;
        // Count by verification level
        verificationCounts[issue.verificationLevel]++;
        // Count by type
        byType[issue.type] = (byType[issue.type] || 0) + 1;
        // Count by category
        byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
    }
    return {
        totalIssues: issues.length,
        severityCountsImpact,
        severityCountsByConfidenceBand,
        verificationCounts,
        byType,
        byCategory,
    };
}
