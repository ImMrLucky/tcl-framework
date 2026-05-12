import type { ScoredMetric } from "../types/analysis-result.js";
import { bandFromInvertedGood } from "./score-types.js";

export function buildHallucinationMetric(hallucinationSafety0to100: number, hallucinationIssues: number, confidence: number): ScoredMetric {
  const v = Math.max(0, Math.min(100, hallucinationSafety0to100));
  return {
    value: v,
    band: bandFromInvertedGood(v),
    confidence,
    explanation:
      hallucinationIssues === 0
        ? "No hallucination-class issues fired; score still reflects grounding and evidence gaps."
        : `${hallucinationIssues} hallucination-risk issue(s) lowered the safety score.`,
    components: [
      { name: "hallucination_index", value: v / 100, weight: 0.8, reason: "Detector + graph hallucination posture" },
      { name: "issue_count_signal", value: Math.min(1, hallucinationIssues / 8), weight: 0.2, reason: "Hallucination issues count" },
    ],
  };
}
