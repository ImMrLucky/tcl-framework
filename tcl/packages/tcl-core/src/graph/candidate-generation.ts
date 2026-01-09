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

import { ClaimNode, EvidenceNode, SubjectSlot, GraphNode, RunDiagnostics } from './types.js';
import { getTemplateConfig } from './template-config.js';
import { computeSlotSimilarity } from './subject-slot.js';

// =============================================================================
// CANDIDATE TYPES
// =============================================================================

export interface ClaimPairCandidate {
  claimA: ClaimNode;
  claimB: ClaimNode;
  retrievalScore: number;
  signals: CandidateSignals;
}

export interface ClaimEvidenceCandidate {
  claim: ClaimNode;
  evidence: EvidenceNode;
  retrievalScore: number;
  signals: CandidateSignals;
}

export interface CandidateSignals {
  slotMatch: number;
  entityOverlap: number;
  semanticSimilarity: number;
  temporalProximity: number;
  speakerRole: number;
}

export interface CandidateGenerationResult {
  contradictionCandidates: ClaimPairCandidate[];
  supportClaimCandidates: ClaimPairCandidate[];
  supportEvidenceCandidates: ClaimEvidenceCandidate[];
  groundingCandidates: ClaimEvidenceCandidate[];
  diagnostics: {
    totalClaimsProcessed: number;
    totalCandidatesGenerated: number;
    budgetExhausted: boolean;
    claimsWithZeroCandidates: number;
  };
}

// =============================================================================
// MAIN CANDIDATE GENERATION FUNCTION
// =============================================================================

