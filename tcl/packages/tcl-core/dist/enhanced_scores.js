/**
 * Enhanced Scores
 *
 * Replace misleading "truth=100" with metrics that reflect reality.
 */
import { getScoringConfig } from "./config/scoring.js";
/**
 * Compute enhanced scores that reflect reality.
 */
export function computeEnhancedScores(input) {
    const { claims, contradictions, spectral, hasExternalSources } = input;
    const config = getScoringConfig();
    // 1. Groundedness Score (0-100)
    // % of claims that have grounding (transcript or external)
    const groundedClaims = claims.filter(c => c.grounding && c.grounding.kind !== "none");
    const groundednessScore = claims.length > 0
        ? Math.round((groundedClaims.length / claims.length) * 100)
        : null;
    // 2. Verification Score (0-100 or null)
    // Only computed if there are external sources
    let verificationScore = null;
    if (hasExternalSources) {
        const verifiedClaims = claims.filter(c => c.verification && c.verification.status === "verified");
        verificationScore = claims.length > 0
            ? Math.round((verifiedClaims.length / claims.length) * 100)
            : null;
    }
    // 3. Consistency Score (0-100)
    // Based on DIRECT contradictions only
    const directContradictions = contradictions.filter(c => c.contradictionType === "direct" || !c.contradictionType);
    // Simple formula: 100 - (direct contradictions * penalty)
    const contradictionPenalty = config.weights.wContradictionEnergy * 20; // 20 points per direct contradiction
    const consistencyScore = Math.max(0, Math.round(100 - directContradictions.length * contradictionPenalty));
    // 4. Coherence Score (from spectral)
    const coherenceScore = spectral?.coherenceScore !== undefined
        ? Math.round(spectral.coherenceScore * 100)
        : null;
    // 5. Overall - weighted average of available scores
    const availableScores = [];
    if (groundednessScore !== null) {
        availableScores.push({ score: groundednessScore, weight: config.weights.wUngrounded });
    }
    if (verificationScore !== null) {
        availableScores.push({ score: verificationScore, weight: config.weights.wUnverified });
    }
    if (consistencyScore !== null) {
        availableScores.push({ score: consistencyScore, weight: config.weights.wContradictionEnergy });
    }
    if (coherenceScore !== null) {
        availableScores.push({ score: coherenceScore, weight: 0.2 }); // Coherence weight
    }
    let overall = null;
    if (availableScores.length > 0) {
        const totalWeight = availableScores.reduce((sum, s) => sum + s.weight, 0);
        const weightedSum = availableScores.reduce((sum, s) => sum + s.score * s.weight, 0);
        overall = Math.round(weightedSum / totalWeight);
    }
    return {
        // NEW meaningful scores
        groundednessScore,
        verificationScore,
        consistencyScore,
        coherenceScore,
        // LEGACY (for backwards compatibility)
        truth: groundednessScore, // Map truth to groundedness
        consistency: consistencyScore,
        coherence: coherenceScore,
        overall,
    };
}
/**
 * Compute summary stats for UI display.
 */
export function computeSummaryStats(input) {
    const { claims, contradictions, hasExternalSources } = input;
    // Count grounded claims
    const groundedClaims = claims.filter(c => c.grounding && c.grounding.kind !== "none").length;
    // Count verified claims
    const verifiedClaims = claims.filter(c => c.verification && c.verification.status === "verified").length;
    // Count DIRECT contradictions only
    const directContradictions = contradictions.filter(c => c.contradictionType === "direct" || !c.contradictionType).length;
    // Count needs review
    const needsReviewCount = contradictions.filter(c => c.contradictionType === "needs_review" || c.contradictionType === "topic_mismatch").length;
    return {
        totalClaims: claims.length,
        groundedClaims,
        verifiedClaims,
        directContradictions,
        needsReviewCount,
        hasExternalEvidence: hasExternalSources,
    };
}
