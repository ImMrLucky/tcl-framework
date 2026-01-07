/**
 * Stage C: Weight Calibration (Trustworthy weights)
 *
 * Raw model scores are not calibrated.
 * This module produces calibrated weights that spectral.py can trust.
 *
 * Calibration considers:
 * - Agreement between methods (NLI + heuristic)
 * - Evidence strength (policy/system_fact > doc > transcript)
 * - Modality (agent "guarantee" > customer "I think")
 * - ASR confidence (voice transcripts)
 */
import { GraphEdge, ClaimNode, EvidenceNode } from './types.js';
export interface CalibrationInput {
    edge: GraphEdge;
    claim?: ClaimNode;
    evidence?: EvidenceNode;
    nliScore?: number;
    heuristicScore?: number;
    asrConfidence?: number;
}
export interface CalibrationResult {
    calibratedWeight: number;
    confidence: number;
    factors: CalibrationFactors;
}
export interface CalibrationFactors {
    methodAgreement: number;
    evidenceStrength: number;
    modalityWeight: number;
    asrConfidenceFactor: number;
    slotMatchBonus: number;
}
export declare function calibrateEdgeWeight(input: CalibrationInput): CalibrationResult;
export declare function calibrateEdges(edges: GraphEdge[], claims: Map<string, ClaimNode>, evidence: Map<string, EvidenceNode>): GraphEdge[];
export declare function applyThresholds(edges: GraphEdge[], thresholds: {
    support: number;
    contradiction: number;
    grounding: number;
}): GraphEdge[];
