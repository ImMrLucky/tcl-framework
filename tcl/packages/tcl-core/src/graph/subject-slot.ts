/**
 * Subject Slot Computation
 * 
 * This is THE KEY UPGRADE for preventing nonsense contradictions.
 * 
 * Only claims that share the same subject slot can contradict each other.
 * 
 * Flow:
 * 1. Extract entities from claim text
 * 2. Match entities to slot lexicon
 * 3. Derive slotType and entityKey
 * 4. Normalize values if present
 * 
 * Now supports spaCy-enhanced extraction for better entity quality.
 */

import { SubjectSlot, ExtractedEntity, ClaimModality, ClaimAnchor, AnchorType } from './types.js';
import { getTemplateConfig, SlotLexiconEntry } from './template-config.js';
import { extractEntitiesAsync as extractEntitiesWithSpacy, type Entity } from '../nlp/entity-extractor.js';

// =============================================================================
// ENTITY EXTRACTION PATTERNS (Base patterns, extended by template)
// =============================================================================

const MONEY_PATTERN = /\$[\d,]+(?:\.\d{2})?|\d+(?:\.\d{2})?\s*(?:dollars?|cents?|USD)/gi;
const PERCENT_PATTERN = /\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*percent/gi;
const DATE_PATTERN = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}/gi;
const DURATION_PATTERN = /\d+\s*(?:days?|weeks?|months?|years?)/gi;

// =============================================================================
// EXTRACT ENTITIES FROM TEXT
// =============================================================================

/**
 * Extract entities using regex patterns (synchronous, backwards compatible).
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const config = getTemplateConfig();
  
  // Extract money
  let match;
  while ((match = MONEY_PATTERN.exec(text)) !== null) {
    entities.push({
      type: 'MONEY',
      value: match[0],
      normalized: normalizeMoney(match[0]),
      span: { start: match.index, end: match.index + match[0].length },
    });
  }
  MONEY_PATTERN.lastIndex = 0;
  
  // Extract percentages
  while ((match = PERCENT_PATTERN.exec(text)) !== null) {
    entities.push({
      type: 'PERCENT',
      value: match[0],
      normalized: normalizePercent(match[0]),
      span: { start: match.index, end: match.index + match[0].length },
    });
  }
  PERCENT_PATTERN.lastIndex = 0;
  
  // Extract dates
  while ((match = DATE_PATTERN.exec(text)) !== null) {
    entities.push({
      type: 'DATE',
      value: match[0],
      normalized: normalizeDate(match[0]),
      span: { start: match.index, end: match.index + match[0].length },
    });
  }
  DATE_PATTERN.lastIndex = 0;
  
  // Extract durations
  while ((match = DURATION_PATTERN.exec(text)) !== null) {
    entities.push({
      type: 'DURATION',
      value: match[0],
      normalized: normalizeDuration(match[0]),
      span: { start: match.index, end: match.index + match[0].length },
    });
  }
  DURATION_PATTERN.lastIndex = 0;
  
  // Extract lexicon-based entities
  const lexiconEntities = extractLexiconEntities(text, config.slotLexicon);
  entities.push(...lexiconEntities);
  
  return entities;
}

/**
 * Extract entities using spaCy if available, otherwise falls back to regex (async).
 * 
 * This provides enhanced entity extraction with:
 * - Better NER accuracy
 * - Coreference resolution ("it" → "the fee")
 * - Domain-specific patterns
 * 
 * Converts spaCy Entity format to ExtractedEntity format.
 */
export async function extractEntitiesAsync(text: string): Promise<ExtractedEntity[]> {
  try {
    // Try spaCy extraction
    const spacyEntities = await extractEntitiesWithSpacy(text);
    
    // Convert spaCy Entity[] to ExtractedEntity[]
    return spacyEntities.map(e => ({
      type: e.type,
      value: e.value,
      normalized: typeof e.normalized === 'string' ? e.normalized : String(e.normalized),
      span: e.span,
    }));
  } catch (error) {
    // Fall back to regex if spaCy fails
    console.warn('spaCy extraction failed in subject-slot, using regex fallback:', error);
    return extractEntities(text);
  }
}

