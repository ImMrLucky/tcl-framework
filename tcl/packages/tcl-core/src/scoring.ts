export function blendScores(truth: number, consistency: number, coherence: number): number {
  const overall = 0.5 * truth + 0.3 * consistency + 0.2 * coherence;
  return Math.max(0, Math.min(100, Math.round(overall)));
}

export function shouldRefuse(
  overall: number,
  truth: number,
  consistency: number,
  thresholds?: { truth?: number; consistency?: number; overall?: number }
) {
  const tTruth = thresholds?.truth ?? 50;
  const tCons = thresholds?.consistency ?? 50;
  const tOverall = thresholds?.overall ?? 60;
  return overall < tOverall || truth < tTruth || consistency < tCons;
}
