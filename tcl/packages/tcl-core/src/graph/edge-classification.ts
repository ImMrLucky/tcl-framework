/**
 * Stage B: Relationship Classification (Precision)
 * 
 * Operates only on candidates from Stage A.
 * 
 * CRITICAL GATING RULES:
 * - CONTRADICTION edges require same slot (slotType + entityKey)
 * - CONTRADICTION edges require opposing polarity
 * - SUPPORT edges from transcript create GROUNDING, not SUPPORT
 * - All edges must have rationale and provenance
 */

import { 
  ClaimNode, 
  EvidenceNode, 
  GraphEdge, 
  EdgeType,
  EdgeRationale,
  EdgeProvenance,
  SubjectSlot,
} from './types.js';
import { getTemplateConfig } from './template-config.js';
import { ClaimPairCandidate, ClaimEvidenceCandidate } from './candidate-generation.js';
import { slotsMatch, valuesContradict } from './subject-slot.js';

// =============================================================================
// EDGE CLASSIFICATION RESULTS
// =============================================================================

export interface EdgeClassificationResult {
  contradictions: GraphEdge[];
  supports: GraphEdge[];
  groundings: GraphEdge[];
  diagnostics: {
    candidatesProcessed: number;
    edgesCreated: number;
    rejectedBySlotGating: number;
    rejectedByPolarityGating: number;
    rejectedByThreshold: number;
  };
}

// =============================================================================
// MAIN CLASSIFICATION FUNCTION
// =============================================================================

export function classifyEdges(
  contradictionCandidates: ClaimPairCandidate[],
  supportClaimCandidates: ClaimPairCandidate[],
  supportEvidenceCandidates: ClaimEvidenceCandidate[],
  groundingCandidates: ClaimEvidenceCandidate[]
): EdgeClassificationResult {
  const config = getTemplateConfig();
  
  const contradictions: GraphEdge[] = [];
  const supports: GraphEdge[] = [];
  const groundings: GraphEdge[] = [];
  
  let rejectedBySlotGating = 0;
  let rejectedByPolarityGating = 0;
  let rejectedByThreshold = 0;
  
  // Process contradiction candidates
  for (const candidate of contradictionCandidates) {
    const result = classifyContradiction(candidate, config);
    
    if (result.rejected) {
      if (result.reason === 'slot') rejectedBySlotGating++;
      if (result.reason === 'polarity') rejectedByPolarityGating++;
      if (result.reason === 'threshold') rejectedByThreshold++;
      continue;
    }
    
    if (result.edge) {
      contradictions.push(result.edge);
    }
  }
  
  // Process claim-to-claim support candidates
  for (const candidate of supportClaimCandidates) {
    const result = classifyClaimSupport(candidate, config);
    
    if (result.rejected) {
      if (result.reason === 'threshold') rejectedByThreshold++;
      continue;
    }
    
    if (result.edge) {
      supports.push(result.edge);
    }
  }
  
  // Process claim-to-evidence support candidates
  for (const candidate of supportEvidenceCandidates) {
    const result = classifyEvidenceSupport(candidate, config);
    
    if (result.rejected) {
      if (result.reason === 'threshold') rejectedByThreshold++;
      continue;
    }
    
    if (result.edge) {
      supports.push(result.edge);
    }
  }
  
  // Process grounding candidates
  for (const candidate of groundingCandidates) {
    const result = classifyGrounding(candidate, config);
    
    if (result.rejected) {
      if (result.reason === 'threshold') rejectedByThreshold++;
      continue;
    }
    
    if (result.edge) {
      groundings.push(result.edge);
    }
  }
  
  // Deduplicate edges
  const deduplicatedContradictions = deduplicateEdges(contradictions);
  const deduplicatedSupports = deduplicateEdges(supports);
  const deduplicatedGroundings = deduplicateEdges(groundings);
  
  return {
    contradictions: deduplicatedContradictions,
    supports: deduplicatedSupports,
    groundings: deduplicatedGroundings,
    diagnostics: {
      candidatesProcessed: 
        contradictionCandidates.length + 
        supportClaimCandidates.length + 
        supportEvidenceCandidates.length + 
        groundingCandidates.length,
      edgesCreated: 
        deduplicatedContradictions.length + 
        deduplicatedSupports.length + 
        deduplicatedGroundings.length,
      rejectedBySlotGating,
      rejectedByPolarityGating,
      rejectedByThreshold,
    },
  };
}

