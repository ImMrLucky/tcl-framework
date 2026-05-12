import type { ScoredMetric } from "../types/analysis-result.js";
import { bandFromDirectRisk } from "./score-types.js";

export function buildDriftMetric(args: { driftScore0to100: number; driftIssues: number; confidence: number }): ScoredMetric {
  const v = Math.max(0, Math.min(100, args.driftScore0to100));
  return {
    value: v,
    band: bandFromDirectRisk(v),
    confidence: args.confidence,
    explanation:
      args.driftIssues === 0
        ? "No commitment/topic drift issues detected above thresholds."
        : `Drift detector surfaced ${args.driftIssues} issue(s); composite drift score reflects commitment escalation and topic movement.`,
    components: [
      { name: "drift_score", value: v / 100, weight: 0.75, reason: "Pipeline drift score (0–100)" },
      { name: "drift_issues", value: Math.min(1, args.driftIssues / 10), weight: 0.25, reason: "Count of drift-class issues" },
    ],
  };
}
