/**
 * ClaimResult - Canonical Per-Claim Output Model
 *
 * Compute once, reuse everywhere. All counts, scores, and issues must derive from this.
 */
import type { Claim } from '../types.js';
export type GroundingKind = 'transcript' | 'external' | 'none';
export type VerificationKind = 'external_verified' | 'transcript_only' | 'unknown';
export type FinalTruthState = 'Supported' | 'Inconclusive' | 'Contradicted' | 'Ungrounded';
export interface EdgeRef {
    edgeId: string;
    type: 'support' | 'contradiction' | 'grounding';
    weight: number;
    reason?: string;
    ruleId?: string;
}
export interface ClaimResult {
    /**
     * Original claim ID
     */
    claimId: string;
    /**
     * Speaker who made the claim
     */
    speaker: 'AGENT' | 'CUSTOMER' | 'SYSTEM' | 'UNKNOWN';
    /**
     * Original claim text
     */
    text: string;
    /**
     * Turn index/range where claim occurred
     */
    turnIndex?: number;
    turnRange?: [number, number];
    /**
     * Grounding information
     */
    grounding: {
        /**
         * Kind of grounding evidence
         * - "transcript": Evidence from transcript itself
         * - "external": Evidence from external documents
         * - "none": No evidence found
         */
        kind: GroundingKind;
        /**
         * Evidence IDs (claim IDs or source IDs)
         */
        evidenceIds: string[];
        /**
         * Grounding score (0-1)
         */
        groundingScore: number;
    };
    /**
     * Verification information
     */
    verification: {
        /**
         * Kind of verification
         * - "external_verified": Verified against external docs
         * - "transcript_only": Only transcript evidence (not verified externally)
         * - "unknown": Cannot determine
         */
        kind: VerificationKind;
    };
    /**
     * Edge information
     */
    edges: {
        /**
         * Maximum support edge weight
         */
        maxSupportWeight: number;
        /**
         * Maximum contradiction edge weight
         */
        maxContradictionWeight: number;
        /**
         * All support edges
         */
        supportEdges: EdgeRef[];
        /**
         * All contradiction edges
         */
        contradictionEdges: EdgeRef[];
    };
    /**
     * Final truth state (computed from edges + thresholds)
     */
    finalTruthState: FinalTruthState;
    /**
     * Optional centrality/importance scores
     */
    importance?: number;
    centrality?: number;
    blame?: number;
    /**
     * Original claim object (for backward compatibility)
     */
    originalClaim: Claim;
}
/**
 * Compute finalTruthState from edges and thresholds
 */
export declare function computeFinalTruthState(claimResult: Pick<ClaimResult, 'edges' | 'grounding' | 'verification'>, config: {
    contradictionThreshold: number;
    contradictedThreshold?: number;
    supportThreshold: number;
    mode: 'transcript_only' | 'with_external_docs';
}): FinalTruthState;
/**
 * Create ClaimResult from claim and graph data
 */
export declare function createClaimResult(claim: Claim, graphData: {
    supportEdges: EdgeRef[];
    contradictionEdges: EdgeRef[];
    groundingEdges?: EdgeRef[];
    evidenceIds?: string[];
}, config: {
    contradictionThreshold: number;
    contradictedThreshold?: number;
    supportThreshold: number;
    mode: 'transcript_only' | 'with_external_docs';
}): ClaimResult;
