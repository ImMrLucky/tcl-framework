/**
 * Truth Score Semantics - Fixed
 *
 * Replaces misleading "truth=100" with metrics that reflect reality.
 * All scoring formulas must take weights from EngineConfig (no literals).
 */
import type { ClaimResult } from './claim-result.js';
import type { DerivedCounts } from './counts-from-claims.js';
import type { EngineConfig } from '../config/engine-config.js';
export interface TruthScores {
    /**
     * Transcript grounding score (0-100)
     * How well claims map to transcript evidence
     */
    transcriptGrounding: number;
    /**
     * External verification score (0-100)
     * How well claims map to external documents (only in with_external_docs mode)
     */
    externalVerification: number | null;
    /**
     * Consistency score (0-100)
     * Based on contradiction presence/energy
     */
    consistency: number;
    /**
     * Legacy "truth" score (for backward compatibility)
     * Computed from the above components
     */
    truth?: number;
    /**
     * Audit truth score (alternative name)
     * Same as truth but with clearer semantics
     */
    auditTruth?: number;
}
/**
 * Compute truth scores from ClaimResults and counts
 */
export declare function computeTruthScores(claimResults: ClaimResult[], counts: DerivedCounts, config: EngineConfig): TruthScores;
/**
 * Check if truth score should be capped due to contradictions
 */
export declare function shouldCapTruthScore(contradictionsAboveThreshold: number, mode: 'transcript_only' | 'with_external_docs'): boolean;