export function generateCandidates(
  claims: ClaimNode[],
  evidenceNodes: EvidenceNode[]
): CandidateGenerationResult {
  const config = getTemplateConfig();
  const budgets = config.budgets;
  
  const contradictionCandidates: ClaimPairCandidate[] = [];
  const supportClaimCandidates: ClaimPairCandidate[] = [];
  const supportEvidenceCandidates: ClaimEvidenceCandidate[] = [];
  const groundingCandidates: ClaimEvidenceCandidate[] = [];
  
  let claimsWithZeroCandidates = 0;
  
  // Process each claim
  for (const claim of claims) {
    // Get candidates for this claim
    const claimContradictionCandidates = getCandidatesForContradiction(
      claim, 
      claims, 
      budgets.perClaim.contradictionPairs,
      config.weights.retrieval
    );
    
    const claimSupportCandidates = getCandidatesForSupport(
      claim, 
      claims, 
      budgets.perClaim.supportClaimPairs,
      config.weights.retrieval
    );
    
    const evidenceSupportCandidates = getCandidatesForEvidenceSupport(
      claim, 
      evidenceNodes.filter(e => e.evidenceKind !== 'transcript'),
      budgets.perClaim.supportEvidencePairs,
      config.weights.retrieval
    );
    
    const transcriptGroundingCandidates = getCandidatesForGrounding(
      claim,
      evidenceNodes.filter(e => e.evidenceKind === 'transcript'),
      budgets.perClaim.groundingPairs,
      config.weights.retrieval
    );
    
    // Track claims with no candidates
    if (
      claimContradictionCandidates.length === 0 &&
      claimSupportCandidates.length === 0 &&
      evidenceSupportCandidates.length === 0 &&
      transcriptGroundingCandidates.length === 0
    ) {
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
  const totalCandidates = 
    contradictionCandidates.length + 
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

function getCandidatesForContradiction(
  claim: ClaimNode,
  allClaims: ClaimNode[],
  budget: number,
  weights: { slotMatch: number; entityOverlap: number; semanticSimilarity: number; temporalProximity: number; speakerRole: number }
): ClaimPairCandidate[] {
  const candidates: ClaimPairCandidate[] = [];
  
  for (const other of allClaims) {
    // Skip self
    if (claim.id === other.id) continue;
    
    // Compute retrieval signals
    const signals = computeRetrievalSignals(claim, other);
    
    // Compute weighted score
    const retrievalScore = 
      weights.slotMatch * signals.slotMatch +
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

function getCandidatesForSupport(
  claim: ClaimNode,
  allClaims: ClaimNode[],
  budget: number,
  weights: { slotMatch: number; entityOverlap: number; semanticSimilarity: number; temporalProximity: number; speakerRole: number }
): ClaimPairCandidate[] {
  const candidates: ClaimPairCandidate[] = [];
  
  for (const other of allClaims) {
    if (claim.id === other.id) continue;
    
    const signals = computeRetrievalSignals(claim, other);
    
    // For support, we weight semantic similarity higher
    const retrievalScore = 
      weights.slotMatch * 0.3 * signals.slotMatch + // Lower slot weight for support
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

function getCandidatesForEvidenceSupport(
  claim: ClaimNode,
  evidenceNodes: EvidenceNode[],
  budget: number,
  weights: { slotMatch: number; entityOverlap: number; semanticSimilarity: number; temporalProximity: number; speakerRole: number }
): ClaimEvidenceCandidate[] {
  const candidates: ClaimEvidenceCandidate[] = [];
  
  for (const evidence of evidenceNodes) {
    const signals = computeClaimEvidenceSignals(claim, evidence);
    
    // Evidence support prioritizes content match
    const retrievalScore = 
      weights.entityOverlap * signals.entityOverlap +
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

function getCandidatesForGrounding(
  claim: ClaimNode,
  transcriptEvidence: EvidenceNode[],
  budget: number,
  weights: { slotMatch: number; entityOverlap: number; semanticSimilarity: number; temporalProximity: number; speakerRole: number }
): ClaimEvidenceCandidate[] {
  const candidates: ClaimEvidenceCandidate[] = [];
  
  for (const evidence of transcriptEvidence) {
    const signals = computeClaimEvidenceSignals(claim, evidence);
    
    // Grounding prioritizes exact text match
    const retrievalScore = 
      signals.semanticSimilarity * 0.7 + // Text similarity
      signals.temporalProximity * 0.3;    // Turn proximity
    
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

function computeRetrievalSignals(a: ClaimNode, b: ClaimNode): CandidateSignals {
  return {
    slotMatch: computeSlotSimilarity(a.slot, b.slot),
    entityOverlap: computeEntityOverlap(a.entities, b.entities),
    semanticSimilarity: computeTextSimilarity(a.text, b.text),
    temporalProximity: computeTemporalProximity(a, b),
    speakerRole: computeSpeakerRoleScore(a.speakerRole, b.speakerRole),
  };
}

function computeClaimEvidenceSignals(claim: ClaimNode, evidence: EvidenceNode): CandidateSignals {
  const evidenceText = evidence.content || evidence.title || '';
  
  // For transcript evidence, compute temporal proximity using turn matching
  let temporalProximity = 0;
  let spanOverlap = 0;
  
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
        
        // Compute span overlap when same turn (best case for grounding)
        if (claim.span && evidenceAnchor.text) {
          // Check if claim text appears in evidence text (exact or substring match)
          const claimTextLower = claim.text.toLowerCase().trim();
          const evidenceTextLower = evidenceAnchor.text.toLowerCase().trim();
          
          if (evidenceTextLower.includes(claimTextLower) || claimTextLower.includes(evidenceTextLower)) {
            // Exact or substring match = perfect span overlap
            spanOverlap = 1.0;
          } else {
            // Compute character overlap
            const claimChars = new Set(claimTextLower.replace(/\s+/g, ''));
            const evidenceChars = new Set(evidenceTextLower.replace(/\s+/g, ''));
            let intersection = 0;
            for (const char of claimChars) {
              if (evidenceChars.has(char)) intersection++;
            }
            const union = claimChars.size + evidenceChars.size - intersection;
            spanOverlap = union > 0 ? intersection / union : 0;
          }
        }
      } else if (turnDistance === 1) {
        temporalProximity = 0.8; // Adjacent turn - likely response
      } else if (turnDistance <= 3) {
        temporalProximity = 0.5;
      } else {
        temporalProximity = 0.2;
      }
    }
  }
  
  // Use span overlap if available, otherwise fall back to semantic similarity
  let textSimilarity = computeTextSimilarity(claim.text, evidenceText);
  if (spanOverlap > 0) {
    // Prefer span overlap when available (more reliable for grounding)
    textSimilarity = Math.max(textSimilarity, spanOverlap);
  }
  
  return {
    slotMatch: 0, // N/A for evidence
    entityOverlap: computeEntityOverlapWithEvidence(claim.entities, evidence),
    semanticSimilarity: textSimilarity,
    temporalProximity,
    speakerRole: 0, // N/A
  };
}

// =============================================================================
// OVERLAP AND SIMILARITY FUNCTIONS
// =============================================================================

function computeEntityOverlap(entitiesA: ExtractedEntity[], entitiesB: ExtractedEntity[]): number {
  if (entitiesA.length === 0 || entitiesB.length === 0) return 0;
  
  const keysA = new Set(entitiesA.map(e => `${e.type}:${e.normalized || e.value}`));
  const keysB = new Set(entitiesB.map(e => `${e.type}:${e.normalized || e.value}`));
  
  let intersection = 0;
  for (const key of keysA) {
    if (keysB.has(key)) intersection++;
  }
  
  // Jaccard similarity
  const union = keysA.size + keysB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function computeEntityOverlapWithEvidence(entities: ExtractedEntity[], evidence: EvidenceNode): number {
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

/**
 * Text Similarity Interface
 * Allows swapping implementations (current: 3-gram cosine, future: embeddings)
 */
interface TextSimilarityProvider {
  computeSimilarity(textA: string, textB: string): number;
}

/**
 * 3-gram Cosine Similarity Provider
 * Better baseline than token Jaccard - handles paraphrases better
 */
class TrigramCosineProvider implements TextSimilarityProvider {
  computeSimilarity(textA: string, textB: string): number {
    // Normalize text (lowercase, remove punctuation, normalize whitespace)
    const normalizedA = normalizeText(textA);
    const normalizedB = normalizeText(textB);
    
    if (normalizedA.length === 0 || normalizedB.length === 0) return 0;
    
    // Generate character 3-grams
    const gramsA = generateTrigrams(normalizedA);
    const gramsB = generateTrigrams(normalizedB);
    
    if (gramsA.size === 0 || gramsB.size === 0) {
      // Fallback to Jaccard if no trigrams
      return computeJaccardFallback(textA, textB);
    }
    
    // Compute cosine similarity using 3-gram frequencies
    return computeCosineSimilarity(gramsA, gramsB);
  }
}

/**
 * Normalize text for similarity computation
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}

/**
 * Generate character 3-grams from text
 */
function generateTrigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const padded = `  ${text}  `; // Pad with spaces for edge grams
  
  for (let i = 0; i < padded.length - 2; i++) {
    const gram = padded.substring(i, i + 3);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  
  return grams;
}

/**
 * Compute cosine similarity between two 3-gram frequency maps
 */
function computeCosineSimilarity(
  gramsA: Map<string, number>,
  gramsB: Map<string, number>
): number {
  // Build union of all grams
  const allGrams = new Set([...gramsA.keys(), ...gramsB.keys()]);
  
  if (allGrams.size === 0) return 0;
  
  // Compute dot product and magnitudes
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (const gram of allGrams) {
    const freqA = gramsA.get(gram) || 0;
    const freqB = gramsB.get(gram) || 0;
    
    dotProduct += freqA * freqB;
    magnitudeA += freqA * freqA;
    magnitudeB += freqB * freqB;
  }
  
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return magnitude > 0 ? dotProduct / magnitude : 0;
}

/**
 * Fallback to Jaccard similarity if trigrams fail
 */
function computeJaccardFallback(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// Global similarity provider (can be swapped for embeddings later)
// To use embeddings: set similarityProvider = new EmbeddingProvider(embeddingModel)
let similarityProvider: TextSimilarityProvider = new TrigramCosineProvider();

/**
 * Set the text similarity provider (for future embedding support)
 */
export function setTextSimilarityProvider(provider: TextSimilarityProvider): void {
  similarityProvider = provider;
}

/**
 * Compute text similarity using the configured provider
 * Supports value-aware matching for MONEY, DATE, PERCENT entities
 */
function computeTextSimilarity(textA: string, textB: string): number {
  // First, try value-aware matching for numeric entities
  const valueMatch = computeValueAwareSimilarity(textA, textB);
  if (valueMatch > 0) {
    // If value match found, boost the base similarity
    const baseSimilarity = similarityProvider.computeSimilarity(textA, textB);
    return Math.max(baseSimilarity, valueMatch * 0.8 + baseSimilarity * 0.2);
  }
  
  // Use base similarity provider (3-gram cosine)
  return similarityProvider.computeSimilarity(textA, textB);
}

/**
 * Value-aware matching for MONEY, DATE, PERCENT
 * Detects and matches numeric values even if phrasing differs
 */
function computeValueAwareSimilarity(textA: string, textB: string): number {
  // Extract money values
  const moneyA = extractMoneyValues(textA);
  const moneyB = extractMoneyValues(textB);
  if (moneyA.length > 0 && moneyB.length > 0) {
    for (const valA of moneyA) {
      for (const valB of moneyB) {
        // Match if values are within 1% (handles rounding)
        if (Math.abs(valA - valB) / Math.max(valA, valB) < 0.01) {
          return 0.9; // High match for same money value
        }
      }
    }
  }
  
  // Extract percentages
  const percentA = extractPercentValues(textA);
  const percentB = extractPercentValues(textB);
  if (percentA.length > 0 && percentB.length > 0) {
    for (const valA of percentA) {
      for (const valB of percentB) {
        if (Math.abs(valA - valB) < 0.1) { // Within 0.1%
          return 0.9;
        }
      }
    }
  }
  
  // Extract dates (normalize to ISO format for comparison)
  const dateA = extractDates(textA);
  const dateB = extractDates(textB);
  if (dateA.length > 0 && dateB.length > 0) {
    for (const dA of dateA) {
      for (const dB of dateB) {
        if (dA === dB) {
          return 0.9; // Exact date match
        }
      }
    }
  }
  
  return 0;
}

/**
 * Extract money values from text (returns cents)
 */
function extractMoneyValues(text: string): number[] {
  const values: number[] = [];
  const moneyPattern = /\$[\d,]+(?:\.\d{2})?|\d+(?:\.\d{2})?\s*(?:dollars?|cents?|USD)/gi;
  let match;
  
  while ((match = moneyPattern.exec(text)) !== null) {
    const cleaned = match[0].replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      // Convert to cents if it looks like dollars
      if (match[0].toLowerCase().includes('cent')) {
        values.push(Math.round(num));
      } else {
        values.push(Math.round(num * 100));
      }
    }
  }
  
  return values;
}

/**
 * Extract percentage values from text
 */
function extractPercentValues(text: string): number[] {
  const values: number[] = [];
  const percentPattern = /\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*percent/gi;
  let match;
  
  while ((match = percentPattern.exec(text)) !== null) {
    const cleaned = match[0].replace(/%|percent/gi, '').trim();
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      values.push(num);
    }
  }
  
  return values;
}

/**
 * Extract and normalize dates from text
 */
function extractDates(text: string): string[] {
  const dates: string[] = [];
  const datePattern = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}/gi;
  let match;
  
  while ((match = datePattern.exec(text)) !== null) {
    try {
      const date = new Date(match[0]);
      if (!isNaN(date.getTime())) {
        dates.push(date.toISOString().split('T')[0]); // ISO format
      }
    } catch {
      // Skip invalid dates
    }
  }
  
  return dates;
}

function tokenize(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'i', 'you', 'that', 'this',
  ]);
  
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  );
}

function computeTemporalProximity(a: ClaimNode, b: ClaimNode): number {
  // Use turn IDs to compute proximity
  const turnA = parseInt(a.span.turnId.replace(/[^\d]/g, ''), 10) || 0;
  const turnB = parseInt(b.span.turnId.replace(/[^\d]/g, ''), 10) || 0;
  
  const distance = Math.abs(turnA - turnB);
  
  // Decay function: closer turns have higher score
  // Within 5 turns: high score
  // Beyond 20 turns: low score
  if (distance <= 5) return 1.0;
  if (distance <= 10) return 0.7;
  if (distance <= 20) return 0.4;
  return 0.1;
}

function computeSpeakerRoleScore(roleA: string, roleB: string): number {
  // Same speaker can contradict themselves (revisions)
  if (roleA === roleB) return 0.6;
  
  // Agent vs Customer: high relevance for contradiction
  if (
    (roleA === 'agent' && roleB === 'customer') ||
    (roleA === 'customer' && roleB === 'agent')
  ) {
    return 1.0;
  }
  
  return 0.3;
}

// =============================================================================
// TYPE IMPORTS
// =============================================================================

import { ExtractedEntity } from './types.js';
