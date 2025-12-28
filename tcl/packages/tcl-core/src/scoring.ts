/**
 * Blends truth, consistency, and coherence scores into an overall score.
 * Weights: 50% truth, 30% consistency, 20% coherence.
 * Ensures result is in 0-100 range.
 */
export function blendScores(truth: number, consistency: number, coherence: number | null): number {
  // Defensive: ensure inputs are valid numbers, clamp to 0-100
  const safeTruth = Math.max(0, Math.min(100, Number(truth) || 0));
  const safeConsistency = Math.max(0, Math.min(100, Number(consistency) || 0));
  const safeCoherence = coherence !== null ? Math.max(0, Math.min(100, Number(coherence))) : 50; // Default to 50 if null
  
  const overall = 0.5 * safeTruth + 0.3 * safeConsistency + 0.2 * safeCoherence;
  return Math.max(0, Math.min(100, Math.round(overall)));
}

/**
 * Determines if an answer should be refused based on score thresholds.
 * Returns true if any score is below its threshold.
 */
export function shouldRefuse(
  overall: number,
  truth: number,
  consistency: number,
  thresholds?: { truth?: number; consistency?: number; overall?: number }
): boolean {
  // Defensive: ensure inputs are valid numbers
  const safeOverall = Number(overall) || 0;
  const safeTruth = Number(truth) || 0;
  const safeConsistency = Number(consistency) || 0;
  
  const tTruth = Math.max(0, Math.min(100, Number(thresholds?.truth) || 50));
  const tCons = Math.max(0, Math.min(100, Number(thresholds?.consistency) || 50));
  const tOverall = Math.max(0, Math.min(100, Number(thresholds?.overall) || 60));
  
  return safeOverall < tOverall || safeTruth < tTruth || safeConsistency < tCons;
}
