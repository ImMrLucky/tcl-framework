/**
 * Compute truth score from graph data (interim solution)
 *
 * This is a bridge function until full ClaimResults integration.
 * It computes truth score incorporating contradictions properly.
 */
import type { Claim, ContradictionEdge, SupportEdge, GroundingEdge } from '../types.js';
export interface GraphBasedTruthScore {
    /**
     * Truth score incorporating contradictions
     */
    truth: number;
    /**
     * Consistency score (based on contradictions)
     */
    consistency: number;
    /**
     * Transcript grounding score
     */
    transcriptGrounding: number;
    /**
     * Number of contradictions above threshold
     */
    contradictionsAboveThreshold: number;
}
/**
 * Compute truth score from graph data
 *
 * This ensures truth cannot be 100 if contradictions exist above threshold.
 */
export declare function computeTruthFromGraph(claims: Claim[], contradictions: ContradictionEdge[], supports: SupportEdge[], grounding: GroundingEdge[], mode?: 'transcript_only' | 'with_external_docs'): GraphBasedTruthScore;
