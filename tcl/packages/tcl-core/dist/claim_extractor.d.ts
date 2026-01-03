import { Claim } from "./types.js";
export type ClaimType = "ASSERTION" | "PROMISE" | "POLICY_STATEMENT" | "DISCLAIMER" | "QUESTION" | "REQUEST" | "ACKNOWLEDGEMENT" | "FILLER";
export declare function isAuditableClaimType(type: ClaimType): boolean;
export declare function classifyClaimType(text: string, speaker?: string): ClaimType;
export interface ExtractedClaim extends Claim {
    claimType: ClaimType;
    isAuditable: boolean;
    topicTags: string[];
    hasAbsoluteLanguage: boolean;
    hasMoney: boolean;
}
export interface ExtractClaimsResult {
    claims: ExtractedClaim[];
    allItems: ExtractedClaim[];
    stats: {
        total: number;
        auditable: number;
        filtered: number;
        byType: Record<ClaimType, number>;
    };
}
/**
 * Extract claims from text with speech-act classification.
 * Returns only AUDITABLE claims by default (ASSERTION, PROMISE, POLICY_STATEMENT, DISCLAIMER).
 *
 * Key changes from original:
 * - NO hard-coded confidence values
 * - Claims are classified by type
 * - Non-auditable items (questions, acknowledgements, filler) are filtered out
 * - Topic tags and risk signals are extracted
 */
export declare function extractClaimsWithTypes(text: string): ExtractClaimsResult;
/**
 * Legacy extractClaims function for backward compatibility.
 * Returns only auditable claims (ASSERTION, PROMISE, POLICY_STATEMENT, DISCLAIMER).
 *
 * NOTE: confidence is set to 0 - it must be computed from NLI/retrieval scores.
 */
export declare function extractClaims(text: string): Claim[];
