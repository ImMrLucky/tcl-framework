/**
 * Headline Counts Computation
 *
 * Computes SupportedClaimsCount, ContradictedClaimsCount, UngroundedClaimsCount
 * using configurable thresholds and spectral data.
 *
 * NO hard-coded thresholds - everything comes from config.
 */
import type { Claim, SpectralReport, ContradictionEdge } from "../types.js";
import { getScoringConfig } from "../config/scoring.js";
export interface HeadlineCounts {
    supported: number;
    contradicted: number;
    ungrounded: number;
    total: number;
    definitions: {
        supported: string;
        contradicted: string;
        ungrounded: string;
    };
}
export interface ComputeCountsInput {
    claims: Claim[];
    contradictions: ContradictionEdge[];
    spectral?: SpectralReport;
    config?: ReturnType<typeof getScoringConfig>;
}
/**
 * Compute headline counts with configurable thresholds.
 */
export declare function computeHeadlineCounts(input: ComputeCountsInput): HeadlineCounts;
