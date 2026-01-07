/**
 * Headline Counts Computation
 *
 * Computes SupportedClaimsCount, ContradictedClaimsCount, UngroundedClaimsCount
 * using configurable thresholds and spectral data.
 *
 * IMPORTANT: These counts use the ACTUAL edges that were built by the graph builder.
 * If an edge exists, it already passed its threshold during creation.
 * We should NOT re-apply different thresholds when counting!
 *
 * DEPRECATED: Use computeCountsFromClaims() from counts-from-claims.ts instead.
 * This function is kept for backward compatibility but should be replaced.
 */
import type { Claim, SpectralReport, ContradictionEdge, SupportEdge, GroundingEdge } from "../types.js";
import { getScoringConfig } from "../config/scoring.js";
export interface HeadlineCounts {
    supported: number;
    contradicted: number;
    ungrounded: number;
    unverified: number;
    total: number;
    definitions: {
        supported: string;
        contradicted: string;
        ungrounded: string;
        unverified: string;
    };
}
export interface ComputeCountsInput {
    claims: Claim[];
    contradictions: ContradictionEdge[];
    supports?: SupportEdge[];
    grounding?: GroundingEdge[];
    spectral?: SpectralReport;
    config?: ReturnType<typeof getScoringConfig>;
}
/**
 * Compute headline counts using ACTUAL edges from the graph builder.
 *
 * CRITICAL: If an edge EXISTS, it already passed its threshold during creation.
 * We should NOT re-apply different thresholds when counting!
 *
 * The spectral truthStates are the authoritative source for claim classification.
 */
export declare function computeHeadlineCounts(input: ComputeCountsInput): HeadlineCounts;
