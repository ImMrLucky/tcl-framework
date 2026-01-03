/**
 * Semantic Similarity - Compute semantic similarity between statements
 * 
 * UNIVERSAL: Works across all domains. Synonym mappings come from config.
 * 
 * Improvements over keyword-based Jaccard:
 * 1. Synonym awareness (configurable per domain)
 * 2. Entity alignment (compare apples to apples)
 * 3. Polarity detection (affirm vs deny)
 */

import { extractEntities, sharesPrimaryEntity, type Entity } from './entity-extractor.js';
import { getNLPConfig } from './config.js';

/**
 * Build synonym lookup from config
 */
function buildSynonymLookup(): Map<string, string> {
  const config = getNLPConfig();
  const lookup = new Map<string, string>();
  
  for (const group of config.synonyms) {
    for (const term of group.terms) {
      lookup.set(term.toLowerCase(), group.canonical);
    }
  }
  
  return lookup;
}

/**
 * Normalize a word to its canonical form using synonym groups from config
 */
export function normalizeWord(word: string): string {
  const lookup = buildSynonymLookup();
  const lower = word.toLowerCase();
  return lookup.get(lower) || lower;
}

/**
 * Tokenize text into normalized words (not just raw tokens)
 */
export function tokenizeAndNormalize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  
  return words.map(normalizeWord);
}

/**
 * Compute semantic similarity between two texts
 * Returns 0-1 where 1 = semantically identical
 */
export function computeSemanticSimilarity(textA: string, textB: string): {
  score: number;
  entityMatch: boolean;
  canonicalOverlap: number;
  explanation: string;
} {
  // 1. Check entity alignment first
  const entityResult = sharesPrimaryEntity(textA, textB);
  const entityBonus = entityResult.shares ? 0.2 : 0;
  
  // 2. Tokenize and normalize
  const tokensA = new Set(tokenizeAndNormalize(textA));
  const tokensB = new Set(tokenizeAndNormalize(textB));
  
  // 3. Compute Jaccard on normalized tokens (synonym-aware)
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  
  const union = new Set([...tokensA, ...tokensB]).size;
  const canonicalOverlap = union > 0 ? intersection / union : 0;
  
  // 4. Combine scores
  const baseScore = Math.min(1, canonicalOverlap + entityBonus);
  
  // 5. Generate explanation
  const sharedTokens = [...tokensA].filter(t => tokensB.has(t));
  const explanation = entityResult.shares 
    ? `Entity match (${entityResult.entity}), ${sharedTokens.length} shared terms`
    : `${sharedTokens.length} shared normalized terms: ${sharedTokens.slice(0, 5).join(', ')}`;
  
  return {
    score: baseScore,
    entityMatch: entityResult.shares,
    canonicalOverlap,
    explanation
  };
}

/**
 * Check if two claims are about the same subject (for contradiction eligibility)
 */
export function areSameSubject(textA: string, textB: string): {
  sameSubject: boolean;
  confidence: number;
  subject?: string;
  reason: string;
} {
  // 1. Check for shared primary entity (strongest signal)
  const entityResult = sharesPrimaryEntity(textA, textB);
  if (entityResult.shares && entityResult.entity) {
    return {
      sameSubject: true,
      confidence: 0.9,
      subject: entityResult.entity,
      reason: `Shared entity: ${entityResult.entity}`
    };
  }
  
  // 2. Check for high semantic similarity
  const similarity = computeSemanticSimilarity(textA, textB);
  if (similarity.score >= 0.4) {
    return {
      sameSubject: true,
      confidence: similarity.score,
      reason: similarity.explanation
    };
  }
  
  // 3. Check for entity-based subject patterns
  const subjectA = extractSubjectFromEntities(textA);
  const subjectB = extractSubjectFromEntities(textB);
  
  if (subjectA && subjectB && subjectA === subjectB) {
    return {
      sameSubject: true,
      confidence: 0.7,
      subject: subjectA,
      reason: `Same domain subject: ${subjectA}`
    };
  }
  
  return {
    sameSubject: false,
    confidence: 1 - similarity.score,
    reason: `Low similarity (${similarity.score.toFixed(2)}), no shared entities`
  };
}

