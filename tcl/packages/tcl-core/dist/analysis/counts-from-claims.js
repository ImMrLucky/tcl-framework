/**
 * Compute counts from ClaimResults - Single Source of Truth
 *
 * All counts must be derived from ClaimResults, not re-computed separately.
 */
/**
 * Compute counts from ClaimResults array
 */
export function computeCountsFromClaims(claimResults, config) {
    const counts = {
        claims: claimResults.length,
        supported: 0,
        contradicted: 0,
        ungrounded: 0,
        inconclusive: 0,
        verified: 0,
        unverified: 0,
        supportEdges: 0,
        contradictionEdges: 0,
        contradictionsAboveThreshold: 0,
    };
    const contradictedThreshold = config.thresholds.contradictedThreshold ?? config.thresholds.contradictionThreshold;
    for (const result of claimResults) {
        // Count by final truth state
        switch (result.finalTruthState) {
            case 'Supported':
                counts.supported++;
                break;
            case 'Contradicted':
                counts.contradicted++;
                break;
            case 'Ungrounded':
                counts.ungrounded++;
                break;
            case 'Inconclusive':
                counts.inconclusive++;
                break;
        }
        // Count verification status
        if (result.verification.kind === 'external_verified') {
            counts.verified++;
        }
        else if (result.verification.kind === 'transcript_only') {
            counts.unverified++;
        }
        // Count edges
        counts.supportEdges += result.edges.supportEdges.length;
        counts.contradictionEdges += result.edges.contradictionEdges.length;
        // Count contradictions above threshold
        if (result.edges.maxContradictionWeight >= contradictedThreshold) {
            counts.contradictionsAboveThreshold++;
        }
    }
    return counts;
}
/**
 * Generate definitions strings from EngineConfig
 */
export function generateDefinitions(config) {
    const contradictedThreshold = config.thresholds.contradictedThreshold ?? config.thresholds.contradictionThreshold;
    return {
        supported: `Claims with finalTruthState="Supported" AND maxContradictionWeight < ${contradictedThreshold.toFixed(2)} AND maxSupportWeight >= ${config.thresholds.supportThreshold.toFixed(2)}.`,
        contradicted: `Claims with finalTruthState="Contradicted" OR maxContradictionWeight >= ${contradictedThreshold.toFixed(2)}.`,
        ungrounded: `Claims with finalTruthState="Ungrounded" (grounding.kind="none" AND no evidenceIds).`,
        unverified: `Claims with verification.kind="transcript_only" (has transcript evidence but not verified against external documents).`,
    };
}
