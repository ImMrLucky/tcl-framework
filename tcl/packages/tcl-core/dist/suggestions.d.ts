/**
 * Generate actionable suggestions for fixing validation issues
 * Decoupled from specific use cases - works for any domain
 */
import type { Claim, Violation, SupportEdge, Suggestion, CustomRule } from "./types.js";
export declare function generateSuggestions(claims: Claim[], violations: Violation[], contradictions: {
    claimA: string;
    claimB: string;
    reason: string;
}[], missingEvidence: {
    claimId: string;
    reason: string;
}[], supports: SupportEdge[], customRules?: CustomRule[], importanceByClaimId?: Map<string, number>, grounding?: Array<{
    claimId: string;
    sourceId: string;
    weight: number;
    quote?: string;
}>): Suggestion[];
