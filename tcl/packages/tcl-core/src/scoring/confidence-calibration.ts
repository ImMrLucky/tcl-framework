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
