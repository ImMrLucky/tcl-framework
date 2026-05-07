/**
 * Stage B: Relationship Classification (Precision)
 *
 * Operates only on candidates from Stage A.
 *
 * CRITICAL GATING RULES:
 * - CONTRADICTION edges require same slot (slotType + entityKey)
 * - CONTRADICTION edges require opposing polarity
 * - SUPPORT edges from transcript create GROUNDING, not SUPPORT
 * - All edges must have rationale and provenance
 */
import { GraphEdge } from './types.js';
import { ClaimPairCandidate, ClaimEvidenceCandidate } from './candidate-generation.js';
export interface EdgeClassificationResult {
    contradictions: GraphEdge[];
    supports: GraphEdge[];
    groundings: GraphEdge[];
    diagnostics: {
        candidatesProcessed: number;
        edgesCreated: number;
        rejectedBySlotGating: number;
        rejectedByTopicGating: number;
        rejectedByPolarityGating: number;
        rejectedByThreshold: number;
        rejectedByIneligibleSlot: number;
        rejectedByValueTypeMismatch: number;
        sampleRejections: Array<{
            claimA: string;
            claimB: string;
            reason: string;
            slotA: string;
            slotB: string;
            textA: string;
            textB: string;
        }>;
    };
}
export declare function classifyEdges(contradictionCandidates: ClaimPairCandidate[], supportClaimCandidates: ClaimPairCandidate[], supportEvidenceCandidates: ClaimEvidenceCandidate[], groundingCandidates: ClaimEvidenceCandidate[]): EdgeClassificationResult;
