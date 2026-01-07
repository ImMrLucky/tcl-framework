/**
 * Compute counts from ClaimResults - Single Source of Truth
 *
 * All counts must be derived from ClaimResults, not re-computed separately.
 */
import type { ClaimResult } from './claim-result.js';
import type { EngineConfig } from '../config/engine-config.js';
export interface DerivedCounts {
    /**
     * Total number of claims
     */
    claims: number;
    /**
     * Number of claims with finalTruthState = "Supported"
     */
    supported: number;
    /**
     * Number of claims with finalTruthState = "Contradicted"
     */
    contradicted: number;
    /**
     * Number of claims with finalTruthState = "Ungrounded"
     */
    ungrounded: number;
    /**
     * Number of claims with finalTruthState = "Inconclusive"
     */
    inconclusive: number;
    /**
     * Number of claims verified externally (verification.kind = "external_verified")
     */
    verified: number;
    /**
     * Number of claims with only transcript evidence (verification.kind = "transcript_only")
     */
    unverified: number;
    /**
     * Total number of support edges (after filtering)
     */
    supportEdges: number;
    /**
     * Total number of contradiction edges (after filtering)
     */
    contradictionEdges: number;
    /**
     * Number of contradictions above threshold
     */
    contradictionsAboveThreshold: number;
}
/**
 * Compute counts from ClaimResults array
 */
export declare function computeCountsFromClaims(claimResults: ClaimResult[], config: EngineConfig): DerivedCounts;
/**
 * Generate definitions strings from EngineConfig
 */
export declare function generateDefinitions(config: EngineConfig): {
    supported: string;
    contradicted: string;
    ungrounded: string;
    unverified: string;
};
