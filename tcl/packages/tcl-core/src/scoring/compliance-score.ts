import type { ScoredMetric } from "../types/analysis-result.js";
import { bandFromInvertedGood } from "./score-types.js";

export function buildComplianceMetric(compliance0to100: number, criticalIssues: number, confidence: number): ScoredMetric {
  const penalty = Math.min(40, criticalIssues * 12);
  const v = Math.max(0, Math.min(100, compliance0to100 - penalty));
  return {
    value: v,
    band: bandFromInvertedGood(v),
    confidence,
    explanation:
      criticalIssues === 0
        ? "Compliance score reflects domain-pack and detector signals without open critical findings."
        : `${criticalIssues} critical compliance-class issue(s) applied additional downward pressure beyond base compliance score.`,
    components: [
      { name: "base_compliance", value: compliance0to100 / 100, weight: 0.75, reason: "Rule/detector-derived compliance index" },
      { name: "critical_penalty", value: penalty / 100, weight: 0.25, reason: "Extra weight on critical severities" },
    ],
  };
}
