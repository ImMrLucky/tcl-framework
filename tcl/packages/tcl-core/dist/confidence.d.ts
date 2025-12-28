/**
 * Confidence scoring for claims
 * Calculates detailed confidence metrics based on grounding, support, and contradictions
 * Decoupled from specific use cases - works for any domain
 */
import type { Claim, SupportEdge, ContradictionEdge, GroundingEdge } from "./types.js";
export type ConfidenceMetrics = {
    groundingScore: number;
    supportScore: number;
    contradictionScore: number;
    overall: number;
    risk?: number;
};
/**
 * Calculate confidence metrics for a claim
 */
export declare function calculateClaimConfidence(claim: Claim, supports: SupportEdge[], contradictions: ContradictionEdge[], grounding: GroundingEdge[]): ConfidenceMetrics;
/**
 * Calculate confidence metrics for all claims
 */
export declare function calculateAllClaimConfidences(claims: Claim[], supports: SupportEdge[], contradictions: ContradictionEdge[], grounding: GroundingEdge[]): Map<string, ConfidenceMetrics>;
