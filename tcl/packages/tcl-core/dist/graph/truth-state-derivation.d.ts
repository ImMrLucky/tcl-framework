/**
 * Truth State Derivation
 *
 * CRITICAL: Truth states are DERIVED from graph topology, NEVER assigned directly.
 *
 * Truth States:
 * - SUPPORTED: Has ≥1 valid support edge to external evidence or authoritative fact
 * - CONTRADICTED: Has ≥1 contradiction edge on the same subject slot
 * - UNVERIFIED: Grounded in transcript but lacks external evidence
 * - UNGROUNDED: Isolated node (no grounding, no evidence)
 */
import { ClaimNode, TruthState, ClaimGraph } from './types.js';
export interface TruthStateResult {
    claimId: string;
    truthState: TruthState;
    derivedFrom: {
        supportEdges: string[];
        contradictionEdges: string[];
        groundingEdges: string[];
    };
    confidence: number;
}
export interface TruthDerivationResult {
    results: TruthStateResult[];
    summary: {
        supported: number;
        contradicted: number;
        unverified: number;
        ungrounded: number;
        total: number;
    };
}
export declare function deriveTruthStatesFromGraph(graph: ClaimGraph): TruthDerivationResult;
export interface TruthScores {
    /** Percentage of claims with transcript grounding */
    transcriptGrounding: number;
    /** Percentage of claims with external verification */
    externalVerification: number;
    /** Consistency score based on contradictions */
    consistency: number;
    /** Overall audit-ready truth score */
    auditTruth: number;
}
export declare function computeTruthScores(derivation: TruthDerivationResult): TruthScores;
export declare function applyTruthStatesToClaims(claims: ClaimNode[], derivation: TruthDerivationResult): void;
