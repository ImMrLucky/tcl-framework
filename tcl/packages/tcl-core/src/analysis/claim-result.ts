/**
 * ClaimResult - Canonical Per-Claim Output Model
 * 
 * Compute once, reuse everywhere. All counts, scores, and issues must derive from this.
 */

import type { Claim } from '../types.js';

export type GroundingKind = 'transcript' | 'external' | 'none';
export type VerificationKind = 'external_verified' | 'transcript_only' | 'unknown';
export type FinalTruthState = 'Supported' | 'Inconclusive' | 'Contradicted' | 'Ungrounded';

export interface EdgeRef {
  edgeId: string;
  type: 'support' | 'contradiction' | 'grounding';
  weight: number;
  reason?: string;
  ruleId?: string;
}

export interface ClaimResult {
  /**
   * Original claim ID
   */
  claimId: string;
  
  /**
   * Speaker who made the claim
   */
  speaker: 'AGENT' | 'CUSTOMER' | 'SYSTEM' | 'UNKNOWN';
  
  /**
   * Original claim text
   */
  text: string;
  
  /**
   * Turn index/range where claim occurred
   */
  turnIndex?: number;
  turnRange?: [number, number];
  
  /**
   * Grounding information
   */
  grounding: {
    /**
     * Kind of grounding evidence
     * - "transcript": Evidence from transcript itself
     * - "external": Evidence from external documents
     * - "none": No evidence found
     */
    kind: GroundingKind;
    
    /**
     * Evidence IDs (claim IDs or source IDs)
     */
    evidenceIds: string[];
    
    /**
     * Grounding score (0-1)
     */
    groundingScore: number;
  };
  
  /**
   * Verification information
   */
  verification: {
    /**
     * Kind of verification
     * - "external_verified": Verified against external docs
     * - "transcript_only": Only transcript evidence (not verified externally)
     * - "unknown": Cannot determine
     */
    kind: VerificationKind;
  };
  
  /**
   * Edge information
   */
  edges: {
    /**
     * Maximum support edge weight
     */
    maxSupportWeight: number;
    
    /**
     * Maximum contradiction edge weight
     */
    maxContradictionWeight: number;
    
    /**
     * All support edges
     */
    supportEdges: EdgeRef[];
    
    /**
     * All contradiction edges
     */
    contradictionEdges: EdgeRef[];
  };
  
  /**
   * Final truth state (computed from edges + thresholds)
   */
  finalTruthState: FinalTruthState;
  
  /**
   * Optional centrality/importance scores
   */
  importance?: number;
  centrality?: number;
  blame?: number;
  
  /**
   * Original claim object (for backward compatibility)
   */
  originalClaim: Claim;
}

/**
 * Compute finalTruthState from edges and thresholds
 */
export function computeFinalTruthState(
  claimResult: Pick<ClaimResult, 'edges' | 'grounding' | 'verification'>,
  config: {
    contradictionThreshold: number;
    contradictedThreshold?: number;
    supportThreshold: number;
    mode: 'transcript_only' | 'with_external_docs';
  }
): FinalTruthState {
  const { edges, grounding, verification } = claimResult;
  
  // Use contradictedThreshold if set, otherwise use contradictionThreshold
  const contradictedThresh = config.contradictedThreshold ?? config.contradictionThreshold;
  
  // Check for contradictions above threshold
  if (edges.maxContradictionWeight >= contradictedThresh) {
    return 'Contradicted';
  }
  
  // Check for support above threshold
  if (edges.maxSupportWeight >= config.supportThreshold) {
    return 'Supported';
  }
  
  // Check grounding based on mode
  if (config.mode === 'transcript_only') {
    // In transcript-only mode, transcript evidence = not ungrounded
    if (grounding.kind === 'transcript') {
      return 'Inconclusive'; // Has transcript evidence but no strong support/contradiction
    }
    if (grounding.kind === 'none') {
      return 'Ungrounded';
    }
  } else {
    // In external-doc mode, check verification
    if (verification.kind === 'external_verified') {
      return 'Supported'; // Verified externally
    }
    if (grounding.kind === 'none') {
      return 'Ungrounded';
    }
    if (verification.kind === 'transcript_only') {
      return 'Inconclusive'; // Has transcript but not verified externally
    }
  }
  
  return 'Inconclusive';
}

/**
 * Create ClaimResult from claim and graph data
 */
export function createClaimResult(
  claim: Claim,
  graphData: {
    supportEdges: EdgeRef[];
    contradictionEdges: EdgeRef[];
    groundingEdges?: EdgeRef[];
    evidenceIds?: string[];
  },
  config: {
    contradictionThreshold: number;
    contradictedThreshold?: number;
    supportThreshold: number;
    mode: 'transcript_only' | 'with_external_docs';
  }
): ClaimResult {
  const maxSupport = graphData.supportEdges.length > 0
    ? Math.max(...graphData.supportEdges.map(e => e.weight))
    : 0;
  
  const maxContradiction = graphData.contradictionEdges.length > 0
    ? Math.max(...graphData.contradictionEdges.map(e => e.weight))
    : 0;
  
  // Determine grounding kind
  let groundingKind: GroundingKind = 'none';
  if (graphData.evidenceIds && graphData.evidenceIds.length > 0) {
    // Check if any evidence is from external sources
    // This is simplified - in practice, you'd check source types
    groundingKind = 'transcript'; // Default to transcript for now
  }
  
  // Determine verification kind
  let verificationKind: VerificationKind = 'unknown';
  if (config.mode === 'with_external_docs') {
    if (graphData.evidenceIds && graphData.evidenceIds.length > 0) {
      verificationKind = 'external_verified'; // Simplified
    } else if (groundingKind === 'transcript') {
      verificationKind = 'transcript_only';
    }
  } else {
    if (groundingKind === 'transcript') {
      verificationKind = 'transcript_only';
    }
  }
  
  const result: ClaimResult = {
    claimId: claim.id,
    speaker: claim.speaker || 'UNKNOWN',
    text: claim.text,
    turnIndex: claim.turnIndex,
    grounding: {
      kind: groundingKind,
      evidenceIds: graphData.evidenceIds || [],
      groundingScore: graphData.groundingEdges?.length > 0
        ? Math.max(...graphData.groundingEdges.map(e => e.weight))
        : 0,
    },
    verification: {
      kind: verificationKind,
    },
    edges: {
      maxSupportWeight: maxSupport,
      maxContradictionWeight: maxContradiction,
      supportEdges: graphData.supportEdges,
      contradictionEdges: graphData.contradictionEdges,
    },
    finalTruthState: 'Inconclusive', // Will be computed below
    originalClaim: claim,
  };
  
  // Compute final truth state
  result.finalTruthState = computeFinalTruthState(result, config);
  
  return result;
}