// =============================================================================
// EXTRACT ENTITIES FROM SLOT LEXICON
// =============================================================================

function extractLexiconEntities(
  text: string, 
  lexicon: Record<string, SlotLexiconEntry>
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const textLower = text.toLowerCase();
  
  for (const [key, entry] of Object.entries(lexicon)) {
    // Check for the key itself
    if (textLower.includes(key.replace(/_/g, ' '))) {
      entities.push({
        type: entry.slotType.toUpperCase(),
        value: key,
        normalized: entry.entityKey,
      });
      continue;
    }
    
    // Check for synonyms
    for (const synonym of entry.synonyms) {
      if (textLower.includes(synonym.toLowerCase())) {
        entities.push({
          type: entry.slotType.toUpperCase(),
          value: synonym,
          normalized: entry.entityKey,
        });
        break; // Only add once per entry
      }
    }
  }
  
  return entities;
}

// =============================================================================
// COMPUTE SUBJECT SLOT (Main function)
// =============================================================================

export function computeSubjectSlot(
  text: string,
  entities: ExtractedEntity[],
  modality?: ClaimModality
): SubjectSlot {
  const config = getTemplateConfig();
  const textLower = text.toLowerCase();
  
  // E1: Step 0: Check for semantic slots (industry-agnostic policy-like statements)
  const semanticSlot = extractSemanticSlot(text, entities);
  if (semanticSlot) {
    return {
      slotType: semanticSlot.slotType,
      entityKey: semanticSlot.entityKey,
      value: extractSlotValue(entities),
      valueNorm: normalizeSlotValue(extractSlotValue(entities)),
      qualifiers: extractQualifiers(text, entities),
    };
  }
  
  // Step 1: Find primary entity from lexicon-matched entities
  const lexiconEntities = entities.filter(e => 
    Object.values(config.slotLexicon).some(l => l.entityKey === e.normalized)
  );
  
  if (lexiconEntities.length > 0) {
    // Use the first (most prominent) lexicon entity
    const primary = lexiconEntities[0];
    const lexiconEntry = Object.values(config.slotLexicon).find(
      l => l.entityKey === primary.normalized
    );
    
    if (lexiconEntry) {
      return {
        slotType: lexiconEntry.slotType,
        entityKey: lexiconEntry.entityKey,
        value: extractSlotValue(entities),
        valueNorm: normalizeSlotValue(extractSlotValue(entities)),
        qualifiers: extractQualifiers(text, entities),
      };
    }
  }
  
  // Step 2: Infer from entity types
  const primaryEntityType = inferPrimaryEntityType(entities);
  if (primaryEntityType) {
    return {
      slotType: primaryEntityType.slotType,
      entityKey: primaryEntityType.entityKey,
      value: extractSlotValue(entities),
      valueNorm: normalizeSlotValue(extractSlotValue(entities)),
    };
  }
  
  // Step 3: Semantic fallback - extract key terms from text
  const keyTerms = extractKeyTerms(text);
  if (keyTerms.length > 0) {
    return {
      slotType: 'general',
      entityKey: keyTerms[0],
      value: undefined,
      valueNorm: undefined,
    };
  }
  
  // Step 4: Default slot
  return {
    slotType: 'unknown',
    entityKey: 'unknown',
    value: undefined,
    valueNorm: undefined,
  };
}

/**
 * E1: Extract industry-agnostic semantic slots for numeric + policy-like statements
 * Returns slotType and entityKey for: AMOUNT, TIMEFRAME, FEE, REFUND, RECORDING, PAYMENT_METHOD, PLAN_PRICE, COMMITMENT
 */
