import { clamp01 } from "./score-types.js";

export type CalibrationInput = {
  transcriptQuality01: number;
  speakerConfidence01: number;
  hasExternalEvidence: boolean;
  evidenceMatchStrength01: number;
  contradictionClarity01: number;
  ruleSpecificity01: number;
  supportingSignals: number;
  conflictingSignals: number;
};

export type RunConfidenceComponent = {
  name: string;
  value: number;
  weight: number;
  reason: string;
};

/**
 * Single 0–1 confidence for a scored dimension — no magic constants; all inputs explicit.
 */
export function calibrateAnalysisConfidence(c: CalibrationInput): number {
  const evidenceLift = c.hasExternalEvidence ? 0.08 : 0;
  const supportRatio =
    c.supportingSignals + c.conflictingSignals > 0
      ? c.supportingSignals / (c.supportingSignals + c.conflictingSignals)
      : 0.5;
  const raw =
    0.22 * c.transcriptQuality01 +
    0.2 * c.speakerConfidence01 +
    0.18 * c.evidenceMatchStrength01 +
    0.14 * c.contradictionClarity01 +
    0.12 * c.ruleSpecificity01 +
    0.08 * supportRatio +
    evidenceLift;
  return Math.round(clamp01(raw) * 100) / 100;
}

/**
 * Auditable breakdown matching {@link calibrateAnalysisConfidence} weights (same inputs → same total).
 */
export function buildRunConfidenceCalibration(c: CalibrationInput): {
  confidence: number;
  confidenceBand: "low" | "medium" | "high";
  confidenceComponents: RunConfidenceComponent[];
} {
  const evidenceLift = c.hasExternalEvidence ? 0.08 : 0;
  const supportRatio =
    c.supportingSignals + c.conflictingSignals > 0
      ? c.supportingSignals / (c.supportingSignals + c.conflictingSignals)
      : 0.5;

  const components: RunConfidenceComponent[] = [
    {
      name: "transcript_quality",
      value: c.transcriptQuality01,
      weight: 0.22,
      reason: "ASR / diarization / line structure quality proxy",
    },
    {
      name: "speaker_attribution",
      value: c.speakerConfidence01,
      weight: 0.2,
      reason: "Share of claims with resolved agent/customer roles",
    },
    {
      name: "evidence_match_strength",
      value: c.evidenceMatchStrength01,
      weight: 0.18,
      reason: "External or policy match strength vs. claim material",
    },
    {
      name: "contradiction_clarity",
      value: c.contradictionClarity01,
      weight: 0.14,
      reason: "How clearly contradictions separate in the graph",
    },
    {
      name: "template_rule_specificity",
      value: c.ruleSpecificity01,
      weight: 0.12,
      reason: "Industry template granularity for scoring weights",
    },
    {
      name: "support_vs_conflict_balance",
      value: supportRatio,
      weight: 0.08,
      reason: "Supported + transcript-grounded vs. contradicted + conflict edges",
    },
  ];
  if (c.hasExternalEvidence) {
    components.push({
      name: "external_evidence_lift",
      value: 1,
      weight: evidenceLift > 0 ? evidenceLift : 0.08,
      reason: "Bonus when policy/uploads are attached to the run",
    });
  }

  const confidence = calibrateAnalysisConfidence(c);
  return {
    confidence,
    confidenceBand: confidence >= 0.72 ? "high" : confidence >= 0.48 ? "medium" : "low",
    confidenceComponents: components,
  };
}
