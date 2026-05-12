import type { ScoredMetric } from "../types/analysis-result.js";
import { bandFromInvertedGood } from "./score-types.js";

/** Primary TCL integrity score as an explainable metric (value mirrors `scores.tcl`). */
export function buildIntegrityCompositeMetric(args: {
  tcl0to100: number;
  weights: Record<string, number>;
  factualTruth: number;
  consistency: number;
  evidenceSupport: number;
  confidence: number;
}): ScoredMetric {
  const v = Math.max(0, Math.min(100, args.tcl0to100));
  const w = args.weights;
  const norm = (o: Record<string, number>) => {
    const s = Object.values(o).reduce((a, b) => a + b, 0) || 1;
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(o)) out[k] = val / s;
    return out;
  };
  const nw = norm(w);
  return {
    value: v,
    band: bandFromInvertedGood(v),
    confidence: args.confidence,
    explanation:
      "TCL Integrity Score composites factual truth, consistency, compliance, hallucination safety, drift, and evidence posture with template-aware weights.",
    components: [
      { name: "factual_truth", value: args.factualTruth / 100, weight: nw["integrity"] ?? 0.25, reason: "Factual / support posture" },
      { name: "consistency", value: args.consistency / 100, weight: nw["contradiction"] ?? 0.2, reason: "Graph + cross-turn consistency" },
      { name: "evidence_support", value: args.evidenceSupport / 100, weight: nw["evidence"] ?? 0.25, reason: "External evidence support" },
      { name: "tcl_blend", value: v / 100, weight: 0.3, reason: "Risk-adjusted composite already applied in engine" },
    ],
  };
}
