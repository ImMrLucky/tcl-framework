/**
 * Issue Contract V3
 * 
 * Production-ready, mode-safe, stable, and explainable issue severity + ranking.
 * 
 * This contract defines the public API for issue representation across:
 * - transcript-only
 * - realtime incremental
 * - doc-backed (policy/KB)
 * - externally verified sources
 * 
 * All severity values are derived from signals, no hard-coded per-issue severities.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export type VerificationLevel = "TRANSCRIPT_ONLY" | "DOC_BACKED" | "EXTERNALLY_VERIFIED";

export type ConfidenceBand = "low" | "medium" | "high";

/**
 * Issue signals extracted from graph, entities, and spectral analysis
 */
export interface IssueSignals {
  // Graph signals
  hasContradictionEdge: boolean;
  contradictionStrength?: number;   // 0..1
  hasSupportEdge: boolean;
  supportStrength?: number;         // 0..1
  centrality?: number;              // 0..1 (topic subgraph)
  repetition?: number;              // integer

  // Entities & impact
  amountsDetected?: number[];        // parsed MONEY values if present
  hasGuaranteeLanguage?: boolean;
  hasContractLanguage?: boolean;
  complianceFlags?: string[];        // e.g., ["PCI_CVV_STORAGE", "RECORDING_MISREPRESENTATION"]

  // Spectral (topic-level or claim-level)
  spectralEnergy?: number;           // >=0 normalized
  spectralGap?: number;              // >=0 normalized
  cycleMass?: number;                // >=0 normalized
}

/**
 * TCL Issue V3 - Production-ready contract
 * 
 * Stable, mode-safe, explainable issue representation.
 */
export interface TclIssueV3 {
  id: string;                        // stable across runs for same transcript+template
  type: string;                      // e.g. CONTRADICTION, UNSUPPORTED, RISK_SIGNAL
  category: string;                  // evidence, compliance, billing, cancellation, etc.

  // The two axes
  impactSeverity: Severity;          // mode-independent
  confidence: number;                // 0..1 mode-dependent
  confidenceBand: ConfidenceBand;
  verificationLevel: VerificationLevel;

  // Ranking
  rankScore: number;                 // deterministic
  riskScore: number;                 // deterministic, mode-safe

  // Explainability
  reasonCodes: string[];             // REQUIRED for high/critical
  explanation: string;               // short natural language
  trace: {
    claimIds: string[];
    edgeIds?: string[];
    evidenceNodeIds?: string[];
    topicId?: string;
    transcriptSpans?: { start: number; end: number }[];
  };

  signals: IssueSignals;
  createdAt?: string;
}

/**
 * Severity counts for executive summary
 */
export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/**
 * Confidence band counts
 */
export interface ConfidenceBandCounts {
  high: number;
  medium: number;
  low: number;
}

/**
 * Verification level counts
 */
export interface VerificationCounts {
  TRANSCRIPT_ONLY: number;
  DOC_BACKED: number;
  EXTERNALLY_VERIFIED: number;
}

/**
 * Contract version identifier
 */
export const CONTRACT_VERSION = "3.0";

