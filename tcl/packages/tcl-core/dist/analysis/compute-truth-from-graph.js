/**
 * Compute truth score from graph data (interim solution)
 *
 * This is a bridge function until full ClaimResults integration.
 * It computes truth score incorporating contradictions properly.
 */
import { getEngineConfig } from '../config/engine-config.js';
/**
 * Compute truth score from graph data
 *
 * This ensures truth cannot be 100 if contradictions exist above threshold.
 */
export function computeTruthFromGraph(claims, contradictions, supports, grounding, mode = 'transcript_only') {
    const config = getEngineConfig();
    const contradictionThreshold = config.thresholds.contradictedThreshold ?? config.thresholds.contradictionThreshold;
    // Count contradictions above threshold
    const contradictionsAboveThreshold = contradictions.filter(c => (c.weight || 0) >= contradictionThreshold).length;
    // Compute consistency score (100 - penalty)
    // Penalty based on:
    // 1. Ratio of contradicted claims
    // 2. Average contradiction weight
    // 3. Total contradiction energy
    const contradictedClaimIds = new Set();
    let totalContradictionEnergy = 0;
    let maxContradictionWeight = 0;
    for (const c of contradictions) {
        if ((c.weight || 0) >= contradictionThreshold) {
            contradictedClaimIds.add(c.claimA);
            contradictedClaimIds.add(c.claimB);
            totalContradictionEnergy += c.weight || 0;
            maxContradictionWeight = Math.max(maxContradictionWeight, c.weight || 0);
        }
    }
    const contradictedRatio = claims.length > 0 ? contradictedClaimIds.size / claims.length : 0;
    const avgContradictionWeight = contradictionsAboveThreshold > 0
        ? totalContradictionEnergy / contradictionsAboveThreshold
        : 0;
    // Penalty formula (0-100)
    const ratioPenalty = contradictedRatio * 50; // Max 50 points
    const weightPenalty = avgContradictionWeight * 30; // Max 30 points
    const energyPenalty = Math.min(20, (totalContradictionEnergy / Math.max(1, claims.length)) * 20); // Max 20 points
    const totalPenalty = ratioPenalty + weightPenalty + energyPenalty;
    const consistency = Math.max(0, 100 - Math.min(100, totalPenalty));
    // Compute transcript grounding score
    const groundedClaimIds = new Set(grounding.map(g => g.claimId));
    const transcriptGrounding = claims.length > 0
        ? (groundedClaimIds.size / claims.length) * 100
        : 100;
    // Compute truth score
    // In transcript-only mode: truth cannot be 100 if contradictions exist
    let truth;
    if (mode === 'transcript_only') {
        if (contradictionsAboveThreshold > 0) {
            // Cap truth at 99 if contradictions exist
            truth = Math.min(99, consistency);
        }
        else {
            // No contradictions: truth = consistency (which incorporates grounding)
            truth = consistency;
        }
    }
    else {
        // In external-doc mode: combine consistency and grounding
        const wConsistency = config.weights.wContradictionEnergy || 0.35;
        const wGrounding = config.weights.wUngrounded || 0.25;
        const totalWeight = wConsistency + wGrounding;
        truth = ((consistency * wConsistency) +
            (transcriptGrounding * wGrounding)) / totalWeight;
    }
    return {
        truth: Math.round(truth),
        consistency: Math.round(consistency),
        transcriptGrounding: Math.round(transcriptGrounding),
        contradictionsAboveThreshold,
    };
}
