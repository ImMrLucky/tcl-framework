/**
 * Entity Extraction Patterns
 * 
 * Rule-based entity extraction for call transcripts.
 * This is a "quick win" improvement that doesn't require spaCy.
 * 
 * Future: Replace with spaCy NER for better accuracy.
 */

// ============================================================================
// TYPES
// ============================================================================

export type EntityType = 
  | 'FEE' 
  | 'AMOUNT' 
  | 'DATE' 
  | 'PLAN' 
  | 'PRODUCT' 
  | 'ACTION' 
  | 'DOCUMENT'
  | 'PERSON';

export interface ExtractedEntity {
  type: EntityType;
  raw: string;           // Original text
  normalized: string;    // Normalized key for matching
  value?: number;        // Numeric value if applicable
  startIdx?: number;     // Start position in text
  endIdx?: number;       // End position in text
}

// ============================================================================
// ENTITY PATTERNS
// ============================================================================

/**
 * Fee/charge patterns with normalization
 */
const FEE_PATTERNS: Array<{ pattern: RegExp; normalized: string }> = [
  { pattern: /early\s+termination\s+(fee|charge)/i, normalized: 'early_termination_fee' },
  { pattern: /cancellation\s+(fee|charge)/i, normalized: 'cancellation_fee' },
  { pattern: /service\s+adjustment\s+(fee|charge)/i, normalized: 'service_adjustment_fee' },
  { pattern: /monthly\s+(service\s+)?(fee|charge)/i, normalized: 'monthly_fee' },
  { pattern: /activation\s+(fee|charge)/i, normalized: 'activation_fee' },
  { pattern: /late\s+(payment\s+)?(fee|charge)/i, normalized: 'late_fee' },
  { pattern: /overage\s+(fee|charge)/i, normalized: 'overage_fee' },
  { pattern: /reconnection\s+(fee|charge)/i, normalized: 'reconnection_fee' },
  { pattern: /additional\s+(fee|charge)s?/i, normalized: 'additional_fees' },
  { pattern: /(fee|charge)s?\s+may\s+apply/i, normalized: 'potential_fees' },
  { pattern: /\b(fee|charge)\b/i, normalized: 'generic_fee' }, // Catch-all
];

/**
 * Amount patterns (money, percentages, counts)
 */
const AMOUNT_PATTERNS: RegExp[] = [
  /\$\s*[\d,]+(?:\.\d{2})?/g,                    // $50.00, $ 50, $1,234.56
  /(\d+(?:\.\d{2})?)\s*dollars?/gi,              // 50 dollars
  /(\d+)\s*cents?/gi,                            // 50 cents
  /(\d+(?:\.\d{1,2})?)\s*%/g,                    // 15%, 7.5%
  /(\d+(?:\.\d{1,2})?)\s*percent/gi,             // 15 percent
];

/**
 * Date/time patterns with normalization
 */
const DATE_PATTERNS: Array<{ pattern: RegExp; normalized: string }> = [
  { pattern: /this\s+(billing\s+)?cycle/i, normalized: 'this_cycle' },
  { pattern: /next\s+(billing\s+)?cycle/i, normalized: 'next_cycle' },
  { pattern: /last\s+(billing\s+)?cycle/i, normalized: 'last_cycle' },
  { pattern: /this\s+month/i, normalized: 'this_month' },
  { pattern: /next\s+month/i, normalized: 'next_month' },
  { pattern: /last\s+month/i, normalized: 'last_month' },
  { pattern: /(promotional|promo)\s+period/i, normalized: 'promo_period' },
  { pattern: /trial\s+period/i, normalized: 'trial_period' },
  { pattern: /contract\s+period/i, normalized: 'contract_period' },
  { pattern: /end\s+of\s+(the\s+)?(year|month|contract|promo)/i, normalized: 'end_of_period' },
  { pattern: /today/i, normalized: 'today' },
  { pattern: /right\s+after\s+this\s+call/i, normalized: 'today' },
  { pattern: /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g, normalized: 'specific_date' },
];

/**
 * Plan/product patterns
 */
const PLAN_PATTERNS: Array<{ pattern: RegExp; normalized: string }> = [
  { pattern: /your\s+plan/i, normalized: 'customer_plan' },
  { pattern: /current\s+plan/i, normalized: 'current_plan' },
  { pattern: /service\s+plan/i, normalized: 'service_plan' },
  { pattern: /subscription/i, normalized: 'subscription' },
  { pattern: /account/i, normalized: 'account' },
  { pattern: /rate/i, normalized: 'rate' },
  { pattern: /package/i, normalized: 'package' },
];

/**
 * Document patterns
 */
