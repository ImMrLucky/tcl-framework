/**
 * Claim Classifier
 *
 * Classifies claims by kind BEFORE graph building to enable proper contradiction gating.
 * This is the key fix for false contradictions.
 *
 * Rules-based first (fast + deterministic), optionally LLM later.
 */
import type { ClaimKind, Claim, ContradictionType } from "./types.js";
import { type ScoringConfig } from "./config/scoring.js";
/**
 * Classify a claim's kind based on text and speaker.
 *
 * Priority order:
 * 1. Question (very reliable pattern)
 * 2. Intent (customer wants/needs)
 * 3. Emotion (feelings expressed)
 * 4. Promise (agent commitments)
 * 5. Meta (doc references, conversation control)
 * 6. Default: assertion
 */
export declare function classifyClaimKind(claimText: string, speakerLabel?: string): ClaimKind;
/**
 * Extract normalized keywords from text for topic matching.
 */
export declare function extractKeywords(text: string, config?: ScoringConfig): Set<string>;
/**
 * Calculate topic overlap between two claims using Jaccard similarity.
 * Returns 0-1 where 1 = identical topics.
 */
export declare function calculateTopicOverlap(claimA: string | {
    text: string;
}, claimB: string | {
    text: string;
}, config?: ScoringConfig): number;
export interface ContradictionGateResult {
    shouldCreate: boolean;
    contradictionType: ContradictionType;
    reasonCodes: string[];
    overlapScore: number;
}
/**
 * Determine if two claims should be considered for contradiction.
 * This is the main fix for false contradictions.
 *
 * Returns:
 * - shouldCreate: false if this pair should NOT create any contradiction edge
 * - contradictionType: "direct" | "topic_mismatch" | "low_overlap" | "needs_review"
 * - reasonCodes: why this decision was made
 */
export declare function shouldConsiderContradiction(claimA: Claim, claimB: Claim, config?: ScoringConfig): ContradictionGateResult;
/**
 * Classify all claims in an array, adding claimKind field.
 */
export declare function classifyAllClaims(claims: Claim[]): Claim[];
/**
 * Get classification stats for debugging.
 */
export declare function getClassificationStats(claims: Claim[]): Record<ClaimKind, number>;