function extractSemanticSlot(
  text: string,
  entities: ExtractedEntity[]
): { slotType: string; entityKey: string } | null {
  const textLower = text.toLowerCase();
  
  // FEE (late fee, cancellation fee, termination fee)
  const feePatterns = [
    { pattern: /\b(late\s*fee|cancellation\s*fee|termination\s*fee|early\s*termination|etf)\b/i, key: 'FEE' },
    { pattern: /\bfee\b.*?\b(?:late|cancel|terminat|early)\b/i, key: 'FEE' },
  ];
  for (const { pattern, key } of feePatterns) {
    if (pattern.test(text)) {
      const moneyEntity = entities.find(e => e.type === 'MONEY');
      const feeKey = moneyEntity ? `FEE:${moneyEntity.normalized}` : 'FEE:unknown';
      return { slotType: 'fee', entityKey: feeKey };
    }
  }
  
  // REFUND (refund amount, refund months)
  const refundPatterns = [
    { pattern: /\brefund\b/i, key: 'REFUND' },
    { pattern: /\bcredit\b.*?\b(?:refund|back)\b/i, key: 'REFUND' },
  ];
  for (const { pattern, key } of refundPatterns) {
    if (pattern.test(text)) {
      const moneyEntity = entities.find(e => e.type === 'MONEY');
      const durationEntity = entities.find(e => e.type === 'DURATION');
      if (moneyEntity) {
        return { slotType: 'refund', entityKey: `REFUND_AMOUNT:${moneyEntity.normalized}` };
      } else if (durationEntity && /\bmonth/i.test(text)) {
        return { slotType: 'refund', entityKey: `REFUND_MONTHS:${durationEntity.normalized}` };
      } else {
        return { slotType: 'refund', entityKey: 'REFUND:unknown' };
      }
    }
  }
  
  // RECORDING (recorded / not recorded)
  const recordingPatterns = [
    { pattern: /\b(?:call|conversation|this)\s*(?:is|will\s*be|are)\s*(?:recorded|being\s*recorded)\b/i, key: 'RECORDING:yes' },
    { pattern: /\b(?:not|not\s*being|won't\s*be|aren't)\s*recorded\b/i, key: 'RECORDING:no' },
    { pattern: /\brecord(?:ing|ed)\s*(?:yes|no|on|off)\b/i, key: 'RECORDING' },
  ];
  for (const { pattern, key } of recordingPatterns) {
    if (pattern.test(text)) {
      return { slotType: 'recording', entityKey: key.includes(':') ? key : 'RECORDING:unknown' };
    }
  }
  
  // PAYMENT_METHOD (card/CVV storage)
  const paymentPatterns = [
    { pattern: /\b(?:card|credit\s*card|debit\s*card|payment\s*card)\b/i, key: 'PAYMENT_METHOD:card' },
    { pattern: /\b(?:CVV|CVC|security\s*code|card\s*code)\b/i, key: 'PAYMENT_METHOD:cvv' },
    { pattern: /\b(?:store|storing|save|saving)\s*(?:card|CVV|payment)\b/i, key: 'PAYMENT_METHOD:storage' },
  ];
  for (const { pattern, key } of paymentPatterns) {
    if (pattern.test(text)) {
      return { slotType: 'payment_method', entityKey: key };
    }
  }
  
  // PLAN_PRICE (plan monthly rate)
  const planPricePatterns = [
    { pattern: /\b(?:plan|monthly|rate|price)\b.*?\$\d+/i, key: 'PLAN_PRICE' },
    { pattern: /\$\d+.*?\b(?:plan|monthly|rate|price)\b/i, key: 'PLAN_PRICE' },
  ];
  for (const { pattern, key } of planPricePatterns) {
    if (pattern.test(text)) {
      const moneyEntity = entities.find(e => e.type === 'MONEY');
      const planKey = moneyEntity ? `PLAN_PRICE:${moneyEntity.normalized}` : 'PLAN_PRICE:unknown';
      return { slotType: 'plan_price', entityKey: planKey };
    }
  }
  
  // COMMITMENT (guarantee/never/locked)
  const commitmentPatterns = [
    { pattern: /\b(?:guarantee|guaranteed|never\s*(?:increase|change|go\s*up)|locked|lock\s*in)\b/i, key: 'COMMITMENT:strong' },
    { pattern: /\b(?:promise|promised|commit|committed|assure|assured)\b/i, key: 'COMMITMENT:moderate' },
  ];
  for (const { pattern, key } of commitmentPatterns) {
    if (pattern.test(text)) {
      return { slotType: 'commitment', entityKey: key };
    }
  }
  
  // AMOUNT (money) - if money entity exists and no other semantic slot matched
  const moneyEntity = entities.find(e => e.type === 'MONEY');
  if (moneyEntity) {
    // Check if it's part of a fee/refund/plan context (already handled above)
    if (!/\b(fee|refund|plan|price|rate)\b/i.test(text)) {
      return { slotType: 'amount', entityKey: `AMOUNT:${moneyEntity.normalized}` };
    }
  }
  
  // TIMEFRAME - if timeframe pattern exists
  const timeframePattern = /\b(\d+)\s*(?:hours?|days?|weeks?|months?|business\s*days?)\b|\bnext\s*(?:cycle|billing\s*cycle)\b/i;
  if (timeframePattern.test(text)) {
    const durationEntity = entities.find(e => e.type === 'DURATION');
    if (durationEntity) {
      return { slotType: 'timeframe', entityKey: `TIMEFRAME:${durationEntity.normalized}` };
    }
  }
  
  return null;
}