const DOCUMENT_PATTERNS: Array<{ pattern: RegExp; normalized: string }> = [
  { pattern: /service\s+agreement/i, normalized: 'service_agreement' },
  { pattern: /terms\s+(and\s+)?conditions?/i, normalized: 'terms_and_conditions' },
  { pattern: /billing\s+(statement|breakdown)/i, normalized: 'billing_statement' },
  { pattern: /contract/i, normalized: 'contract' },
  { pattern: /policy/i, normalized: 'policy' },
  { pattern: /copy\s+of\s+(your\s+)?agreement/i, normalized: 'agreement_copy' },
];

/**
 * Action patterns (verbs that matter)
 */
const ACTION_PATTERNS: Array<{ pattern: RegExp; normalized: string }> = [
  { pattern: /\b(cancel|cancell?ation)\b/i, normalized: 'cancel' },
  { pattern: /\b(change|changing|changed)\b/i, normalized: 'change' },
  { pattern: /\b(send|sending|sent)\b/i, normalized: 'send' },
  { pattern: /\b(email|emailing|emailed)\b/i, normalized: 'email' },
  { pattern: /\b(call\s+back|calling\s+back)\b/i, normalized: 'callback' },
  { pattern: /\b(refund|refunding|refunded)\b/i, normalized: 'refund' },
  { pattern: /\b(charge|charging|charged)\b/i, normalized: 'charge' },
  { pattern: /\b(apply|applies|applied)\b/i, normalized: 'apply' },
  { pattern: /\b(appear|appears|appeared)\b/i, normalized: 'appear' },
  { pattern: /\b(understand|understanding)\b/i, normalized: 'understand' },
];

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Parse a money string to a number
 */
function parseAmount(raw: string): number | undefined {
  // Remove $ and commas
  const cleaned = raw.replace(/[$,\s]/g, '');
  const match = cleaned.match(/[\d.]+/);
  if (match) {
    return parseFloat(match[0]);
  }
  return undefined;
}

/**
 * Extract all entities from text
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seenNormalized = new Set<string>();
  
  // Extract fees
  for (const { pattern, normalized } of FEE_PATTERNS) {
    const match = text.match(pattern);
    if (match && !seenNormalized.has(normalized)) {
      seenNormalized.add(normalized);
      entities.push({
        type: 'FEE',
        raw: match[0],
        normalized,
      });
    }
  }
  
  // Extract amounts
  for (const pattern of AMOUNT_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const raw = match[0];
      const value = parseAmount(raw);
      const normalized = value !== undefined ? `amount_${value}` : raw;
      if (!seenNormalized.has(normalized)) {
        seenNormalized.add(normalized);
        entities.push({
          type: 'AMOUNT',
          raw,
          normalized,
          value,
        });
      }
    }
  }
  
  // Extract dates
  for (const { pattern, normalized } of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match && !seenNormalized.has(normalized)) {
      seenNormalized.add(normalized);
      entities.push({
        type: 'DATE',
        raw: match[0],
        normalized,
      });
    }
  }
  
  // Extract plans
  for (const { pattern, normalized } of PLAN_PATTERNS) {
    const match = text.match(pattern);
    if (match && !seenNormalized.has(normalized)) {
      seenNormalized.add(normalized);
      entities.push({
        type: 'PLAN',
        raw: match[0],
        normalized,
      });
    }
  }
  
  // Extract documents
  for (const { pattern, normalized } of DOCUMENT_PATTERNS) {
    const match = text.match(pattern);
    if (match && !seenNormalized.has(normalized)) {
      seenNormalized.add(normalized);
      entities.push({
        type: 'DOCUMENT',
        raw: match[0],
        normalized,
      });
    }
  }
  
  // Extract actions
  for (const { pattern, normalized } of ACTION_PATTERNS) {
    const match = text.match(pattern);
    if (match && !seenNormalized.has(normalized)) {
      seenNormalized.add(normalized);
      entities.push({
        type: 'ACTION',
        raw: match[0],
        normalized,
      });
    }
  }
  
  return entities;
}

/**
 * Find shared entities between two texts
 */
export function findSharedEntities(textA: string, textB: string): ExtractedEntity[] {
  const entitiesA = extractEntities(textA);
  const entitiesB = extractEntities(textB);
  
  const normalizedB = new Set(entitiesB.map(e => e.normalized));
  
  return entitiesA.filter(ea => normalizedB.has(ea.normalized));
}

/**
 * Calculate entity-based similarity between two texts
 * Returns 0-1 score based on shared entities
 */
export function entitySimilarity(textA: string, textB: string): number {
  const entitiesA = extractEntities(textA);
  const entitiesB = extractEntities(textB);
  
  if (entitiesA.length === 0 && entitiesB.length === 0) {
    return 0;
  }
  
  const normalizedA = new Set(entitiesA.map(e => e.normalized));
  const normalizedB = new Set(entitiesB.map(e => e.normalized));
  
  // Jaccard similarity
  let intersection = 0;
  for (const n of normalizedA) {
    if (normalizedB.has(n)) {
      intersection++;
    }
  }
  
  const union = new Set([...normalizedA, ...normalizedB]).size;
  
  return union > 0 ? intersection / union : 0;
}

