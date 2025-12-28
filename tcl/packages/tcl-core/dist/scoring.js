/**
 * Blends truth, consistency, and coherence scores into an overall score.
 * Weights: 50% truth, 30% consistency, 20% coherence.
 * Ensures result is in 0-100 range.
 */
export function blendScores(truth, consistency, coherence) {
    // Compute overall score with available components
    // If a component is null, we still compute with available data, but adjust weights
    const safeTruth = truth !== null ? Math.max(0, Math.min(100, Number(truth))) : null;
    const safeConsistency = consistency !== null ? Math.max(0, Math.min(100, Number(consistency))) : null;
    const safeCoherence = coherence !== null ? Math.max(0, Math.min(100, Number(coherence))) : null;
    // Count available components
    const available = [safeTruth, safeConsistency, safeCoherence].filter(s => s !== null).length;
    if (available === 0) {
        return null; // No data available at all
    }
    // Compute weighted average with available components
    // Normalize weights based on what's available
    let totalWeight = 0;
    let weightedSum = 0;
    if (safeTruth !== null) {
        const weight = available === 3 ? 0.5 : (available === 2 ? 0.6 : 1.0); // Adjust weight if components missing
        weightedSum += safeTruth * weight;
        totalWeight += weight;
    }
    if (safeConsistency !== null) {
        const weight = available === 3 ? 0.3 : (available === 2 ? 0.4 : 1.0);
        weightedSum += safeConsistency * weight;
        totalWeight += weight;
    }
    if (safeCoherence !== null) {
        const weight = available === 3 ? 0.2 : (available === 2 ? 0.4 : 1.0);
        weightedSum += safeCoherence * weight;
        totalWeight += weight;
    }
    // Normalize by total weight to get average
    const overall = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return Math.max(0, Math.min(100, Math.round(overall)));
}
/**
 * Determines if an answer should be refused based on score thresholds.
 * Returns true if any score is below its threshold.
 */
export function shouldRefuse(overall, truth, consistency, thresholds) {
    // If any score is null, we cannot determine refusal (unknown state)
    if (overall === null || truth === null || consistency === null) {
        return false; // Don't refuse if we don't have complete data
    }
    // Ensure inputs are valid numbers
    const safeOverall = Number(overall);
    const safeTruth = Number(truth);
    const safeConsistency = Number(consistency);
    const tTruth = thresholds?.truth ?? 50;
    const tCons = thresholds?.consistency ?? 50;
    const tOverall = thresholds?.overall ?? 60;
    return safeOverall < tOverall || safeTruth < tTruth || safeConsistency < tCons;
}
