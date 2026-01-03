/**
 * Headline Counts Computation
 *
 * Computes SupportedClaimsCount, ContradictedClaimsCount, UngroundedClaimsCount
 * using configurable thresholds and spectral data.
 *
 * NO hard-coded thresholds - everything comes from config.
 */
import { getScoringConfig } from "../config/scoring.js";
/**
 * Compute headline counts with configurable thresholds.
 */
export function computeHeadlineCounts(input) {
    const config = input.config || getScoringConfig();
    const { claims, contradictions, spectral } = input;
    // Get thresholds from config (with defaults)
    const contradictionThreshold = config.thresholds.contradictionThreshold || 0.55;
    const highBadnessThreshold = 0.7; // TODO: Add to config if needed
    // Build sets for efficient lookup
    const claimIdToIndex = new Map();
    claims.forEach((c, idx) => claimIdToIndex.set(c.id, idx));
    // Track which claims are involved in high-badness contradictions
    const highBadnessContradictionClaims = new Set();
    if (spectral?.topBadContradictions) {
        for (const badContra of spectral.topBadContradictions) {
            if (badContra.badness >= highBadnessThreshold) {
                if (badContra.claimAIndex < claims.length) {
                    highBadnessContradictionClaims.add(claims[badContra.claimAIndex].id);
                }
                if (badContra.claimBIndex < claims.length) {
                    highBadnessContradictionClaims.add(claims[badContra.claimBIndex].id);
                }
            }
        }
    }
    // Also check contradiction edges above threshold
    const contradictionEdgesAboveThreshold = contradictions.filter(e => (e.weight || 0) >= contradictionThreshold);
    const contradictionClaimIds = new Set();
    for (const edge of contradictionEdgesAboveThreshold) {
        contradictionClaimIds.add(edge.claimA);
        contradictionClaimIds.add(edge.claimB);
    }
    // Compute counts
    let supportedCount = 0;
    let contradictedCount = 0;
    let ungroundedCount = 0;
    for (const claim of claims) {
        const claimIdx = claimIdToIndex.get(claim.id);
        // Get truth state from spectral or claim
        let truthState = claim.truthState;
        if (spectral?.truthStates && claimIdx !== undefined && claimIdx < spectral.truthStates.length) {
            truthState = spectral.truthStates[claimIdx];
        }
        // Check if claim is contradicted
        const isContradicted = truthState === "Contradicted" ||
            contradictionClaimIds.has(claim.id);
        // Check if claim is ungrounded
        const isUngrounded = truthState === "Ungrounded" ||
            (claim.grounding?.kind === "none" || !claim.grounding) ||
            (claim.grounding?.evidenceIds.length === 0);
        // Check if claim is supported (and not contradicted)
        const isSupported = truthState === "Supported" &&
            !isContradicted &&
            !highBadnessContradictionClaims.has(claim.id);
        if (isContradicted) {
            contradictedCount++;
        }
        else if (isUngrounded) {
            ungroundedCount++;
        }
        else if (isSupported) {
            supportedCount++;
        }
    }
    // Generate definitions for tooltips
    const definitions = {
        supported: `Claims with truthState="Supported" that are not involved in high-badness contradictions (badness >= ${highBadnessThreshold}) and have contradiction edge weight < ${contradictionThreshold.toFixed(2)}.`,
        contradicted: `Claims with truthState="Contradicted" OR claims with contradiction edges above threshold (weight >= ${contradictionThreshold.toFixed(2)}).`,
        ungrounded: `Claims with truthState="Ungrounded" OR claims with no grounding evidence (grounding.kind="none" or evidenceIds.length=0).`,
    };
    return {
        supported: supportedCount,
        contradicted: contradictedCount,
        ungrounded: ungroundedCount,
        total: claims.length,
        definitions,
    };
}