// =============================================================================
// INFER PRIMARY ENTITY TYPE
// =============================================================================

function inferPrimaryEntityType(entities: ExtractedEntity[]): { slotType: string; entityKey: string } | null {
  // Priority order for entity types
  const priorities = ['FEE', 'PROMO', 'CONTRACT', 'PLAN', 'PAYMENT', 'SERVICE', 'ACTION', 'MONEY', 'DATE'];
  
  for (const priority of priorities) {
    const found = entities.find(e => e.type === priority);
    if (found) {
      return {
        slotType: priority.toLowerCase(),
        entityKey: found.normalized || found.value,
      };
    }
  }
  
  return null;
}

// =============================================================================
// EXTRACT SLOT VALUE
// =============================================================================

function extractSlotValue(entities: ExtractedEntity[]): any {
  // Look for numeric values first
  const money = entities.find(e => e.type === 'MONEY');
  if (money) return money.normalized;
  
  const percent = entities.find(e => e.type === 'PERCENT');
  if (percent) return percent.normalized;
  
  const date = entities.find(e => e.type === 'DATE');
  if (date) return date.normalized;
  
  const duration = entities.find(e => e.type === 'DURATION');
  if (duration) return duration.normalized;
  
  return undefined;
}

// =============================================================================
// EXTRACT QUALIFIERS
// =============================================================================

function extractQualifiers(text: string, entities: ExtractedEntity[]): Record<string, any> {
  const qualifiers: Record<string, any> = {};
  
  // Extract plan references
  const planEntity = entities.find(e => e.type === 'PLAN');
  if (planEntity) {
    qualifiers.planId = planEntity.normalized || planEntity.value;
  }
  
  // Extract date qualifiers
  const dateEntity = entities.find(e => e.type === 'DATE');
  if (dateEntity) {
    qualifiers.date = dateEntity.normalized;
  }
  
  return qualifiers;
}

// =============================================================================
// EXTRACT KEY TERMS (Semantic fallback)
// =============================================================================

function extractKeyTerms(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'up', 'about', 'into',
    'over', 'after', 'beneath', 'under', 'above', 'i', 'you', 'he', 'she',
    'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why',
    'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
    'too', 'very', 's', 't', 'just', 'now', 'this', 'that', 'these', 'those',
  ]);
  
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  // Return unique terms, preserving order
  return [...new Set(words)].slice(0, 5);
}

// =============================================================================
// NORMALIZATION HELPERS
// =============================================================================

function normalizeMoney(value: string): number {
  // Convert to cents
  const cleaned = value.replace(/[$,]/g, '');
  const num = parseFloat(cleaned);
  if (value.toLowerCase().includes('cent')) {
    return Math.round(num);
  }
  return Math.round(num * 100);
}

function normalizePercent(value: string): number {
  const cleaned = value.replace(/%|percent/gi, '').trim();
  return parseFloat(cleaned);
}

function normalizeDate(value: string): string {
  // Try to parse to ISO date
  try {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // Fall through
  }
  return value;
}

