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
  risk?: number; // 1 - overall, for easy consumption
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
  // 1. Grounding score: based on evidence (max weight of grounding edges)
  const groundingEdges = grounding.filter(e => e.claimId === claim.id);
  const groundingScore = groundingEdges.length > 0
    ? Math.max(...groundingEdges.map(e => e.weight)) // Use max, not average
    : 0.0; // 0 if no grounding edges

  // 2. Support score: normalized sum of incoming support weights
  const supportEdges = supports.filter(e => e.claimB === claim.id);
  const supportScore = supportEdges.length > 0
    ? Math.min(1.0, supportEdges.reduce((sum, e) => sum + e.weight, 0) / Math.max(1, supportEdges.length))
    : 0.0; // 0 if no support (not 0.5 - be honest)

  // 3. Contradiction score: inverse of contradictions (higher = fewer contradictions)
  const contradictionEdges = contradictions.filter(
    e => e.claimA === claim.id || e.claimB === claim.id
  );
  const contradictionCount = contradictionEdges.length;
  const contradictionWeight = contradictionEdges.reduce((sum, e) => sum + e.weight, 0);
  // Higher contradiction weight = lower score
  const contradictionScore = Math.max(0.0, 1.0 - Math.min(1.0, contradictionWeight));

  // 4. Overall: weighted average
  // Grounding is most important (40%), then contradiction (35%), then support (25%)
  const overall = (
    groundingScore * 0.4 +
    contradictionScore * 0.35 +
    supportScore * 0.25
  );

        const overallClamped = Math.max(0, Math.min(1, overall));
        return {
          groundingScore: Math.max(0, Math.min(1, groundingScore)),
          supportScore: Math.max(0, Math.min(1, supportScore)),
          contradictionScore: Math.max(0, Math.min(1, contradictionScore)),
          overall: overallClamped,
          risk: 1 - overallClamped // Add risk metric
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

