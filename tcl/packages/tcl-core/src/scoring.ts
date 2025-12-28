/**
 * Blends truth, consistency, and coherence scores into an overall score.
 * Weights: 50% truth, 30% consistency, 20% coherence.
 * Ensures result is in 0-100 range.
 */
export function blendScores(truth: number | null, consistency: number | null, coherence: number | null): number | null {
  // Only compute if we have real data - no fallbacks
  if (truth === null || consistency === null || coherence === null) {
    return null; // Cannot compute overall without all components
  }
  
  // Ensure inputs are valid numbers, clamp to 0-100
  const safeTruth = Math.max(0, Math.min(100, Number(truth)));
  const safeConsistency = Math.max(0, Math.min(100, Number(consistency)));
  const safeCoherence = Math.max(0, Math.min(100, Number(coherence)));
  
  const overall = 0.5 * safeTruth + 0.3 * safeConsistency + 0.2 * safeCoherence;
  return Math.max(0, Math.min(100, Math.round(overall)));
}

/**
 * Determines if an answer should be refused based on score thresholds.
 * Returns true if any score is below its threshold.
 */
export function shouldRefuse(
  overall: number | null,
  truth: number | null,
  consistency: number | null,
  thresholds?: { truth?: number; consistency?: number; overall?: number }
): boolean {
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
