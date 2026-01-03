/**
 * Quote Extraction - Extract exact evidence quotes from claims
 *
 * CRITICAL: Quotes must be EXACT (not truncated) for audit defensibility.
 */
import type { Claim } from '../types.js';
export interface QuoteExtraction {
    quoteId: string;
    claimId: string;
    speaker: "Agent" | "Customer" | "System";
    turnIndex: number;
    lineSpan?: [number, number];
    text: string;
    evidenceRef?: {
        type: "Call" | "Policy" | "KB";
        ref: string;
    };
}
/**
 * Extract exact quote from a claim.
 *
 * Returns the FULL text of the claim, not truncated.
 * UI should handle truncation in list views, but detail views must show full text.
 */
export declare function extractQuote(claim: Claim, claimIndex: number): QuoteExtraction;
/**
 * Extract quotes for multiple claims.
 */
export declare function extractQuotes(claims: Claim[]): QuoteExtraction[];
/**
 * Find quote by claim ID.
 */
export declare function findQuoteByClaimId(quotes: QuoteExtraction[], claimId: string): QuoteExtraction | undefined;
