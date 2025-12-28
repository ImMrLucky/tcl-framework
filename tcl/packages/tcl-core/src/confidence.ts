/**
 * Confidence scoring for claims
 * Calculates detailed confidence metrics based on grounding, support, and contradictions
 * Decoupled from specific use cases - works for any domain
 */

import type { Claim, SupportEdge, ContradictionEdge, GroundingEdge } from "./types.js";

export type ConfidenceMetrics = {
  groundingScore: number; // 0-1, based on evidence
  supportScore: number; // 0-1, based on support from other claims
  contradictionScore: number; // 0-1, inverse (higher = fewer contradictions)
  overall: number; // 0-1, weighted average
};

/**
 * Calculate confidence metrics for a claim
 */
export function calculateClaimConfidence(
  claim: Claim,
  supports: SupportEdge[],
  contradictions: ContradictionEdge[],
  grounding: GroundingEdge[]
): ConfidenceMetrics {
  // 1. Grounding score: based on evidence
  const groundingEdges = grounding.filter(e => e.claimId === claim.id);
  const groundingScore = groundingEdges.length > 0
    ? Math.min(1.0, groundingEdges.reduce((sum, e) => sum + e.weight, 0) / groundingEdges.length)
    : 0.0;

  // 2. Support score: how well supported by other claims
  const supportEdges = supports.filter(e => e.claimB === claim.id);
  const supportScore = supportEdges.length > 0
    ? Math.min(1.0, supportEdges.reduce((sum, e) => sum + e.weight, 0) / supportEdges.length)
    : 0.5; // Neutral if no support (not necessarily bad)

  // 3. Contradiction score: inverse of contradictions (higher = fewer contradictions)
  const contradictionEdges = contradictions.filter(
    e => e.claimA === claim.id || e.claimB === claim.id
  );
  const contradictionCount = contradictionEdges.length;
  const contradictionScore = Math.max(0.0, 1.0 - (contradictionCount * 0.3)); // Each contradiction reduces by 0.3

  // 4. Overall: weighted average
  // Grounding is most important (40%), then contradiction (35%), then support (25%)
  const overall = (
    groundingScore * 0.4 +
    contradictionScore * 0.35 +
    supportScore * 0.25
  );

  return {
    groundingScore: Math.max(0, Math.min(1, groundingScore)),
    supportScore: Math.max(0, Math.min(1, supportScore)),
    contradictionScore: Math.max(0, Math.min(1, contradictionScore)),
    overall: Math.max(0, Math.min(1, overall))
  };
}

/**
 * Calculate confidence metrics for all claims
 */
export function calculateAllClaimConfidences(
  claims: Claim[],
  supports: SupportEdge[],
  contradictions: ContradictionEdge[],
  grounding: GroundingEdge[]
): Map<string, ConfidenceMetrics> {
  const metricsMap = new Map<string, ConfidenceMetrics>();
  
  claims.forEach(claim => {
    const metrics = calculateClaimConfidence(claim, supports, contradictions, grounding);
    metricsMap.set(claim.id, metrics);
  });

  return metricsMap;
}