/**
 * Extract subject from text using entities
 * Domain-agnostic: uses extracted entities to determine subject
 */
function extractSubjectFromEntities(text: string): string | null {
  const entities = extractEntities(text);
  
  // Return first high-priority entity as subject
  if (entities.length > 0) {
    const primary = entities[0]; // Already sorted by priority
    return `${primary.type}:${primary.normalized}`;
  }
  
  return null;
}

/**
 * Check if claims have opposing polarity on the same subject
 */
export function hasOpposingPolarity(textA: string, textB: string): {
  opposing: boolean;
  strength: number;
  reason: string;
} {
  // Negation indicators
  const negationPatterns = [
    /\b(not|no|never|none|nothing|cannot|can't|won't|wouldn't|shouldn't|doesn't|don't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't)\b/i,
    /\b(false|incorrect|wrong|denied|declined)\b/i,
  ];
  
  const affirmationPatterns = [
    /\b(is|are|was|were|will|would|can|could|should|does|do|has|have|had)\b/i,
    /\b(yes|correct|right|true|accurate|confirmed|approved)\b/i,
  ];
  
  const hasNegationA = negationPatterns.some(p => p.test(textA));
  const hasNegationB = negationPatterns.some(p => p.test(textB));
  const hasAffirmationA = affirmationPatterns.some(p => p.test(textA));
  const hasAffirmationB = affirmationPatterns.some(p => p.test(textB));
  
  // One affirms, one denies = opposing
  if ((hasNegationA && hasAffirmationB && !hasNegationB) ||
      (hasNegationB && hasAffirmationA && !hasNegationA)) {
    return {
      opposing: true,
      strength: 0.8,
      reason: 'Direct negation vs affirmation'
    };
  }
  
  // Check for opposing value claims
  const entitiesA = extractEntities(textA);
  const entitiesB = extractEntities(textB);
  
  // Same entity type, different values = potential opposition
  for (const eA of entitiesA) {
    for (const eB of entitiesB) {
      if (eA.type === eB.type && eA.normalized !== eB.normalized) {
        // Same type, different value
        if (eA.type === 'MONEY' || eA.type === 'PERCENT' || eA.type === 'DATE') {
          return {
            opposing: true,
            strength: 0.7,
            reason: `Conflicting ${eA.type} values: ${eA.value} vs ${eB.value}`
          };
        }
      }
    }
  }
  
  // Both affirm or both deny = not opposing
  if ((hasNegationA && hasNegationB) || (hasAffirmationA && hasAffirmationB && !hasNegationA && !hasNegationB)) {
    return {
      opposing: false,
      strength: 0.3,
      reason: 'Same polarity'
    };
  }
  
  return {
    opposing: false,
    strength: 0.5,
    reason: 'Unclear polarity relationship'
  };
}

/**
 * Comprehensive contradiction check using all NLP signals
 */
export function checkContradiction(textA: string, textB: string): {
  isContradiction: boolean;
  confidence: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  
  // 1. Same subject check
  const subjectCheck = areSameSubject(textA, textB);
  if (!subjectCheck.sameSubject) {
    return {
      isContradiction: false,
      confidence: 0.9,
      reasons: ['Different subjects - cannot contradict']
    };
  }
  reasons.push(subjectCheck.reason);
  score += subjectCheck.confidence * 0.4;
  
  // 2. Opposing polarity check
  const polarityCheck = hasOpposingPolarity(textA, textB);
  if (!polarityCheck.opposing) {
    return {
      isContradiction: false,
      confidence: 0.7,
      reasons: [...reasons, 'Same or unclear polarity']
    };
  }
  reasons.push(polarityCheck.reason);
  score += polarityCheck.strength * 0.6;
  
  return {
    isContradiction: score >= 0.5,
    confidence: score,
    reasons
  };
}

