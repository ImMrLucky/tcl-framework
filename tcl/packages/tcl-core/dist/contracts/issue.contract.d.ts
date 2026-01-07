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
    hasContradictionEdge: boolean;
    contradictionStrength?: number;
    hasSupportEdge: boolean;
    supportStrength?: number;
    centrality?: number;
    repetition?: number;
    amountsDetected?: number[];
    hasGuaranteeLanguage?: boolean;
    hasContractLanguage?: boolean;
    complianceFlags?: string[];
    spectralEnergy?: number;
    spectralGap?: number;
    cycleMass?: number;
}
/**
 * TCL Issue V3 - Production-ready contract
 *
 * Stable, mode-safe, explainable issue representation.
 */
export interface TclIssueV3 {
    id: string;
    type: string;
    category: string;
    impactSeverity: Severity;
    confidence: number;
    confidenceBand: ConfidenceBand;
    verificationLevel: VerificationLevel;
    rankScore: number;
    riskScore: number;
    reasonCodes: string[];
    explanation: string;
    trace: {
        claimIds: string[];
        edgeIds?: string[];
        evidenceNodeIds?: string[];
        topicId?: string;
        transcriptSpans?: {
            start: number;
            end: number;
        }[];
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
export declare const CONTRACT_VERSION = "3.0";
