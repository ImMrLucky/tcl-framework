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
import { getTemplateConfig } from './template-config.js';
// =============================================================================
// MAIN CALIBRATION FUNCTION
// =============================================================================
export function calibrateEdgeWeight(input) {
    const config = getTemplateConfig();
    const weights = config.weights.calibration;
    // Compute individual factors
    const factors = {
        methodAgreement: computeMethodAgreement(input.nliScore, input.heuristicScore),
        evidenceStrength: computeEvidenceStrength(input.evidence, config.weights.evidenceStrength),
        modalityWeight: computeModalityWeight(input.claim),
        asrConfidenceFactor: input.asrConfidence ?? 1.0,
        slotMatchBonus: computeSlotMatchBonus(input.edge),
    };
    // Combine factors into calibrated weight
    let calibratedWeight = input.edge.weight;
    // Apply method agreement multiplier
    calibratedWeight *= (0.5 + 0.5 * factors.methodAgreement);
    // Apply evidence strength for support edges
    if (input.edge.type === 'SUPPORT' && input.evidence) {
        calibratedWeight *= factors.evidenceStrength;
    }
    // Apply modality weight for claim-based edges
    if (input.claim) {
        calibratedWeight *= (0.7 + 0.3 * factors.modalityWeight);
    }
    // Apply ASR confidence
    calibratedWeight *= factors.asrConfidenceFactor;
    // E3: Apply contradiction class-based weight calibration
    if (input.edge.type === 'CONTRADICTION') {
        // Apply slot match bonus
        calibratedWeight *= (0.8 + 0.2 * factors.slotMatchBonus);
        // E3: Apply contradiction class multiplier (hard mismatch vs soft correction)
        const contradictionClass = input.edge.rationale.signals.contradictionClass;
        if (contradictionClass) {
            // Higher base weight for hard mismatches, lower for soft inconsistencies
            const classMultipliers = {
                'NUMERIC_MISMATCH': 1.15, // Different amounts/days - high weight
                'BINARY_REVERSAL': 1.20, // yes/no, recorded/not - very high weight
                'COMMITMENT_REVERSAL': 1.25, // guaranteed → walkback - highest weight
                'POLICY_ASSERTION': 1.18, // CVV storage, required fee - high compliance risk
                'SOFT_INCONSISTENCY': 0.85, // Uncertain statements, hedges - lower weight
            };
            const multiplier = classMultipliers[contradictionClass] || 1.0;
            calibratedWeight *= multiplier;
        }
    }
    // CRITICAL: For CONTRADICTION edges, calibration must never reduce the original classification confidence.
    // If an edge was strong enough to be labeled a contradiction, it remains strong enough to count as one.
    // However, E3 allows SOFT_INCONSISTENCY to be lower than original (they're intentionally softer)
    if (input.edge.type === 'CONTRADICTION') {
        const contradictionClass = input.edge.rationale.signals.contradictionClass;
        if (contradictionClass !== 'SOFT_INCONSISTENCY') {
            // For hard mismatches, never reduce below original
            calibratedWeight = Math.max(input.edge.weight, calibratedWeight);
        }
        // For SOFT_INCONSISTENCY, allow reduction (they're intentionally softer)
    }
    // Clamp to 0-1
    calibratedWeight = Math.min(1, Math.max(0, calibratedWeight));
    // Compute overall confidence
    const confidence = computeOverallConfidence(factors);
    return {
        calibratedWeight,
        confidence,
        factors,
    };
}
// =============================================================================
// BATCH CALIBRATION
// =============================================================================
export function calibrateEdges(edges, claims, evidence) {
    return edges.map(edge => {
        const claim = claims.get(edge.from);
        const evidenceNode = evidence.get(edge.to);
        const input = {
            edge,
            claim,
            evidence: evidenceNode,
            nliScore: edge.rationale.signals.nliScore,
            heuristicScore: edge.rationale.signals.slotMatchScore,
        };
        const result = calibrateEdgeWeight(input);
        return {
            ...edge,
            weight: result.calibratedWeight,
            rationale: {
                ...edge.rationale,
                signals: {
                    ...edge.rationale.signals,
                    calibration: result.factors,
                    calibrationConfidence: result.confidence,
                },
            },
        };
    });
}
// =============================================================================
// METHOD AGREEMENT
// =============================================================================
function computeMethodAgreement(nliScore, heuristicScore) {
    if (nliScore === undefined && heuristicScore === undefined) {
        return 0.5; // No data, neutral
    }
    if (nliScore === undefined || heuristicScore === undefined) {
        return 0.7; // One method only
    }
    // Both methods available - compute agreement
    const diff = Math.abs(nliScore - heuristicScore);
    // Perfect agreement = 1.0, complete disagreement = 0.0
    return 1.0 - diff;
}
// =============================================================================
// EVIDENCE STRENGTH
// =============================================================================
function computeEvidenceStrength(evidence, evidenceWeights) {
    if (!evidence)
        return 0.5;
    return evidenceWeights[evidence.evidenceKind] || 0.5;
}
// =============================================================================
// MODALITY WEIGHT
// =============================================================================
function computeModalityWeight(claim) {
    if (!claim)
        return 0.5;
    // Strong modalities get higher weight
    const modalityWeights = {
        'assert': 0.8,
        'promise': 0.9, // Promises are strong commitments
        'deny': 0.8,
        'hedge': 0.4, // Hedged claims are uncertain
        'question': 0.2, // Questions aren't claims
    };
    let weight = modalityWeights[claim.modality] || 0.5;
    // Agent claims are stronger than customer claims
    if (claim.speakerRole === 'agent') {
        weight *= 1.1;
    }
    else if (claim.speakerRole === 'customer') {
        weight *= 0.9;
    }
    return Math.min(1, weight);
}
// =============================================================================
// SLOT MATCH BONUS
// =============================================================================
function computeSlotMatchBonus(edge) {
    // Check if edge has explicit slot information
    if (!edge.slot || edge.slot.slotType === 'unknown') {
        return 0.5;
    }
    // Check if rationale has slot match score
    const slotMatchScore = edge.rationale.signals.slotMatchScore;
    if (typeof slotMatchScore === 'number') {
        return slotMatchScore;
    }
    // Default: assume slot matched if we got here
    return 0.8;
}
// =============================================================================
// OVERALL CONFIDENCE
// =============================================================================
function computeOverallConfidence(factors) {
    // Weighted average of factors
    const weights = {
        methodAgreement: 0.3,
        evidenceStrength: 0.25,
        modalityWeight: 0.2,
        asrConfidenceFactor: 0.15,
        slotMatchBonus: 0.1,
    };
    return (factors.methodAgreement * weights.methodAgreement +
        factors.evidenceStrength * weights.evidenceStrength +
        factors.modalityWeight * weights.modalityWeight +
        factors.asrConfidenceFactor * weights.asrConfidenceFactor +
        factors.slotMatchBonus * weights.slotMatchBonus);
}
// =============================================================================
// THRESHOLD APPLICATION
// =============================================================================
export function applyThresholds(edges, thresholds) {
    return edges.filter(edge => {
        switch (edge.type) {
            case 'SUPPORT':
                return edge.weight >= thresholds.support;
            case 'CONTRADICTION':
                return edge.weight >= thresholds.contradiction;
            case 'GROUNDING':
                return edge.weight >= thresholds.grounding;
            default:
                return true;
        }
    });
}
