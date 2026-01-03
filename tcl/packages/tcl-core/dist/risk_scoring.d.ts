/**
 * Risk Scoring Module
 *
 * Computes severity and risk scores from measurable signals.
 * NO HARD-CODED SCORES - all outputs derived from inputs.
 *
 * Signals used:
 * - claimType (PROMISE > ASSERTION > POLICY_STATEMENT)
 * - speaker (AGENT > CUSTOMER for liability)
 * - topicTags (billing, fees, cancel, penalty = high stakes)
 * - NLI scores (contradiction, support, grounding)
 * - Spectral outputs (nodeBlameNorm, truthState)
 * - Linguistic features (absolute language, money mentions)
 */
import type { ClaimType, ExtractedClaim } from "./claim_extractor.js";
export interface RiskScoringConfig {
    severityThresholds: {
        critical: number;
        high: number;
        medium: number;
    };
    weights: {
        claimType: number;
        speaker: number;
        topic: number;
        contradiction: number;
        grounding: number;
        absoluteLanguage: number;
        money: number;
        nodeBlame: number;
        truthState: number;
    };
    claimTypeRisk: Record<ClaimType, number>;
    topicRisk: Record<string, number>;
}
export declare function getDefaultRiskConfig(): RiskScoringConfig;
export interface RiskSignals {
    claimType: ClaimType;
    speaker: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
    topicTags: string[];
    hasAbsoluteLanguage: boolean;
    hasMoney: boolean;
    maxContradictionScore: number;
    maxSupportScore: number;
    groundingScore: number;
    nodeBlameNorm: number;
    truthState: "Contradicted" | "Supported" | "Ungrounded" | "Inconclusive";
    involvedInContradiction: boolean;
    contradictionCount: number;
}
/**
 * Extract risk signals from claim and analysis results.
 * All signals are normalized to 0-1 range.
 */
export declare function extractRiskSignals(claim: ExtractedClaim, analysisResults?: {
    nliScores?: {
        contradiction: number;
        support: number;
        grounding: number;
    };
    spectral?: {
        nodeBlameNorm: number;
        truthState: string;
    };
    contradictions?: Array<{
        claimA: string;
        claimB: string;
        weight: number;
    }>;
}): RiskSignals;
export interface RiskScoreResult {
    riskScore: number;
    severity: "critical" | "high" | "medium" | "low";
    breakdown: {
        claimTypeRisk: number;
        speakerRisk: number;
        topicRisk: number;
        contradictionRisk: number;
        groundingRisk: number;
        absoluteLanguageRisk: number;
        moneyRisk: number;
        nodeBlameRisk: number;
        truthStateRisk: number;
    };
    explanation: string;
}
/**
 * Compute risk score from signals.
 * All scores are COMPUTED, not hard-coded.
 */
export declare function computeRiskScore(signals: RiskSignals, config?: RiskScoringConfig): RiskScoreResult;
export type IssueType = "CONTRADICTION" | "UNVERIFIED" | "UNSUPPORTED" | "CIRCULAR" | "POLICY_VIOLATION" | "POLICY_MISS" | "VAGUE_LANGUAGE" | "LATE_DISCLAIMER" | "PROMISE_RISK" | "ABSOLUTE_CLAIM";
/**
 * Determine issue type from signals.
 *
 * Key distinction:
 * - UNVERIFIED: No external policy/evidence docs available (transcript-only mode)
 * - UNSUPPORTED: External docs present but claim has no supporting evidence
 */
export declare function determineIssueType(signals: RiskSignals, options: {
    hasExternalDocs: boolean;
    turnIndex?: number;
    totalTurns?: number;
    isCircular?: boolean;
    policyViolation?: boolean;
    policyMiss?: boolean;
}): IssueType;
/**
 * Get human-readable issue type label.
 */
export declare function getIssueTypeLabel(issueType: IssueType): string;
/**
 * Get issue type explanation for UI display.
 */
export declare function getIssueTypeExplanation(issueType: IssueType, hasExternalDocs: boolean): string;
