/**
 * Review Items Generator
 *
 * Creates actionable "Top Review Items" from the analysis.
 * This is the "money output" - what users actually need to see.
 */
import type { Claim, ContradictionEdge, DestructiveClaim, ReviewItem } from "./types.js";
export interface ReviewItemsInput {
    claims: Claim[];
    contradictions: ContradictionEdge[];
    destructiveClaims?: DestructiveClaim[];
}
/**
 * Generate all review items from analysis results.
 * This is the main entry point.
 */
export declare function generateReviewItems(input: ReviewItemsInput): ReviewItem[];
