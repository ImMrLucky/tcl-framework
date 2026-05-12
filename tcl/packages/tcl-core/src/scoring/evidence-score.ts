import type { ScoredMetric } from "../types/analysis-result.js";
import { bandFromInvertedGood } from "./score-types.js";

export function buildEvidenceCoverageMetric(args: {
  supported: number;
  contradicted: number;
  unverified: number;
  ungrounded: number;
  total: number;
  hasExternalEvidence: boolean;
  confidence: number;
}): ScoredMetric {
  const t = Math.max(1, args.total);
  const coverage = Math.round(100 * ((args.supported + args.unverified) / t));
  const conflictLoad = Math.round(100 * (args.contradicted / t));
  const gap = Math.round(100 * (args.ungrounded / t));
  const explanation = args.hasExternalEvidence
    ? `Evidence coverage blends externally supported claims (${args.supported}/${t}), transcript-grounded claims (${args.unverified}/${t}), and ungrounded claims (${args.ungrounded}/${t}). Contradictions: ${args.contradicted}.`
    : `Transcript-only run: ${args.unverified}/${t} claims are transcript-grounded; ${args.ungrounded} lack grounding edges; ${args.contradicted} in active contradiction. Attach policy/KB sources to raise verification confidence.`;
  const value = Math.max(0, Math.min(100, coverage - conflictLoad * 0.4 - gap * 0.25));
  return {
    value,
    band: bandFromInvertedGood(value),
    confidence: args.confidence,
    explanation,
    components: [
      { name: "supported_ratio", value: args.supported / t, weight: 0.35, reason: "Claims with external support edges" },
      { name: "transcript_grounded_ratio", value: args.unverified / t, weight: 0.35, reason: "Claims grounded in transcript evidence" },
      { name: "contradiction_penalty", value: conflictLoad / 100, weight: 0.2, reason: "Share of claims in contradiction edges" },
      { name: "ungrounded_penalty", value: gap / 100, weight: 0.1, reason: "Isolated claims without grounding" },
    ],
  };
}