// =============================================================================
// CONTRADICTION CLASSIFICATION
// =============================================================================

interface ClassificationResult {
  edge?: GraphEdge;
  rejected: boolean;
  reason?: 'slot' | 'polarity' | 'threshold' | 'topic';
}

function classifyContradiction(
  candidate: ClaimPairCandidate,
  config: ReturnType<typeof getTemplateConfig>
): ClassificationResult {
  const { claimA, claimB, signals } = candidate;
  
  // GATE 1: Slot match (REQUIRED for contradiction)
  if (config.gating.contradictionRequiresSameSlot) {
    if (!slotsMatch(claimA.slot, claimB.slot)) {
      return { rejected: true, reason: 'slot' };
    }
  }
  
  // GATE 2: Topic match (if configured)
  if (config.gating.contradictionRequiresSameTopic) {
    if (claimA.topicId && claimB.topicId && claimA.topicId !== claimB.topicId) {
      return { rejected: true, reason: 'topic' };
    }
  }
  
  // GATE 3: Polarity check (must have opposing polarity)
  if (config.gating.contradictionRequiresOpposingPolarity) {
    if (!hasOpposingPolarity(claimA, claimB)) {
      return { rejected: true, reason: 'polarity' };
    }
  }
  
  // Compute contradiction score
  const contradictionScore = computeContradictionScore(claimA, claimB, signals);
  
  // GATE 4: Threshold check
  if (contradictionScore < config.thresholds.contradiction) {
    return { rejected: true, reason: 'threshold' };
  }
  
  // Create the edge
  const edge = createContradictionEdge(claimA, claimB, contradictionScore, signals);
  
  return { edge, rejected: false };
}

// =============================================================================
// POLARITY DETECTION
// =============================================================================

function hasOpposingPolarity(a: ClaimNode, b: ClaimNode): boolean {
  // Check modality opposition
  if (a.modality === 'assert' && b.modality === 'deny') return true;
  if (a.modality === 'deny' && b.modality === 'assert') return true;
  
  // Check for negation patterns in text
  const negationPatterns = [
    /\bnot\b/i,
    /\bno\b/i,
    /\bnever\b/i,
    /\bwon't\b/i,
    /\bdon't\b/i,
    /\bdoesn't\b/i,
    /\bdidn't\b/i,
    /\bwouldn't\b/i,
    /\bshouldn't\b/i,
    /\bcan't\b/i,
    /\bcannot\b/i,
    /\bisn't\b/i,
    /\baren't\b/i,
    /\bwasn't\b/i,
    /\bweren't\b/i,
  ];
  
  const aHasNegation = negationPatterns.some(p => p.test(a.text));
  const bHasNegation = negationPatterns.some(p => p.test(b.text));
  
  // One negated, one not = opposing
  if (aHasNegation !== bHasNegation) return true;
  
  // Check for value contradiction
  if (valuesContradict(a.slot, b.slot)) return true;
  
  // Check for opposing value words
  const opposingPairs = [
    ['increase', 'decrease'],
    ['higher', 'lower'],
    ['more', 'less'],
    ['added', 'removed'],
    ['approved', 'denied'],
    ['can', "can't"],
    ['will', "won't"],
    ['did', "didn't"],
    ['is', "isn't"],
    ['was', "wasn't"],
    ['have', "haven't"],
    ['has', "hasn't"],
  ];
  
  const aLower = a.text.toLowerCase();
  const bLower = b.text.toLowerCase();
  
  for (const [word1, word2] of opposingPairs) {
    if (
      (aLower.includes(word1) && bLower.includes(word2)) ||
      (aLower.includes(word2) && bLower.includes(word1))
    ) {
      return true;
    }
  }
  
  return false;
}

