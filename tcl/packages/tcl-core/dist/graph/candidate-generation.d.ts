/**
 * Stage A: Candidate Generation (High Recall)
 *
 * Goal: Produce candidate pairs per claim WITHOUT scoring everything.
 *
 * Uses per-claim budgets (not global caps that starve individual claims).
 *
 * Candidate sources:
 * - Other claims in the interaction (within topic window)
 * - Evidence nodes (policies, facts, docs, tool logs)
 * - Transcript evidence nodes
 */
import { ClaimNode, EvidenceNode } from './types.js';
export interface ClaimPairCandidate {
    claimA: ClaimNode;
    claimB: ClaimNode;
    retrievalScore: number;
    signals: CandidateSignals;
}
export interface ClaimEvidenceCandidate {
    claim: ClaimNode;
    evidence: EvidenceNode;
    retrievalScore: number;
    signals: CandidateSignals;
}
export interface CandidateSignals {
    slotMatch: number;
    entityOverlap: number;
    semanticSimilarity: number;
    temporalProximity: number;
    speakerRole: number;
}
export interface CandidateGenerationResult {
    contradictionCandidates: ClaimPairCandidate[];
    supportClaimCandidates: ClaimPairCandidate[];
    supportEvidenceCandidates: ClaimEvidenceCandidate[];
    groundingCandidates: ClaimEvidenceCandidate[];
    diagnostics: {
        totalClaimsProcessed: number;
        totalCandidatesGenerated: number;
        budgetExhausted: boolean;
        claimsWithZeroCandidates: number;
    };
}
export declare function generateCandidates(claims: ClaimNode[], evidenceNodes: EvidenceNode[]): CandidateGenerationResult;
