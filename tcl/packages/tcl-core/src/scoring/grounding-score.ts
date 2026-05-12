import type { ScoredMetric } from "../types/analysis-result.js";
import { bandFromInvertedGood } from "./score-types.js";

export function buildGroundingMetric(transcriptGrounding0to100: number, confidence: number): ScoredMetric {
  const v = Math.max(0, Math.min(100, transcriptGrounding0to100));
  return {
    value: v,
    band: bandFromInvertedGood(v),
    confidence,
    explanation:
      "Transcript grounding measures whether claims are anchored in the conversation graph (not factual truth). Low values often mean sparse speaker labels or fragmented turns.",
    components: [
      { name: "graph_grounding", value: v / 100, weight: 1, reason: "Unified graph transcript grounding score" },
    ],
  };
}