/**
 * Detect amount conflicts between two texts about the same entity
 */
export interface AmountConflict {
  entity: string;
  amountA: number;
  amountB: number;
  difference: number;
  percentDiff: number;
}

export function detectAmountConflicts(textA: string, textB: string): AmountConflict[] {
  const conflicts: AmountConflict[] = [];
  
  const entitiesA = extractEntities(textA);
  const entitiesB = extractEntities(textB);
  
  // Find shared fee/product entities
  const feesA = entitiesA.filter(e => e.type === 'FEE' || e.type === 'PLAN');
  const feesB = entitiesB.filter(e => e.type === 'FEE' || e.type === 'PLAN');
  const amountsA = entitiesA.filter(e => e.type === 'AMOUNT' && e.value !== undefined);
  const amountsB = entitiesB.filter(e => e.type === 'AMOUNT' && e.value !== undefined);
  
  // If both texts mention the same fee AND have different amounts, that's a conflict
  for (const feeA of feesA) {
    for (const feeB of feesB) {
      if (feeA.normalized === feeB.normalized) {
        // Found shared entity - check for amount differences
        for (const amtA of amountsA) {
          for (const amtB of amountsB) {
            if (amtA.value !== undefined && amtB.value !== undefined && amtA.value !== amtB.value) {
              const difference = Math.abs(amtA.value - amtB.value);
              const avgAmount = (amtA.value + amtB.value) / 2;
              const percentDiff = avgAmount > 0 ? (difference / avgAmount) * 100 : 0;
              
              conflicts.push({
                entity: feeA.normalized,
                amountA: amtA.value,
                amountB: amtB.value,
                difference,
                percentDiff,
              });
            }
          }
        }
      }
    }
  }
  
  return conflicts;
}

/**
 * Detect polarity conflicts (one affirms, one denies same thing)
 */
export interface PolarityConflict {
  sharedEntity: string;
  polarityA: 'affirm' | 'deny';
  polarityB: 'affirm' | 'deny';
}

const NEGATION_PATTERNS = [
  /\b(not|no|never|none|nothing|neither|cannot|can't|won't|wouldn't|shouldn't|doesn't|don't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't)\b/i,
];

const AFFIRMATION_PATTERNS = [
  /\b(is|are|was|were|will|would|can|could|shall|should|does|do|has|have|had|yes|absolutely|definitely|certainly|of course)\b/i,
];

export function detectPolarity(text: string): 'affirm' | 'deny' | 'neutral' {
  const hasNegation = NEGATION_PATTERNS.some(p => p.test(text));
  const hasAffirmation = AFFIRMATION_PATTERNS.some(p => p.test(text));
  
  // Strong negation wins
  if (hasNegation && !hasAffirmation) {
    return 'deny';
  }
  // Pure affirmation
  if (hasAffirmation && !hasNegation) {
    return 'affirm';
  }
  // Mixed - check for double negative or hedging
  if (hasNegation && hasAffirmation) {
    // "It's not like you can't..." = affirm (double negative)
    // "Yes, but you cannot..." = deny (negation after affirmation)
    // Simple heuristic: last one wins
    const negMatch = text.match(/\b(not|no|never|cannot|can't|won't|doesn't|don't|isn't|aren't)\b/gi);
    const affMatch = text.match(/\b(is|are|will|can|does|do|has|have|yes)\b/gi);
    
    if (negMatch && affMatch) {
      const lastNeg = text.lastIndexOf(negMatch[negMatch.length - 1]);
      const lastAff = text.lastIndexOf(affMatch[affMatch.length - 1]);
      return lastNeg > lastAff ? 'deny' : 'affirm';
    }
  }
  
  return 'neutral';
}

export function detectPolarityConflicts(textA: string, textB: string): PolarityConflict[] {
  const conflicts: PolarityConflict[] = [];
  
  const sharedEntities = findSharedEntities(textA, textB);
  if (sharedEntities.length === 0) {
    return conflicts;
  }
  
  const polarityA = detectPolarity(textA);
  const polarityB = detectPolarity(textB);
  
  // Check for opposing polarities on shared entities
  if ((polarityA === 'affirm' && polarityB === 'deny') || (polarityA === 'deny' && polarityB === 'affirm')) {
    for (const entity of sharedEntities) {
      conflicts.push({
        sharedEntity: entity.normalized,
        polarityA: polarityA as 'affirm' | 'deny',
        polarityB: polarityB as 'affirm' | 'deny',
      });
    }
  }
  
  return conflicts;
}

