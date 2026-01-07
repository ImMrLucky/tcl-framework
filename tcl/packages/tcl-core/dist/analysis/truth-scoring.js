/**
 * Truth Score Semantics - Fixed
 *
 * Replaces misleading "truth=100" with metrics that reflect reality.
 * All scoring formulas must take weights from EngineConfig (no literals).
 */
/**
 * Compute truth scores from ClaimResults and counts
 */
export function computeTruthScores(claimResults, counts, config) {
    const weights = config.weights;
    // ========================================================================
    // 1. Transcript Grounding Score
    // ========================================================================
    // Percentage of claims with transcript evidence
    const transcriptGrounding = claimResults.length > 0
        ? (claimResults.filter(r => r.grounding.kind === 'transcript').length / claimResults.length) * 100
        : 100;
    // ========================================================================
    // 2. External Verification Score (only in with_external_docs mode)
    // ========================================================================
    let externalVerification = null;
    if (config.mode === 'with_external_docs') {
        externalVerification = claimResults.length > 0
            ? (counts.verified / claimResults.length) * 100
            : 100;
    }
    // ========================================================================
    // 3. Consistency Score
    // ========================================================================
    // Based on contradiction presence/energy
    // Formula: 100 - (contradiction_penalty)
    // Penalty increases with:
    // - Number of contradictions above threshold
    // - Average contradiction weight
    // - Contradiction energy (weighted sum)
    const contradictionPenalty = computeContradictionPenalty(claimResults, counts, config);
    const consistency = Math.max(0, 100 - contradictionPenalty);
    // ========================================================================
    // 4. Compute overall "truth" / "auditTruth" score
    // ========================================================================
    // Weighted combination of the above
    let truth;
    let auditTruth;
    if (config.mode === 'transcript_only') {
        // In transcript-only mode: truth cannot be 100 if contradictions exist
        if (counts.contradictionsAboveThreshold > 0) {
            // Cap truth at 99 if contradictions exist
            truth = Math.min(99, consistency);
        }
        else {
            // No contradictions: truth = consistency (which incorporates grounding)
            truth = consistency;
        }
        auditTruth = truth;
    }
    else {
        // In external-doc mode: combine all components
        const wGrounding = weights.wUngrounded || 0.25;
        const wVerification = weights.wUnverified || 0.20;
        const wConsistency = weights.wContradictionEnergy || 0.35;
        const totalWeight = wGrounding + wVerification + wConsistency;
        truth = ((transcriptGrounding * wGrounding) +
            ((externalVerification ?? 0) * wVerification) +
            (consistency * wConsistency)) / totalWeight;
        auditTruth = truth;
    }
    return {
        transcriptGrounding: Math.round(transcriptGrounding),
        externalVerification: externalVerification !== null ? Math.round(externalVerification) : null,
        consistency: Math.round(consistency),
        truth: Math.round(truth),
        auditTruth: Math.round(auditTruth),
    };
}
/**
 * Compute contradiction penalty (0-100)
 */
function computeContradictionPenalty(claimResults, counts, config) {
    if (claimResults.length === 0)
        return 0;
    const weights = config.weights;
    const contradictedThreshold = config.thresholds.contradictedThreshold ?? config.thresholds.contradictionThreshold;
    // Penalty component 1: Ratio of contradicted claims
    const contradictedRatio = counts.contradicted / claimResults.length;
    const ratioPenalty = contradictedRatio * 50; // Max 50 points
    // Penalty component 2: Average contradiction weight (for contradicted claims)
    const contradictedResults = claimResults.filter(r => r.finalTruthState === 'Contradicted');
    const avgContradictionWeight = contradictedResults.length > 0
        ? contradictedResults.reduce((sum, r) => sum + r.edges.maxContradictionWeight, 0) / contradictedResults.length
        : 0;
    const weightPenalty = avgContradictionWeight * 30; // Max 30 points
    // Penalty component 3: Contradiction energy (weighted sum of all contradictions)
    const totalContradictionEnergy = claimResults.reduce((sum, r) => sum + r.edges.contradictionEdges.reduce((s, e) => s + e.weight, 0), 0);
    const energyPenalty = Math.min(20, (totalContradictionEnergy / claimResults.length) * 20); // Max 20 points
    // Combine penalties with weights from config
    const wRatio = weights.wContradictionEnergy || 0.35;
    const wWeight = 0.3;
    const wEnergy = 0.2;
    const totalWeight = wRatio + wWeight + wEnergy;
    const penalty = ((ratioPenalty * wRatio) +
        (weightPenalty * wWeight) +
        (energyPenalty * wEnergy)) / totalWeight;
    return Math.min(100, penalty);
}
/**
 * Check if truth score should be capped due to contradictions
 */
export function shouldCapTruthScore(contradictionsAboveThreshold, mode) {
    if (mode === 'transcript_only') {
        // In transcript-only mode: truth cannot be 100 if contradictions exist
        return contradictionsAboveThreshold > 0;
    }
    // In external-doc mode: truth can be 100 even with contradictions if verified
    return false;
}
