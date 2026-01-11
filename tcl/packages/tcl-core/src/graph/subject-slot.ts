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
 */

import { SubjectSlot, ExtractedEntity, ClaimModality, ClaimAnchor, AnchorType } from './types.js';
import { getTemplateConfig, SlotLexiconEntry } from './template-config.js';

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
