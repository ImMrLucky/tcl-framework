import type { ScoreBandV2 } from "../types.js";

export function bandFromDirectRisk(score0to100: number): ScoreBandV2 {
  if (score0to100 < 18) return "low";
  if (score0to100 < 40) return "medium";
  if (score0to100 < 65) return "high";
  return "critical";
}

export function bandFromInvertedGood(score0to100: number): ScoreBandV2 {
  return bandFromDirectRisk(100 - score0to100);
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
