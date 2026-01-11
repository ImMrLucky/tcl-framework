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
import { slotsMatch, valuesContradict, hasExplicitContradictionPattern } from './subject-slot.js';

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
    // Rejection counters by reason
    rejectedBySlotGating: number;
    rejectedByTopicGating: number;
    rejectedByPolarityGating: number;
    rejectedByThreshold: number;
    // Debug: first N rejected pairs for inspection
    sampleRejections: Array<{
      claimA: string;
      claimB: string;
      reason: string;
      slotA: string;
      slotB: string;
      textA: string;
      textB: string;
    }>;
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
  let rejectedByTopicGating = 0;
  let rejectedByPolarityGating = 0;
  let rejectedByThreshold = 0;
  
  // Track sample rejections for debugging (first 20)
  const sampleRejections: EdgeClassificationResult['diagnostics']['sampleRejections'] = [];
  const MAX_SAMPLE_REJECTIONS = 20;
  
  // Process contradiction candidates
  console.log(`🔍 Processing ${contradictionCandidates.length} contradiction candidates...`);
  
  for (const candidate of contradictionCandidates) {
    const result = classifyContradiction(candidate, config);
    
    if (result.rejected) {
      if (result.reason === 'slot') rejectedBySlotGating++;
      if (result.reason === 'topic') rejectedByTopicGating++;
      if (result.reason === 'polarity') rejectedByPolarityGating++;
      if (result.reason === 'threshold') rejectedByThreshold++;
      
      // Sample first N rejections for debugging
      if (sampleRejections.length < MAX_SAMPLE_REJECTIONS) {
        sampleRejections.push({
          claimA: candidate.claimA.id,
          claimB: candidate.claimB.id,
          reason: result.reason || 'unknown',
          slotA: `${candidate.claimA.slot.slotType}:${candidate.claimA.slot.entityKey}`,
          slotB: `${candidate.claimB.slot.slotType}:${candidate.claimB.slot.entityKey}`,
          textA: candidate.claimA.text.substring(0, 60) + (candidate.claimA.text.length > 60 ? '...' : ''),
          textB: candidate.claimB.text.substring(0, 60) + (candidate.claimB.text.length > 60 ? '...' : ''),
        });
      }
      continue;
    }
    
    if (result.edge) {
      console.log(`✅ Contradiction edge: ${candidate.claimA.id} <-> ${candidate.claimB.id} (weight: ${result.edge.weight.toFixed(2)})`);
      contradictions.push(result.edge);
    }
  }
  
  // Log rejection summary
  console.log(`📊 Contradiction gating: slot=${rejectedBySlotGating}, topic=${rejectedByTopicGating}, polarity=${rejectedByPolarityGating}, threshold=${rejectedByThreshold}, created=${contradictions.length}`);
  if (sampleRejections.length > 0) {
    console.log(`🔍 Sample rejections (first ${sampleRejections.length}):`);
    sampleRejections.slice(0, 5).forEach(r => {
      console.log(`   ${r.claimA} <-> ${r.claimB}: ${r.reason}`);
      console.log(`     A: ${r.textA}`);
      console.log(`     B: ${r.textB}`);
    });
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
      rejectedByTopicGating,
      rejectedByPolarityGating,
      rejectedByThreshold,
      sampleRejections,
    },
  };
}

// =============================================================================
// CONTRADICTION CLASSIFICATION
// =============================================================================

interface ClassificationResult {
  edge?: GraphEdge;
  rejected: boolean;
  reason?: 'slot' | 'polarity' | 'threshold' | 'topic' | 'mutual_exclusivity';
}