// =============================================================================
// CONTRADICTION SCORE COMPUTATION
// =============================================================================

function computeContradictionScore(
  a: ClaimNode,
  b: ClaimNode,
  signals: { slotMatch: number; entityOverlap: number; semanticSimilarity: number }
): number {
  const config = getTemplateConfig();
  const weights = config.weights.calibration;
  
  // Base score from slot match
  let score = signals.slotMatch * weights.entityMatch;
  
  // Boost for high semantic similarity (related content)
  score += signals.semanticSimilarity * 0.3;
  
  // Polarity confidence
  const polarityConfidence = hasOpposingPolarity(a, b) ? 1.0 : 0.3;
  score += polarityConfidence * weights.polarityMatch;
  
  // Value contradiction boost
  if (valuesContradict(a.slot, b.slot)) {
    score += 0.3; // Strong signal
  }
  
  // Normalize to 0-1
  return Math.min(1, Math.max(0, score));
}

// =============================================================================
// CREATE CONTRADICTION EDGE
// =============================================================================

function createContradictionEdge(
  a: ClaimNode,
  b: ClaimNode,
  weight: number,
  signals: { slotMatch: number; entityOverlap: number; semanticSimilarity: number }
): GraphEdge {
  return {
    id: `contradiction-${a.id}-${b.id}`,
    type: 'CONTRADICTION',
    from: a.id,
    to: b.id,
    weight,
    rationale: {
      method: 'hybrid',
      signals: {
        slotMatchScore: signals.slotMatch,
        entityMatchScore: signals.entityOverlap,
        semanticSimilarity: signals.semanticSimilarity,
        hasOpposingPolarity: hasOpposingPolarity(a, b),
        hasValueContradiction: valuesContradict(a.slot, b.slot),
      },
    },
    provenance: {
      spanPairs: [
        {
          fromSpan: { start: a.span.startChar, end: a.span.endChar, text: a.text },
          toSpan: { start: b.span.startChar, end: b.span.endChar, text: b.text },
        },
      ],
    },
    slot: {
      slotType: a.slot.slotType,
      entityKey: a.slot.entityKey,
    },
    topicId: a.topicId,
    createdAt: new Date().toISOString(),
  };
}

// =============================================================================
// SUPPORT CLASSIFICATION (CLAIM-TO-CLAIM)
// =============================================================================

function classifyClaimSupport(
  candidate: ClaimPairCandidate,
  config: ReturnType<typeof getTemplateConfig>
): ClassificationResult {
  const { claimA, claimB, signals } = candidate;
  
  // Skip if claim-to-claim support is not allowed
  if (!config.truthDerivation.allowClaimToClaimSupport) {
    return { rejected: true, reason: 'threshold' };
  }
  
  // Compute support score
  const supportScore = computeSupportScore(claimA, claimB, signals);
  
  if (supportScore < config.thresholds.support) {
    return { rejected: true, reason: 'threshold' };
  }
  
  const edge = createSupportEdge(claimA.id, claimB.id, supportScore, signals, 'claim');
  
  return { edge, rejected: false };
}

// =============================================================================
// SUPPORT CLASSIFICATION (CLAIM-TO-EVIDENCE)
// =============================================================================

function classifyEvidenceSupport(
  candidate: ClaimEvidenceCandidate,
  config: ReturnType<typeof getTemplateConfig>
): ClassificationResult {
  const { claim, evidence, signals } = candidate;
  
  // Compute support score with evidence strength multiplier
  const evidenceStrength = config.weights.evidenceStrength[evidence.evidenceKind] || 0.5;
  const supportScore = computeEvidenceSupportScore(claim, evidence, signals) * evidenceStrength;
  
  if (supportScore < config.thresholds.support) {
    return { rejected: true, reason: 'threshold' };
  }
  
  const edge = createSupportEdge(claim.id, evidence.id, supportScore, signals, 'evidence');
  
  return { edge, rejected: false };
}

// =============================================================================
// GROUNDING CLASSIFICATION
// =============================================================================

