/**
 * Headline Counts Computation
 * 
 * Computes SupportedClaimsCount, ContradictedClaimsCount, UngroundedClaimsCount
 * using configurable thresholds and spectral data.
 * 
 * IMPORTANT: These counts use the ACTUAL edges that were built by the graph builder.
 * If an edge exists, it already passed its threshold during creation.
 * We should NOT re-apply different thresholds when counting!
 * 
 * DEPRECATED: Use computeCountsFromClaims() from counts-from-claims.ts instead.
 * This function is kept for backward compatibility but should be replaced.
 */

import type { Claim, SpectralReport, ContradictionEdge, SupportEdge, GroundingEdge } from "../types.js";
import { getScoringConfig } from "../config/scoring.js";
import { getEngineConfig } from "../config/engine-config.js";

export interface HeadlineCounts {
  supported: number;
  contradicted: number;
  ungrounded: number;
  unverified: number; // NEW: has transcript evidence but no external verification
  total: number;
  definitions: {
    supported: string;
    contradicted: string;
    ungrounded: string;
    unverified: string;
  };
}

export interface ComputeCountsInput {
  claims: Claim[];
  contradictions: ContradictionEdge[];
  supports?: SupportEdge[]; // NEW: Include support edges
  grounding?: GroundingEdge[]; // NEW: Include grounding edges
  spectral?: SpectralReport;
  config?: ReturnType<typeof getScoringConfig>;
}

/**
 * Compute headline counts using ACTUAL edges from the graph builder.
 * 
 * CRITICAL: If an edge EXISTS, it already passed its threshold during creation.
 * We should NOT re-apply different thresholds when counting!
 * 
 * The spectral truthStates are the authoritative source for claim classification.
 */
export function computeHeadlineCounts(input: ComputeCountsInput): HeadlineCounts {
  const engineConfig = getEngineConfig();
  const { claims, contradictions, supports = [], grounding = [], spectral } = input;
  
  // Build sets from ACTUAL edges (if an edge exists, it passed its threshold)
  const claimIdToIndex = new Map<string, number>();
  claims.forEach((c, idx) => claimIdToIndex.set(c.id, idx));
  
  // Claims involved in ANY contradiction edge (edge exists = passed threshold)
  const contradictedClaimIds = new Set<string>();
  for (const edge of contradictions) {
    contradictedClaimIds.add(edge.claimA);
    contradictedClaimIds.add(edge.claimB);
  }
  
  // Claims involved in support edges
  const supportedByEdgeClaimIds = new Set<string>();
  for (const edge of supports) {
    supportedByEdgeClaimIds.add(edge.claimA);
    supportedByEdgeClaimIds.add(edge.claimB);
  }
  
  // Claims with grounding edges (has transcript evidence)
  const groundedClaimIds = new Set<string>();
  for (const edge of grounding) {
    groundedClaimIds.add(edge.claimId);
  }
  
  // Also track high-badness contradictions from spectral
  const highBadnessContradictionClaims = new Set<string>();
  const highBadnessThreshold = 0.7;
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
  
  // Compute counts
  let supportedCount = 0;
  let contradictedCount = 0;
  let ungroundedCount = 0;
  let unverifiedCount = 0;
  
  for (const claim of claims) {
    const claimIdx = claimIdToIndex.get(claim.id);
    
    // Get truth state from spectral if available
    let truthState: string | undefined = claim.truthState;
    if (spectral?.truthStates && claimIdx !== undefined && claimIdx < spectral.truthStates.length) {
      truthState = spectral.truthStates[claimIdx];
    }
    
    // Check if claim has transcript evidence (grounding edge exists or good grounding score)
    const hasTranscriptEvidence = 
      groundedClaimIds.has(claim.id) ||
      (claim.evidence && claim.evidence.length > 0) ||
      (claim.confidenceMetrics?.groundingScore !== undefined && claim.confidenceMetrics.groundingScore > 0.5);
    
    // Check if claim is contradicted (contradiction edge exists OR spectral says so)
    const isContradicted = 
      truthState === "Contradicted" ||
      contradictedClaimIds.has(claim.id) ||
      highBadnessContradictionClaims.has(claim.id);
    
    // Check if claim is truly ungrounded (NO evidence at all)
    // Important: if hasTranscriptEvidence, it's UNVERIFIED not UNGROUNDED
    const isUngrounded = !hasTranscriptEvidence && truthState !== "Supported";
    
    // Check if claim is unverified (has transcript evidence but that's it)
    // In transcript_only mode, most claims are UNVERIFIED because we can't verify against external docs
    const isUnverified = hasTranscriptEvidence && truthState !== "Contradicted" && truthState !== "Supported";
    
    // Check if claim is supported (spectral says supported AND not contradicted)
    const isSupported = 
      truthState === "Supported" &&
      !isContradicted;
    
    if (isContradicted) {
      contradictedCount++;
    } else if (isUngrounded) {
      ungroundedCount++;
    } else if (isSupported) {
      supportedCount++;
    } else if (isUnverified) {
      unverifiedCount++;
    }
    // Note: some claims may not fall into any bucket (e.g., "Inconclusive" with evidence)
  }
  
  // Generate definitions for tooltips
  const mode = engineConfig.mode;
  const definitions = {
    supported: `Claims with spectral truthState="Supported" that are not involved in contradictions.`,
    contradicted: `Claims with truthState="Contradicted" OR involved in contradiction edges.`,
    ungrounded: `Claims with NO transcript evidence (no grounding edges, no evidence array).`,
    unverified: mode === 'transcript_only' 
      ? `Claims with transcript evidence but not externally verified. This is normal in transcript-only mode.`
      : `Claims with transcript evidence but no external policy/document verification.`,
  };
  
  return {
    supported: supportedCount,
    contradicted: contradictedCount,
    ungrounded: ungroundedCount,
    unverified: unverifiedCount,
    total: claims.length,
    definitions,
  };
}