function normalizeDuration(value: string): { value: number; unit: string } {
  const match = value.match(/(\d+)\s*(days?|weeks?|months?|years?)/i);
  if (match) {
    return {
      value: parseInt(match[1], 10),
      unit: match[2].toLowerCase().replace(/s$/, ''),
    };
  }
  return { value: 0, unit: 'unknown' };
}

function normalizeSlotValue(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

// =============================================================================
// SLOT MATCHING (For contradiction eligibility)
// =============================================================================

/**
 * 2.1: Check if a slot is meaningful (not unknown/general)
 */
export function isMeaningfulSlot(slot?: SubjectSlot): boolean {
  if (!slot) return false;
  if (!slot.slotType || !slot.entityKey) return false;
  if (slot.slotType === 'unknown' || slot.slotType === 'general') return false;
  if (slot.entityKey === 'unknown' || slot.entityKey === 'general') return false;
  return true;
}

/**
 * 2.1: Updated slotsMatch to prevent unknown/unknown contradictions
 * Do NOT allow unknown/general to match
 */
export function slotsMatch(a?: SubjectSlot, b?: SubjectSlot): boolean {
  if (!isMeaningfulSlot(a) || !isMeaningfulSlot(b)) return false;
  return a!.slotType === b!.slotType && a!.entityKey === b!.entityKey;
}

export function slotsCompatible(a: SubjectSlot, b: SubjectSlot): boolean {
  // Same slot type is required for any relationship
  if (a.slotType !== b.slotType) return false;
  
  // For contradiction, entity keys must also match
  return true;
}

export function computeSlotSimilarity(a: SubjectSlot, b: SubjectSlot): number {
  if (a.slotType !== b.slotType) return 0;
  if (a.entityKey === b.entityKey) return 1;
  
  // Partial credit for same slot type but different entity key
  return 0.3;
}

// =============================================================================
// VALUE CONTRADICTION CHECK
// =============================================================================

export function valuesContradict(a: SubjectSlot, b: SubjectSlot): boolean {
  // If slots don't match, they can't contradict
  if (!slotsMatch(a, b)) return false;
  
  // If no values, can't determine contradiction
  if (a.value === undefined || b.value === undefined) return false;
  if (a.valueNorm === undefined || b.valueNorm === undefined) return false;
  
  // Check for explicit contradiction patterns first
  if (hasExplicitContradictionPattern(a, b)) {
    return true;
  }
  
  // For numeric values, use tolerance-based comparison
  if (typeof a.valueNorm === 'number' && typeof b.valueNorm === 'number') {
    return valuesContradictNumeric(a.valueNorm, b.valueNorm, a.slotType);
  }
  
  // For string values, exact mismatch = contradiction
  if (typeof a.valueNorm === 'string' && typeof b.valueNorm === 'string') {
    return a.valueNorm !== b.valueNorm;
  }
  
  // Different normalized values = potential contradiction
  return a.valueNorm !== b.valueNorm;
}

/**
 * Check for explicit contradiction patterns: increase/decrease, waived/not waived, no fee/fee
 */
export function hasExplicitContradictionPattern(a: SubjectSlot, b: SubjectSlot): boolean {
  const aText = (a.valueNorm?.toString() || '').toLowerCase();
  const bText = (b.valueNorm?.toString() || '').toLowerCase();
  
  // Increase vs Decrease patterns
  const increaseWords = ['increase', 'increased', 'increasing', 'higher', 'more', 'up', 'raise', 'raised'];
  const decreaseWords = ['decrease', 'decreased', 'decreasing', 'lower', 'less', 'down', 'reduce', 'reduced'];
  
  const aIsIncrease = increaseWords.some(w => aText.includes(w));
  const bIsDecrease = decreaseWords.some(w => bText.includes(w));
  const aIsDecrease = decreaseWords.some(w => aText.includes(w));
  const bIsIncrease = increaseWords.some(w => bText.includes(w));
  
  if ((aIsIncrease && bIsDecrease) || (aIsDecrease && bIsIncrease)) {
    return true;
  }
  
  // Waived vs Not Waived patterns
  const waivedWords = ['waived', 'waive', 'no fee', 'no charge', 'free', 'zero', '0', '$0'];
  const notWaivedWords = ['fee', 'charge', 'cost', 'price'];
  
  const aIsWaived = waivedWords.some(w => aText.includes(w));
  const bHasFee = notWaivedWords.some(w => bText.includes(w)) && !waivedWords.some(w => bText.includes(w));
  const bIsWaived = waivedWords.some(w => bText.includes(w));
  const aHasFee = notWaivedWords.some(w => aText.includes(w)) && !waivedWords.some(w => aText.includes(w));
  
  if ((aIsWaived && bHasFee) || (bIsWaived && aHasFee)) {
    return true;
  }
  
  // No fee vs Fee (numeric check)
  if (typeof a.valueNorm === 'number' && typeof b.valueNorm === 'number') {
    const aIsZero = Math.abs(a.valueNorm) < 0.01; // Within 1 cent
    const bIsZero = Math.abs(b.valueNorm) < 0.01;
    const aIsNonZero = Math.abs(a.valueNorm) >= 0.01;
    const bIsNonZero = Math.abs(b.valueNorm) >= 0.01;
    
    if ((aIsZero && bIsNonZero) || (bIsZero && aIsNonZero)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if two numeric values contradict with tolerance
 */
function valuesContradictNumeric(
  valueA: number,
  valueB: number,
  slotType: string
): boolean {
  // For money (in cents), use 1% tolerance or $0.01 minimum
  if (slotType.includes('fee') || slotType.includes('payment') || slotType.includes('money') || slotType.includes('amount')) {
    const tolerance = Math.max(1, Math.abs(valueA) * 0.01); // 1% or 1 cent, whichever is larger
    return Math.abs(valueA - valueB) > tolerance;
  }
  
  // For percentages, use 0.1% tolerance
  if (slotType.includes('percent') || slotType.includes('rate') || slotType.includes('apr')) {
    return Math.abs(valueA - valueB) > 0.1;
  }
  
  // For dates (as timestamps), exact match required
  if (slotType.includes('date') || slotType.includes('time')) {
    return valueA !== valueB;
  }
  
  // For durations (months, days), exact match required
  if (slotType.includes('duration') || slotType.includes('term') || slotType.includes('month')) {
    return Math.abs(valueA - valueB) >= 1; // At least 1 unit difference
  }
  
  // For other numeric values, use 1% relative tolerance
  const tolerance = Math.max(0.01, Math.abs(valueA) * 0.01);
  return Math.abs(valueA - valueB) > tolerance;
}

// =============================================================================
// ANCHOR-BASED MATCHING (Industry-Agnostic)
// =============================================================================

/**
 * 3.1: Compute anchor overlap between two claim anchor sets
 */
export function anchorOverlap(a: ClaimAnchor[] = [], b: ClaimAnchor[] = []): number {
  const setA = new Set(a.map(x => `${x.type}:${x.key}`));
  let hits = 0;
  for (const x of b) {
    if (setA.has(`${x.type}:${x.key}`)) hits++;
  }
  return hits;
}

/**
 * 3.1: Check if two claims have strong anchor matches
 * Strong if share MONEY or DATE/TIMEFRAME or ADDRESS/EMAIL/PHONE/CARD/SSN_LAST4
 */
export function hasStrongAnchorMatch(aAnchors: ClaimAnchor[] = [], bAnchors: ClaimAnchor[] = []): boolean {
  const strongTypes = new Set(['MONEY', 'DATE', 'TIMEFRAME', 'ADDRESS', 'EMAIL', 'PHONE', 'PAYMENT_CARD', 'SSN_LAST4']);
  const setA = new Set(aAnchors.filter(x => strongTypes.has(x.type)).map(x => `${x.type}:${x.key}`));
  return bAnchors.some(x => strongTypes.has(x.type) && setA.has(`${x.type}:${x.key}`));
}

// =============================================================================
// ANCHOR EXTRACTION (Industry-Agnostic)
// =============================================================================

/**
 * 1.2: Extract anchors from entities (generic, industry-agnostic)
 * Converts extracted entities into normalized anchor keys
 */
export function extractAnchors(entities: ExtractedEntity[], text: string): ClaimAnchor[] {
  const anchors: ClaimAnchor[] = [];
  
  // MONEY → normalized decimal string (2dp)
  const moneyEntity = entities.find(e => e.type === 'MONEY');
  if (moneyEntity && moneyEntity.normalized) {
    const amount = typeof moneyEntity.normalized === 'number' ? moneyEntity.normalized / 100 : moneyEntity.normalized;
    anchors.push({
      type: 'MONEY',
      key: typeof amount === 'number' ? amount.toFixed(2) : String(amount),
      raw: moneyEntity.value,
      span: moneyEntity.span,
      confidence: moneyEntity.confidence,
    });
  }
  
  // DATE → normalized ISO or text normalized
  const dateEntity = entities.find(e => e.type === 'DATE');
  if (dateEntity && dateEntity.normalized) {
    anchors.push({
      type: 'DATE',
      key: String(dateEntity.normalized),
      raw: dateEntity.value,
      span: dateEntity.span,
      confidence: dateEntity.confidence,
    });
  }
  
  // TIMEFRAME → normalize "24 hours", "7–10 business days", "next cycle"
  const timeframePatterns = [
    { pattern: /\b(\d+)\s*hours?\b/i, normalize: (m: RegExpMatchArray) => `${m[1]}_h` },
    { pattern: /\b(\d+)\s*days?\b/i, normalize: (m: RegExpMatchArray) => `${m[1]}_d` },
    { pattern: /\b(\d+)\s*weeks?\b/i, normalize: (m: RegExpMatchArray) => `${m[1]}_w` },
    { pattern: /\b(\d+)\s*months?\b/i, normalize: (m: RegExpMatchArray) => `${m[1]}_m` },
    { pattern: /\b(\d+)[-–](\d+)\s*business\s*days?\b/i, normalize: (m: RegExpMatchArray) => `${m[1]}-${m[2]}_bd` },
    { pattern: /\bnext\s*cycle\b/i, normalize: () => 'next_cycle' },
    { pattern: /\bnext\s*billing\s*cycle\b/i, normalize: () => 'next_billing_cycle' },
  ];
  
  for (const { pattern, normalize } of timeframePatterns) {
    const match = text.match(pattern);
    if (match) {
      anchors.push({
        type: 'TIMEFRAME',
        key: normalize(match),
        raw: match[0],
        span: match.index !== undefined ? { start: match.index, end: match.index + match[0].length } : undefined,
      });
      break; // Only add first match
    }
  }
  
  // PERCENT
  const percentEntity = entities.find(e => e.type === 'PERCENT');
  if (percentEntity && percentEntity.normalized) {
    anchors.push({
      type: 'PERCENT',
      key: String(percentEntity.normalized),
      raw: percentEntity.value,
      span: percentEntity.span,
      confidence: percentEntity.confidence,
    });
  }
  
  // QUANTITY (from DURATION or other numeric entities)
  const durationEntity = entities.find(e => e.type === 'DURATION');
  if (durationEntity && durationEntity.normalized) {
    anchors.push({
      type: 'QUANTITY',
      key: String(durationEntity.normalized),
      raw: durationEntity.value,
      span: durationEntity.span,
      confidence: durationEntity.confidence,
    });
  }
  
  // EMAIL
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emailMatch = text.match(emailPattern);
  if (emailMatch) {
    for (const email of emailMatch) {
      anchors.push({
        type: 'EMAIL',
        key: email.toLowerCase(),
        raw: email,
        span: text.indexOf(email) !== -1 ? { start: text.indexOf(email), end: text.indexOf(email) + email.length } : undefined,
      });
    }
  }
  
  // PHONE
  const phonePattern = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
  const phoneMatch = text.match(phonePattern);
  if (phoneMatch) {
    for (const phone of phoneMatch) {
      const normalized = phone.replace(/\D/g, '');
      anchors.push({
        type: 'PHONE',
        key: normalized.length === 10 ? normalized : normalized.slice(-10), // Last 10 digits
        raw: phone,
        span: text.indexOf(phone) !== -1 ? { start: text.indexOf(phone), end: text.indexOf(phone) + phone.length } : undefined,
      });
    }
  }
  
  // PAYMENT_CARD (masked - only last 4)
  const cardPattern = /\b(?:\d[-\s]?){13,19}\b/g;
  const cardMatch = text.match(cardPattern);
  if (cardMatch) {
    for (const card of cardMatch) {
      const digits = card.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19) {
        const last4 = digits.slice(-4);
        anchors.push({
          type: 'PAYMENT_CARD',
          key: `card_last4:${last4}`,
          raw: card,
          span: text.indexOf(card) !== -1 ? { start: text.indexOf(card), end: text.indexOf(card) + card.length } : undefined,
        });
      }
    }
  }
  
  // CVV (presence only - never store digits)
  const cvvPattern = /\b(?:CVV|CVC|security\s*code|card\s*code)\b.*?\b\d{3,4}\b/i;
  if (cvvPattern.test(text)) {
    anchors.push({
      type: 'PAYMENT_CARD', // Use same type for CVV
      key: 'cvv_present:true',
      raw: 'CVV mentioned',
    });
  }
  
  // SSN_LAST4
  const ssnPattern = /\b(?:SSN|social\s*security|last\s*four)\b.*?\b(\d{4})\b/i;
  const ssnMatch = text.match(ssnPattern);
  if (ssnMatch && ssnMatch[1]) {
    anchors.push({
      type: 'SSN_LAST4',
      key: `ssn_last4:${ssnMatch[1]}`,
      raw: `SSN last 4: ${ssnMatch[1]}`,
    });
  }
  
  // URL
  const urlPattern = /https?:\/\/[^\s]+/gi;
  const urlMatch = text.match(urlPattern);
  if (urlMatch) {
    for (const url of urlMatch) {
      anchors.push({
        type: 'URL',
        key: url.toLowerCase(),
        raw: url,
        span: text.indexOf(url) !== -1 ? { start: text.indexOf(url), end: text.indexOf(url) + url.length } : undefined,
      });
    }
  }
  
  return anchors;
}

/**
 * Helper function for customer denial vs assertion pattern
 */
export function hasCustomerDenialVsAssertion(claimA: any, claimB: any): boolean {
  // Check if one is a customer denial and the other is an agent assertion
  const aText = (claimA.text || '').toLowerCase();
  const bText = (claimB.text || '').toLowerCase();
  const aSpeaker = claimA.speakerRole || claimA.meta?.speaker || '';
  const bSpeaker = claimB.speakerRole || claimB.meta?.speaker || '';
  
  const denialWords = ['no', 'not', "don't", "didn't", "won't", "can't", "cannot", 'never', 'none', 'nothing'];
  const assertionWords = ['yes', 'will', 'can', 'do', 'does', 'did', 'has', 'have', 'is', 'are'];
  
  const aIsDenial = denialWords.some(w => aText.includes(w));
  const bIsAssertion = assertionWords.some(w => bText.includes(w));
  const aIsAssertion = assertionWords.some(w => aText.includes(w));
  const bIsDenial = denialWords.some(w => bText.includes(w));
  
  // Customer denial vs agent assertion (or vice versa)
  const customerDenial = (aSpeaker === 'customer' || aSpeaker === 'CUSTOMER') && aIsDenial;
  const agentAssertion = (bSpeaker === 'agent' || bSpeaker === 'AGENT') && bIsAssertion;
  const agentDenial = (aSpeaker === 'agent' || aSpeaker === 'AGENT') && aIsDenial;
  const customerAssertion = (bSpeaker === 'customer' || bSpeaker === 'CUSTOMER') && bIsAssertion;
  
  return (customerDenial && agentAssertion) || (agentDenial && customerAssertion) ||
         ((aSpeaker === 'customer' || aSpeaker === 'CUSTOMER') && aIsDenial && (bSpeaker === 'agent' || bSpeaker === 'AGENT') && bIsAssertion) ||
         ((aSpeaker === 'agent' || aSpeaker === 'AGENT') && aIsDenial && (bSpeaker === 'customer' || bSpeaker === 'CUSTOMER') && bIsAssertion);
}
