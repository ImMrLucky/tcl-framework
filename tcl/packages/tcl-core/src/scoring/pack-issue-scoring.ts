/**
 * Signal-derived confidence for domain-pack / detector issues (no single magic float).
 */

export type EvidenceModeLite = "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL";

function severityBase(severity: "low" | "medium" | "high" | "critical"): number {
  switch (severity) {
    case "critical":
      return 0.78;
    case "high":
      return 0.68;
    case "medium":
      return 0.55;
    default:
      return 0.42;
  }
}

/**
 * Confidence rises slightly when external evidence mode is on (stronger verification path),
 * capped so transcript-only regex hits are never "certain".
 */
export function computePackIssueConfidence(
  severity: "low" | "medium" | "high" | "critical",
  evidenceMode: EvidenceModeLite
): number {
  let c = severityBase(severity);
  if (evidenceMode === "TRANSCRIPT_PLUS_EXTERNAL") c += 0.1;
  return Math.min(0.94, Math.max(0.28, Math.round(c * 100) / 100));
}

export function computePackIssueScoringComponents(
  severity: "low" | "medium" | "high" | "critical",
  evidenceMode: EvidenceModeLite,
  risk01: number
): {
  impact01: number;
  evidence01: number;
  signal01: number;
  category01: number;
  verificationMultiplier: number;
  risk01Raw: number;
  risk01Final: number;
} {
  const evidence01 =
    evidenceMode === "TRANSCRIPT_PLUS_EXTERNAL"
      ? Math.min(0.85, 0.45 + severityBase(severity) * 0.35)
      : Math.min(0.65, 0.28 + severityBase(severity) * 0.35);
  const signal01 = Math.min(0.92, 0.5 + risk01 * 0.35);
  const impact01 = severity === "critical" ? 0.95 : severity === "high" ? 0.82 : severity === "medium" ? 0.65 : 0.45;
  const category01 = severity === "critical" || severity === "high" ? 0.95 : 0.72;
  const verificationMultiplier = evidenceMode === "TRANSCRIPT_PLUS_EXTERNAL" ? 1 : 0.88;
  return {
    impact01,
    evidence01,
    signal01,
    category01,
    verificationMultiplier,
    risk01Raw: risk01,
    risk01Final: Math.min(1, risk01 * verificationMultiplier),
  };
}