function classifyGrounding(
  candidate: ClaimEvidenceCandidate,
  config: ReturnType<typeof getTemplateConfig>
): ClassificationResult {
  const { claim, evidence, signals } = candidate;
  
  // Grounding only applies to transcript evidence
  if (evidence.evidenceKind !== 'transcript') {
    return { rejected: true, reason: 'threshold' };
  }
  
  // Compute grounding score (primarily text match)
  const groundingScore = signals.semanticSimilarity;
  
  if (groundingScore < config.thresholds.grounding) {
    return { rejected: true, reason: 'threshold' };
  }
  
  const edge = createGroundingEdge(claim, evidence, groundingScore, signals);
  
  return { edge, rejected: false };
}

// =============================================================================
// SUPPORT SCORE COMPUTATION
// =============================================================================

function computeSupportScore(
  a: ClaimNode,
  b: ClaimNode,
  signals: { slotMatch: number; entityOverlap: number; semanticSimilarity: number }
): number {
  // Support requires high semantic similarity and entity overlap
  return (signals.semanticSimilarity * 0.5) + (signals.entityOverlap * 0.3) + (signals.slotMatch * 0.2);
}

function computeEvidenceSupportScore(
  claim: ClaimNode,
  evidence: EvidenceNode,
  signals: { slotMatch: number; entityOverlap: number; semanticSimilarity: number }
): number {
  // Evidence support prioritizes content match
  return (signals.semanticSimilarity * 0.6) + (signals.entityOverlap * 0.4);
}

// =============================================================================
// CREATE EDGES
// =============================================================================

function createSupportEdge(
  fromId: string,
  toId: string,
  weight: number,
  signals: { slotMatch: number; entityOverlap: number; semanticSimilarity: number },
  sourceType: 'claim' | 'evidence'
): GraphEdge {
  return {
    id: `support-${fromId}-${toId}`,
    type: 'SUPPORT',
    from: fromId,
    to: toId,
    weight,
    rationale: {
      method: sourceType === 'evidence' ? 'retrieval+rerank' : 'hybrid',
      signals: {
        slotMatchScore: signals.slotMatch,
        entityMatchScore: signals.entityOverlap,
        semanticSimilarity: signals.semanticSimilarity,
        sourceType,
      },
    },
    provenance: {
      sourceIds: [toId],
    },
    slot: {
      slotType: 'unknown',
      entityKey: 'unknown',
    },
    createdAt: new Date().toISOString(),
  };
}

function createGroundingEdge(
  claim: ClaimNode,
  evidence: EvidenceNode,
  weight: number,
  signals: { slotMatch: number; entityOverlap: number; semanticSimilarity: number }
): GraphEdge {
  return {
    id: `grounding-${claim.id}-${evidence.id}`,
    type: 'GROUNDING',
    from: claim.id,
    to: evidence.id,
    weight,
    rationale: {
      method: 'semantic',
      signals: {
        semanticSimilarity: signals.semanticSimilarity,
      },
    },
    provenance: {
      anchors: evidence.anchors,
      sourceIds: [evidence.id],
    },
    slot: {
      slotType: claim.slot.slotType,
      entityKey: claim.slot.entityKey,
    },
    createdAt: new Date().toISOString(),
  };
}

// =============================================================================
// EDGE DEDUPLICATION
// =============================================================================

function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  
  for (const edge of edges) {
    // For undirected edges like contradiction, normalize the key
    let key: string;
    if (edge.type === 'CONTRADICTION') {
      const sorted = [edge.from, edge.to].sort();
      key = `${edge.type}-${sorted[0]}-${sorted[1]}`;
    } else {
      key = `${edge.type}-${edge.from}-${edge.to}`;
    }
    
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    } else {
      // Keep the higher-weight edge
      const existingIndex = result.findIndex(e => {
        if (edge.type === 'CONTRADICTION') {
          const sorted = [e.from, e.to].sort();
          return `${e.type}-${sorted[0]}-${sorted[1]}` === key;
        }
        return `${e.type}-${e.from}-${e.to}` === key;
      });
      
      if (existingIndex >= 0 && result[existingIndex].weight < edge.weight) {
        result[existingIndex] = edge;
      }
    }
  }
  
  return result;
}

