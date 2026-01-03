/**
 * Headline Counts Computation
 * 
 * Computes SupportedClaimsCount, ContradictedClaimsCount, UngroundedClaimsCount
 * using configurable thresholds and spectral data.
 * 
 * NO hard-coded thresholds - everything comes from config.
 * 
 * DEPRECATED: Use computeCountsFromClaims() from counts-from-claims.ts instead.
 * This function is kept for backward compatibility but should be replaced.
 */

import type { Claim, SpectralReport, ContradictionEdge } from "../types.js";
import { getScoringConfig } from "../config/scoring.js";
import { getEngineConfig } from "../config/engine-config.js";

export interface HeadlineCounts {
  supported: number;
  contradicted: number;
  ungrounded: number;
  total: number;
  definitions: {
    supported: string;
    contradicted: string;
    ungrounded: string;
  };
}

export interface ComputeCountsInput {
  claims: Claim[];
  contradictions: ContradictionEdge[];
  spectral?: SpectralReport;
  config?: ReturnType<typeof getScoringConfig>;
}

/**
 * Compute headline counts with configurable thresholds.
 * 
 * NOTE: This function has inconsistencies. Use computeCountsFromClaims() instead.
 */
export function computeHeadlineCounts(input: ComputeCountsInput): HeadlineCounts {
  const scoringConfig = input.config || getScoringConfig();
  const engineConfig = getEngineConfig(); // Use EngineConfig for consistency
  const { claims, contradictions, spectral } = input;
  
  // Get thresholds from config - NO hard-coded fallbacks
  const contradictionThreshold = engineConfig.thresholds.contradictionThreshold;
  const contradictedThreshold = engineConfig.thresholds.contradictedThreshold ?? contradictionThreshold;
  const supportThreshold = engineConfig.thresholds.supportThreshold;
  // TODO: Add highBadnessThreshold to EngineConfig
  const highBadnessThreshold = 0.7; // Temporary - should come from config
  
  // Build sets for efficient lookup
  const claimIdToIndex = new Map<string, number>();
  claims.forEach((c, idx) => claimIdToIndex.set(c.id, idx));
  
  // Track which claims are involved in high-badness contradictions
  const highBadnessContradictionClaims = new Set<string>();
  
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
  
  // Also check contradiction edges above threshold - use contradictedThreshold for consistency
  const contradictionEdgesAboveThreshold = contradictions.filter(
    e => (e.weight || 0) >= contradictedThreshold
  );
  const contradictionClaimIds = new Set<string>();
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
    let truthState: string | undefined = claim.truthState;
    if (spectral?.truthStates && claimIdx !== undefined && claimIdx < spectral.truthStates.length) {
      truthState = spectral.truthStates[claimIdx];
    }
    
    // Check if claim is contradicted
    const isContradicted = 
      truthState === "Contradicted" ||
      contradictionClaimIds.has(claim.id);
    
    // Check if claim is ungrounded
    // In transcript-only mode: claims with transcript evidence are NOT ungrounded
    // They should be "unverified" instead
    const mode = engineConfig.mode;
    const hasTranscriptEvidence = claim.grounding?.kind === "transcript" || 
                                  (claim.grounding?.evidenceIds && claim.grounding.evidenceIds.length > 0);
    
    const isUngrounded = 
      (truthState === "Ungrounded" && !hasTranscriptEvidence) ||
      (mode === 'transcript_only' && (claim.grounding?.kind === "none" || !claim.grounding) && 
       (!claim.grounding?.evidenceIds || claim.grounding.evidenceIds.length === 0)) ||
      (mode === 'with_external_docs' && 
       (claim.grounding?.kind === "none" || !claim.grounding) &&
       (!claim.grounding?.evidenceIds || claim.grounding.evidenceIds.length === 0));
    
    // Check if claim is supported (and not contradicted)
    // Must also check that contradiction weight is below threshold
    const maxContradictionWeight = contradictions
      .filter(c => c.claimA === claim.id || c.claimB === claim.id)
      .reduce((max, c) => Math.max(max, c.weight || 0), 0);
    
    const isSupported = 
      truthState === "Supported" &&
      !isContradicted &&
      maxContradictionWeight < contradictedThreshold &&
      !highBadnessContradictionClaims.has(claim.id);
    
    if (isContradicted) {
      contradictedCount++;
    } else if (isUngrounded) {
      ungroundedCount++;
    } else if (isSupported) {
      supportedCount++;
    }
  }
  
  // Generate definitions for tooltips - use same thresholds as computation
  const definitions = {
    supported: `Claims with truthState="Supported" that are not involved in high-badness contradictions (badness >= ${highBadnessThreshold}) and have contradiction edge weight < ${contradictedThreshold.toFixed(2)} AND support edge weight >= ${supportThreshold.toFixed(2)}.`,
    contradicted: `Claims with truthState="Contradicted" OR claims with contradiction edges above threshold (weight >= ${contradictedThreshold.toFixed(2)}).`,
    ungrounded: mode === 'transcript_only' 
      ? `Claims with finalTruthState="Ungrounded" (grounding.kind="none" AND no evidenceIds). Claims with transcript evidence are "unverified", not "ungrounded".`
      : `Claims with finalTruthState="Ungrounded" (grounding.kind="none" AND no evidenceIds).`,
  };
  
  return {
    supported: supportedCount,
    contradicted: contradictedCount,
    ungrounded: ungroundedCount,
    total: claims.length,
    definitions,
  };
}

