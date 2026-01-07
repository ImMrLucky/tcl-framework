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
import { getTemplateConfig } from './template-config.js';
import { computeSlotSimilarity } from './subject-slot.js';
// =============================================================================
// MAIN CANDIDATE GENERATION FUNCTION
// =============================================================================
export function generateCandidates(claims, evidenceNodes) {
    const config = getTemplateConfig();
    const budgets = config.budgets;
    const contradictionCandidates = [];
    const supportClaimCandidates = [];
    const supportEvidenceCandidates = [];
    const groundingCandidates = [];
    let claimsWithZeroCandidates = 0;
    // Process each claim
    for (const claim of claims) {
        // Get candidates for this claim
        const claimContradictionCandidates = getCandidatesForContradiction(claim, claims, budgets.perClaim.contradictionPairs, config.weights.retrieval);
        const claimSupportCandidates = getCandidatesForSupport(claim, claims, budgets.perClaim.supportClaimPairs, config.weights.retrieval);
        const evidenceSupportCandidates = getCandidatesForEvidenceSupport(claim, evidenceNodes.filter(e => e.evidenceKind !== 'transcript'), budgets.perClaim.supportEvidencePairs, config.weights.retrieval);
        const transcriptGroundingCandidates = getCandidatesForGrounding(claim, evidenceNodes.filter(e => e.evidenceKind === 'transcript'), budgets.perClaim.groundingPairs, config.weights.retrieval);
        // Track claims with no candidates
        if (claimContradictionCandidates.length === 0 &&
            claimSupportCandidates.length === 0 &&
            evidenceSupportCandidates.length === 0 &&
            transcriptGroundingCandidates.length === 0) {
            claimsWithZeroCandidates++;
        }
        // Add to global lists
        contradictionCandidates.push(...claimContradictionCandidates);
        supportClaimCandidates.push(...claimSupportCandidates);
        supportEvidenceCandidates.push(...evidenceSupportCandidates);
        groundingCandidates.push(...transcriptGroundingCandidates);
    }
    // Check global budget (safety cap only - should not starve per-claim budgets)
    let budgetExhausted = false;
    const totalCandidates = contradictionCandidates.length +
        supportClaimCandidates.length +
        supportEvidenceCandidates.length +
        groundingCandidates.length;
    if (budgets.global?.maxPairsTotal && totalCandidates > budgets.global.maxPairsTotal) {
        budgetExhausted = true;
        // Log warning but don't aggressively filter - per-claim budgets are primary
        console.warn(`[CandidateGeneration] Total candidates (${totalCandidates}) exceeds global cap (${budgets.global.maxPairsTotal}). Consider increasing global budget.`);
    }
    return {
        contradictionCandidates,
        supportClaimCandidates,
        supportEvidenceCandidates,
        groundingCandidates,
        diagnostics: {
            totalClaimsProcessed: claims.length,
            totalCandidatesGenerated: totalCandidates,
            budgetExhausted,
            claimsWithZeroCandidates,
        },
    };
}
// =============================================================================
// CONTRADICTION CANDIDATES
// =============================================================================
function getCandidatesForContradiction(claim, allClaims, budget, weights) {
    const candidates = [];
    for (const other of allClaims) {
        // Skip self
        if (claim.id === other.id)
            continue;
        // Compute retrieval signals
        const signals = computeRetrievalSignals(claim, other);
        // Compute weighted score
        const retrievalScore = weights.slotMatch * signals.slotMatch +
            weights.entityOverlap * signals.entityOverlap +
            weights.semanticSimilarity * signals.semanticSimilarity +
            weights.temporalProximity * signals.temporalProximity +
            weights.speakerRole * signals.speakerRole;
        candidates.push({
            claimA: claim,
            claimB: other,
            retrievalScore,
            signals,
        });
    }
    // Sort by retrieval score and take top K
    candidates.sort((a, b) => b.retrievalScore - a.retrievalScore);
    return candidates.slice(0, budget);
}
// =============================================================================
// SUPPORT (CLAIM-TO-CLAIM) CANDIDATES
// =============================================================================
function getCandidatesForSupport(claim, allClaims, budget, weights) {
    const candidates = [];
    for (const other of allClaims) {
        if (claim.id === other.id)
            continue;
        const signals = computeRetrievalSignals(claim, other);
        // For support, we weight semantic similarity higher
        const retrievalScore = weights.slotMatch * 0.3 * signals.slotMatch + // Lower slot weight for support
            weights.entityOverlap * signals.entityOverlap +
            weights.semanticSimilarity * 1.5 * signals.semanticSimilarity + // Higher semantic weight
            weights.temporalProximity * signals.temporalProximity +
            weights.speakerRole * signals.speakerRole;
        candidates.push({
            claimA: claim,
            claimB: other,
            retrievalScore,
            signals,
        });
    }
    candidates.sort((a, b) => b.retrievalScore - a.retrievalScore);
    return candidates.slice(0, budget);
}
// =============================================================================
// SUPPORT (CLAIM-TO-EVIDENCE) CANDIDATES
// =============================================================================
function getCandidatesForEvidenceSupport(claim, evidenceNodes, budget, weights) {
    const candidates = [];
    for (const evidence of evidenceNodes) {
        const signals = computeClaimEvidenceSignals(claim, evidence);
        // Evidence support prioritizes content match
        const retrievalScore = weights.entityOverlap * signals.entityOverlap +
            weights.semanticSimilarity * 1.5 * signals.semanticSimilarity;
        candidates.push({
            claim,
            evidence,
            retrievalScore,
            signals,
        });
    }
    candidates.sort((a, b) => b.retrievalScore - a.retrievalScore);
    return candidates.slice(0, budget);
}
// =============================================================================
// GROUNDING CANDIDATES
// =============================================================================
function getCandidatesForGrounding(claim, transcriptEvidence, budget, weights) {
    const candidates = [];
    for (const evidence of transcriptEvidence) {
        const signals = computeClaimEvidenceSignals(claim, evidence);
        // Grounding prioritizes exact text match
        const retrievalScore = signals.semanticSimilarity * 0.7 + // Text similarity
            signals.temporalProximity * 0.3; // Turn proximity
        candidates.push({
            claim,
            evidence,
            retrievalScore,
            signals,
        });
    }
    candidates.sort((a, b) => b.retrievalScore - a.retrievalScore);
    return candidates.slice(0, budget);
}
// =============================================================================
// SIGNAL COMPUTATION
// =============================================================================
function computeRetrievalSignals(a, b) {
    return {
        slotMatch: computeSlotSimilarity(a.slot, b.slot),
        entityOverlap: computeEntityOverlap(a.entities, b.entities),
        semanticSimilarity: computeTextSimilarity(a.text, b.text),
        temporalProximity: computeTemporalProximity(a, b),
        speakerRole: computeSpeakerRoleScore(a.speakerRole, b.speakerRole),
    };
}
function computeClaimEvidenceSignals(claim, evidence) {
    const evidenceText = evidence.content || evidence.title || '';
    // For transcript evidence, compute temporal proximity using turn matching
    let temporalProximity = 0;
    if (evidence.evidenceKind === 'transcript' && evidence.anchors?.length) {
        // Extract turn index from evidence anchor
        const evidenceAnchor = evidence.anchors[0];
        const evidenceTurnMatch = evidenceAnchor.ref?.match(/turn-(\d+)/);
        const evidenceTurn = evidenceTurnMatch ? parseInt(evidenceTurnMatch[1], 10) : -1;
        // Extract turn index from claim
        const claimTurnMatch = claim.span.turnId.match(/turn-(\d+)/);
        const claimTurn = claimTurnMatch ? parseInt(claimTurnMatch[1], 10) : -1;
        if (evidenceTurn >= 0 && claimTurn >= 0) {
            const turnDistance = Math.abs(claimTurn - evidenceTurn);
            // Exact match (same turn) = 1.0, adjacent turns = 0.9, etc.
            if (turnDistance === 0) {
                temporalProximity = 1.0; // Same turn - perfect grounding
            }
            else if (turnDistance === 1) {
                temporalProximity = 0.8; // Adjacent turn - likely response
            }
            else if (turnDistance <= 3) {
                temporalProximity = 0.5;
            }
            else {
                temporalProximity = 0.2;
            }
        }
    }
    return {
        slotMatch: 0, // N/A for evidence
        entityOverlap: computeEntityOverlapWithEvidence(claim.entities, evidence),
        semanticSimilarity: computeTextSimilarity(claim.text, evidenceText),
        temporalProximity,
        speakerRole: 0, // N/A
    };
}
// =============================================================================
// OVERLAP AND SIMILARITY FUNCTIONS
// =============================================================================
function computeEntityOverlap(entitiesA, entitiesB) {
    if (entitiesA.length === 0 || entitiesB.length === 0)
        return 0;
    const keysA = new Set(entitiesA.map(e => `${e.type}:${e.normalized || e.value}`));
    const keysB = new Set(entitiesB.map(e => `${e.type}:${e.normalized || e.value}`));
    let intersection = 0;
    for (const key of keysA) {
        if (keysB.has(key))
            intersection++;
    }
    // Jaccard similarity
    const union = keysA.size + keysB.size - intersection;
    return union > 0 ? intersection / union : 0;
}
function computeEntityOverlapWithEvidence(entities, evidence) {
    // Check if evidence fields contain matching entity values
    if (evidence.fields) {
        for (const entity of entities) {
            const normalizedValue = entity.normalized || entity.value;
            for (const fieldValue of Object.values(evidence.fields)) {
                if (String(fieldValue).includes(String(normalizedValue))) {
                    return 0.8; // High match
                }
            }
        }
    }
    // Check content for entity mentions
    if (evidence.content) {
        for (const entity of entities) {
            if (evidence.content.toLowerCase().includes(String(entity.value).toLowerCase())) {
                return 0.5;
            }
        }
    }
    return 0;
}
function computeTextSimilarity(textA, textB) {
    // Tokenize and compute Jaccard similarity
    const tokensA = tokenize(textA);
    const tokensB = tokenize(textB);
    if (tokensA.size === 0 || tokensB.size === 0)
        return 0;
    let intersection = 0;
    for (const token of tokensA) {
        if (tokensB.has(token))
            intersection++;
    }
    const union = tokensA.size + tokensB.size - intersection;
    return union > 0 ? intersection / union : 0;
}
function tokenize(text) {
    const stopWords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
        'in', 'for', 'on', 'with', 'at', 'by', 'from', 'i', 'you', 'that', 'this',
    ]);
    return new Set(text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w)));
}
function computeTemporalProximity(a, b) {
    // Use turn IDs to compute proximity
    const turnA = parseInt(a.span.turnId.replace(/[^\d]/g, ''), 10) || 0;
    const turnB = parseInt(b.span.turnId.replace(/[^\d]/g, ''), 10) || 0;
    const distance = Math.abs(turnA - turnB);
    // Decay function: closer turns have higher score
    // Within 5 turns: high score
    // Beyond 20 turns: low score
    if (distance <= 5)
        return 1.0;
    if (distance <= 10)
        return 0.7;
    if (distance <= 20)
        return 0.4;
    return 0.1;
}
function computeSpeakerRoleScore(roleA, roleB) {
    // Same speaker can contradict themselves (revisions)
    if (roleA === roleB)
        return 0.6;
    // Agent vs Customer: high relevance for contradiction
    if ((roleA === 'agent' && roleB === 'customer') ||
        (roleA === 'customer' && roleB === 'agent')) {
        return 1.0;
    }
    return 0.3;
}
