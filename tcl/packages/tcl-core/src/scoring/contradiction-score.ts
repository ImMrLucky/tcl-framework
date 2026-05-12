import type { ScoredMetric } from "../types/analysis-result.js";
import { bandFromDirectRisk } from "./score-types.js";

export function buildContradictionMetric(args: {
  contradictionEdges: number;
  claims: number;
  crossTurnPairs: number;
  confidence: number;
}): ScoredMetric {
  const c = Math.max(1, args.claims);
  const density = Math.min(1, args.contradictionEdges / Math.max(1, c * 0.35));
  const cross = Math.min(1, args.crossTurnPairs / 8);
  const risk01 = clamp100(density * 70 + cross * 30);
  return {
    value: risk01,
    band: bandFromDirectRisk(risk01),
    confidence: args.confidence,
    explanation:
      args.contradictionEdges === 0
        ? "No contradiction edges survived graph gating for this transcript."
        : `${args.contradictionEdges} contradiction edge(s) across ${args.claims} claims; ${args.crossTurnPairs} cross-turn tension pair(s) from consistency engine.`,
    components: [
      { name: "edge_density", value: density, weight: 0.65, reason: "Contradiction edges vs. claim count" },
      { name: "cross_turn_pairs", value: cross, weight: 0.35, reason: "Entity/topic cross-turn mismatches" },
    ],
  };
}

function clamp100(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x)));
}