function classifyContradiction(
  candidate: ClaimPairCandidate,
  config: ReturnType<typeof getTemplateConfig>
): ClassificationResult {
  const { claimA, claimB, signals } = candidate;
  
  // GATE 1: Slot compatibility (STRICT for contradiction-eligible slots)
  // Enforce strict slot matching for specific slot types that can contradict
  const exactSlotMatch = slotsMatch(claimA.slot, claimB.slot);
  const sameSlotType = claimA.slot.slotType === claimB.slot.slotType;
  const sameEntityKey = claimA.slot.entityKey && claimB.slot.entityKey && 
                        claimA.slot.entityKey === claimB.slot.entityKey;
  
  // Contradiction-eligible slot types (must match exactly)
  const contradictionEligibleSlots = [
    'fee', 'amount', 'price', 'refund_amount',
    'late_fee_status', 'cancellation_fee',
    'plan_price', 'recording', 'email_confirmation',
    'duration', 'term', 'date'
  ];
  
  const isEligibleSlotType = contradictionEligibleSlots.includes(claimA.slot.slotType) ||
                             contradictionEligibleSlots.includes(claimB.slot.slotType);
  
  if (config.gating.contradictionRequiresSameSlot) {
    // For eligible slot types, require exact match (slotType + entityKey)
    if (isEligibleSlotType) {
      if (!exactSlotMatch && !(sameSlotType && sameEntityKey)) {
        return { rejected: true, reason: 'slot' };
      }
    } else {
      // For other slot types, allow relaxed matching
      const hasSharedSubject = hasSharedSubjectReference(claimA, claimB);
      if (!exactSlotMatch && !sameSlotType && !hasSharedSubject) {
        return { rejected: true, reason: 'slot' };
      }
    }
  }
  
  // Disallow contradictions between unrelated facts
  // e.g., "address updates" vs "identity verification" vs "generic customer statements"
  const unrelatedSlotTypes = ['address', 'identity', 'generic'];
  if (unrelatedSlotTypes.includes(claimA.slot.slotType) || 
      unrelatedSlotTypes.includes(claimB.slot.slotType)) {
    // Only allow if both are the same unrelated type (e.g., address vs address)
    if (claimA.slot.slotType !== claimB.slot.slotType) {
      return { rejected: true, reason: 'slot' };
    }
  }
  
  // B1: Topic + slot hard-gate for contradiction edges
  // Do not generate contradiction edges unless topicId AND slotKey match
  // This prevents "topic drift contradictions" (e.g., device protection vs cancellation)
  if (config.gating.contradictionRequiresSameTopic) {
    // Hard gate: topicId must match
    if (claimA.topicId && claimB.topicId && claimA.topicId !== claimB.topicId) {
      return { rejected: true, reason: 'topic' };
    }
    
    // Hard gate: slotKey must match (slotType + entityKey)
    const slotKeyA = claimA.slot.slotType + (claimA.slot.entityKey || '');
    const slotKeyB = claimB.slot.slotType + (claimB.slot.entityKey || '');
    if (slotKeyA !== slotKeyB) {
      return { rejected: true, reason: 'slot' };
    }
  }
  
  // GATE 3: Polarity check (must have opposing polarity)
  if (config.gating.contradictionRequiresOpposingPolarity) {
    if (!hasOpposingPolarity(claimA, claimB)) {
      return { rejected: true, reason: 'polarity' };
    }
  }
  
  // GATE 3.5: Mutual exclusivity check (for numeric/boolean slots)
  // Even with NLI, require structured check for numeric/boolean slots
  if (!hasMutualExclusivity(claimA, claimB)) {
    return { rejected: true, reason: 'mutual_exclusivity' as const };
  }
  
  // Compute contradiction score (boost for exact slot match)
  let contradictionScore = computeContradictionScore(claimA, claimB, signals);
  if (exactSlotMatch) {
    contradictionScore = Math.min(1.0, contradictionScore + 0.1); // Bonus for exact slot
  }
  
  // Store the classification score (before threshold check) for audit transparency
  const classificationScore = contradictionScore;
  
  // GATE 4: Threshold check
  if (contradictionScore < config.thresholds.contradiction) {
    return { rejected: true, reason: 'threshold' };
  }
  
  // Create the edge (with classificationScore preserved for audit)
  const edge = createContradictionEdge(claimA, claimB, contradictionScore, signals, classificationScore);
  
  return { edge, rejected: false };
}

