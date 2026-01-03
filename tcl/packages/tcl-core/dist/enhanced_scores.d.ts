/**
 * Enhanced Scores
 *
 * Replace misleading "truth=100" with metrics that reflect reality.
 */
import type { Claim, ContradictionEdge, EnhancedScores, SummaryStats, SpectralReport } from "./types.js";
export interface ScoreComputationInput {
    claims: Claim[];
    contradictions: ContradictionEdge[];
    spectral?: SpectralReport;
    hasExternalSources: boolean;
}
/**
 * Compute enhanced scores that reflect reality.
 */
export declare function computeEnhancedScores(input: ScoreComputationInput): EnhancedScores;
/**
 * Compute summary stats for UI display.
 */
export declare function computeSummaryStats(input: ScoreComputationInput): SummaryStats;