// Helper: Parse turn index from turnId string
function parseTurnIndex(turnId: string): number {
  const match = turnId.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

// Helper: Check if claims share a subject reference (for pronouns like "that")
function hasSharedSubjectReference(a: ClaimNode, b: ClaimNode): boolean {
  const aText = a.text.toLowerCase();
  const bText = b.text.toLowerCase();
  
  // Check for pronouns in one that could reference the other
  const pronounPatterns = [
    /\bthat\b/,
    /\bit\b/,
    /\bthis\b/,
    /\bthose\b/,
    /\bthese\b/,
  ];
  
  // If one has a pronoun and the other has a specific entity...
  const aHasPronoun = pronounPatterns.some(p => p.test(aText));
  const bHasPronoun = pronounPatterns.some(p => p.test(bText));
  
  if (aHasPronoun !== bHasPronoun) {
    // One has pronoun, one doesn't - check if they're close in conversation
    // Rule 4: Use timestamps if available (90 seconds), else fallback to turns (2 turns)
    const aTime = a.meta?.startTimeMs ?? a.meta?.timestampMs;
    const bTime = b.meta?.startTimeMs ?? b.meta?.timestampMs;
    
    if (aTime !== undefined && bTime !== undefined) {
      // Use time-based distance (90 seconds window)
      const timeDistanceSec = Math.abs(aTime - bTime) / 1000;
      if (timeDistanceSec <= 90) {
        return true; // Within 90 seconds, likely a reference
      }
    } else {
      // Fallback: Use turn IDs (2 turns window)
      const turnA = parseTurnIndex(a.span.turnId);
      const turnB = parseTurnIndex(b.span.turnId);
      const turnDistance = Math.abs(turnA - turnB);
      
      if (turnDistance <= 2) {
        return true; // Within 2 turns, likely a reference
      }
    }
  }
  
  // Check for shared keywords (entities) between the claims
  const aWords = new Set(aText.split(/\s+/).filter(w => w.length > 3));
  const bWords = new Set(bText.split(/\s+/).filter(w => w.length > 3));
  
  let sharedCount = 0;
  for (const word of aWords) {
    if (bWords.has(word)) {
      sharedCount++;
    }
  }
  
  // If they share 2+ significant words, consider them related
  return sharedCount >= 2;
}

// =============================================================================
// MUTUAL EXCLUSIVITY CHECK
// =============================================================================

/**
 * Check if two claims have mutually exclusive values (required for contradiction)
 * For numeric slots: amounts must differ beyond tolerance OR durations differ
 * For boolean slots: yes/no mismatch
 * For other slots: use valuesContradict check
 */
function hasMutualExclusivity(a: ClaimNode, b: ClaimNode): boolean {
  // If slots don't match, they can't be mutually exclusive
  if (!slotsMatch(a.slot, b.slot) && a.slot.slotType !== b.slot.slotType) {
    return false;
  }
  
  // Use existing valuesContradict check (handles numeric/boolean/string)
  if (valuesContradict(a.slot, b.slot)) {
    return true;
  }
  
  // Additional check: numeric slots with different values
  if (a.slot.valueNorm !== undefined && b.slot.valueNorm !== undefined) {
    if (typeof a.slot.valueNorm === 'number' && typeof b.slot.valueNorm === 'number') {
      // For numeric slots, values must differ significantly
      // Tolerance: 5% for amounts, 1 unit for counts/durations
      const diff = Math.abs(a.slot.valueNorm - b.slot.valueNorm);
      const avg = (Math.abs(a.slot.valueNorm) + Math.abs(b.slot.valueNorm)) / 2;
      
      if (a.slot.slotType === 'fee' || a.slot.slotType === 'amount' || a.slot.slotType === 'price') {
        // For amounts, require >5% difference
        return diff > (avg * 0.05);
      } else {
        // For counts/durations, require >1 unit difference
        return diff > 1;
      }
    }
  }
  
  // If we can't determine mutual exclusivity, allow it (NLI will catch false positives)
  // But require at least opposing polarity
  return hasOpposingPolarity(a, b);
}

// =============================================================================
// POLARITY DETECTION
// =============================================================================

function hasOpposingPolarity(a: ClaimNode, b: ClaimNode): boolean {
  // Check modality opposition
  if (a.modality === 'assert' && b.modality === 'deny') return true;
  if (a.modality === 'deny' && b.modality === 'assert') return true;
  
  const aText = a.text.toLowerCase();
  const bText = b.text.toLowerCase();
  
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
    /\bhaven't\b/i,
    /\bhasn't\b/i,
  ];
  
  const aHasNegation = negationPatterns.some(p => p.test(aText));
  const bHasNegation = negationPatterns.some(p => p.test(bText));
  
  // One negated, one not = potential opposing
  // But we need to check if they're about the same ACTION
  if (aHasNegation !== bHasNegation) {
    // Check if they share an action verb
    const actionVerbs = [
      'add', 'added', 'adding',
      'remove', 'removed', 'removing',
      'change', 'changed', 'changing',
      'authorize', 'authorized', 'authorizing',
      'order', 'ordered', 'ordering',
      'request', 'requested', 'requesting',
      'pay', 'paid', 'paying',
      'charge', 'charged', 'charging',
      'waive', 'waived', 'waiving',
      'cancel', 'cancelled', 'cancelling',
      'sign', 'signed', 'signing',
      'agree', 'agreed', 'agreeing',
    ];
    
    const aVerbs = actionVerbs.filter(v => aText.includes(v));
    const bVerbs = actionVerbs.filter(v => bText.includes(v));
    
    // If they share a verb root, it's likely a contradiction
    for (const aVerb of aVerbs) {
      for (const bVerb of bVerbs) {
        // Check if same verb root (e.g., "add" matches "added")
        const aRoot = aVerb.replace(/(ed|ing|s)$/, '');
        const bRoot = bVerb.replace(/(ed|ing|s)$/, '');
        if (aRoot === bRoot || aRoot.includes(bRoot) || bRoot.includes(aRoot)) {
          return true;
        }
      }
    }
    
    // Even without shared verbs, negation asymmetry is significant
    return true;
  }
  
  // Check for value contradiction (now includes tolerance and explicit patterns)
  if (valuesContradict(a.slot, b.slot)) return true;
  
  // Check for opposing value words (enhanced list)
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
    ['true', 'false'],
    ['yes', 'no'],
    ['correct', 'incorrect'],
    ['right', 'wrong'],
    ['always', 'never'],
    ['every', 'no'],
    ['before', 'after'], // Date contradictions
    ['up', 'down'],
    ['started', 'ended'],
    ['waived', 'charged'], // Fee contradictions
    ['waived', 'fee'],
    ['no fee', 'fee'],
    ['free', 'charge'],
    ['zero', 'non-zero'],
    ['$0', '$'], // Money contradictions
  ];
  
  for (const [word1, word2] of opposingPairs) {
    if (
      (aText.includes(word1) && bText.includes(word2)) ||
      (aText.includes(word2) && bText.includes(word1))
    ) {
      return true;
    }
  }
  
  // Check for customer denial patterns
  // "I never added that" vs "was added" is a classic contradiction
  const denialPatterns = [
    /i (never|didn't|don't|haven't)/i,
    /i did not/i,
    /that's not true/i,
    /that's wrong/i,
    /that's incorrect/i,
  ];
  
  const assertionPatterns = [
    /was (added|changed|authorized|ordered|signed|agreed)/i,
    /you (added|changed|authorized|ordered|signed|agreed)/i,
    /it shows/i,
    /the record shows/i,
    /our records show/i,
    /i see (that )?.*was/i,
  ];
  
  const aIsDenial = denialPatterns.some(p => p.test(aText));
  const bIsAssertion = assertionPatterns.some(p => p.test(bText));
  const bIsDenial = denialPatterns.some(p => p.test(bText));
  const aIsAssertion = assertionPatterns.some(p => p.test(aText));
  
  if ((aIsDenial && bIsAssertion) || (bIsDenial && aIsAssertion)) {
    return true;
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
  
  // Value contradiction boost (now includes tolerance and explicit patterns)
  if (valuesContradict(a.slot, b.slot)) {
    // Strong boost for value contradictions - these are high-confidence signals
    score += 0.4; // Increased from 0.3 for better detection
    
    // Extra boost for explicit patterns (increase/decrease, waived/fee)
    if (hasExplicitContradictionPattern(a.slot, b.slot)) {
      score += 0.2; // Additional boost for clear semantic contradictions
    }
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
  signals: { slotMatch: number; entityOverlap: number; semanticSimilarity: number },
  classificationScore: number
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
        // CRITICAL: Preserve classification score for audit transparency
        // This is the score used for thresholding, before calibration
        classificationScore: classificationScore,
        passedThreshold: true, // This edge passed the threshold check
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
  
  // GATE 1: Require slot/entity match OR shared entity key
  // Support edges should represent real reinforcement, not just "similar sentences"
  const hasSlotMatch = signals.slotMatch > 0.3; // Same slot type
  const hasEntityOverlap = signals.entityOverlap > 0.2; // Shared entities
  const hasSharedEntityKey = claimA.slot.entityKey === claimB.slot.entityKey && 
                             claimA.slot.entityKey !== 'unknown';
  
  if (!hasSlotMatch && !hasEntityOverlap && !hasSharedEntityKey) {
    return { rejected: true, reason: 'threshold' }; // No meaningful connection
  }
  
  // GATE 2: Modality compatibility - questions shouldn't support assertions
  if (!areModalitiesCompatible(claimA.modality, claimB.modality)) {
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
  
  // GATE 1: Require entity overlap OR definition/policy evidence
  // Support edges should represent real reinforcement from evidence
  const hasEntityOverlap = signals.entityOverlap > 0.2;
  const isDefinitionOrPolicy = evidence.evidenceKind === 'policy' || 
                                evidence.evidenceKind === 'kb' ||
                                evidence.evidenceKind === 'document';
  
  if (!hasEntityOverlap && !isDefinitionOrPolicy) {
    return { rejected: true, reason: 'threshold' }; // No meaningful connection
  }
  
  // GATE 2: Modality compatibility - questions shouldn't be supported by evidence
  // (Evidence supports assertions, not questions)
  if (claim.modality === 'question') {
    return { rejected: true, reason: 'threshold' };
  }
  
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
  
  // Compute grounding score using text match AND temporal proximity
  // Temporal proximity is key: claims should ground to their source turn
  // For high recall, boost score when temporal proximity is high (same/adjacent turn)
  let groundingScore = (signals.semanticSimilarity * 0.5) + (signals.temporalProximity * 0.5);
  
  // Boost for same turn (perfect temporal match) - should almost always ground
  if (signals.temporalProximity >= 1.0) {
    // Same turn: very permissive - ground unless text is completely unrelated
    // Minimum score of 0.5 for same turn (will pass 0.25 threshold)
    groundingScore = Math.max(groundingScore, 0.5);
    // If there's any text similarity, boost further
    if (signals.semanticSimilarity > 0.1) {
      groundingScore = Math.max(groundingScore, 0.6 + (signals.semanticSimilarity * 0.3));
    }
  } else if (signals.temporalProximity >= 0.8) {
    // Adjacent turn: moderate boost
    groundingScore = Math.max(groundingScore, 0.4 + (signals.semanticSimilarity * 0.3));
  } else if (signals.temporalProximity >= 0.5) {
    // Within 3 turns: light boost
    groundingScore = Math.max(groundingScore, 0.3 + (signals.semanticSimilarity * 0.4));
  }
  
  // Use grounding threshold from config (no hard-coded clamp)
  // Lower threshold for high recall - want >80% of claims grounded
  const effectiveThreshold = config.thresholds.grounding;
  
  if (groundingScore < effectiveThreshold) {
    return { rejected: true, reason: 'threshold' };
  }
  
  const edge = createGroundingEdge(claim, evidence, groundingScore, signals);
  
  return { edge, rejected: false };
}

// =============================================================================
// MODALITY COMPATIBILITY
// =============================================================================

/**
 * Check if claim modalities are compatible for support relationships
 * Questions shouldn't support assertions, etc.
 */
function areModalitiesCompatible(
  modalityA: string | undefined,
  modalityB: string | undefined
): boolean {
  // If either is undefined, allow (conservative)
  if (!modalityA || !modalityB) return true;
  
  // Questions shouldn't support anything (they're asking, not asserting)
  if (modalityA === 'question' || modalityB === 'question') {
    return false;
  }
  
  // Hedges can support assertions (weak support)
  // Denials can support other denials (consistent denial)
  // Promises can support assertions (commitment supports claim)
  // Asserts can support anything (except questions)
  
  return true;
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

