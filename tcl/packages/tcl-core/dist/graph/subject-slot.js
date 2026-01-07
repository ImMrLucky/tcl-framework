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
import { getTemplateConfig } from './template-config.js';
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
export function extractEntities(text) {
    const entities = [];
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
function extractLexiconEntities(text, lexicon) {
    const entities = [];
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
export function computeSubjectSlot(text, entities, modality) {
    const config = getTemplateConfig();
    // Step 1: Find primary entity from lexicon-matched entities
    const lexiconEntities = entities.filter(e => Object.values(config.slotLexicon).some(l => l.entityKey === e.normalized));
    if (lexiconEntities.length > 0) {
        // Use the first (most prominent) lexicon entity
        const primary = lexiconEntities[0];
        const lexiconEntry = Object.values(config.slotLexicon).find(l => l.entityKey === primary.normalized);
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
function inferPrimaryEntityType(entities) {
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
function extractSlotValue(entities) {
    // Look for numeric values first
    const money = entities.find(e => e.type === 'MONEY');
    if (money)
        return money.normalized;
    const percent = entities.find(e => e.type === 'PERCENT');
    if (percent)
        return percent.normalized;
    const date = entities.find(e => e.type === 'DATE');
    if (date)
        return date.normalized;
    const duration = entities.find(e => e.type === 'DURATION');
    if (duration)
        return duration.normalized;
    return undefined;
}
// =============================================================================
// EXTRACT QUALIFIERS
// =============================================================================
function extractQualifiers(text, entities) {
    const qualifiers = {};
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
function extractKeyTerms(text) {
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
function normalizeMoney(value) {
    // Convert to cents
    const cleaned = value.replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    if (value.toLowerCase().includes('cent')) {
        return Math.round(num);
    }
    return Math.round(num * 100);
}
function normalizePercent(value) {
    const cleaned = value.replace(/%|percent/gi, '').trim();
    return parseFloat(cleaned);
}
function normalizeDate(value) {
    // Try to parse to ISO date
    try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
    }
    catch {
        // Fall through
    }
    return value;
}
function normalizeDuration(value) {
    const match = value.match(/(\d+)\s*(days?|weeks?|months?|years?)/i);
    if (match) {
        return {
            value: parseInt(match[1], 10),
            unit: match[2].toLowerCase().replace(/s$/, ''),
        };
    }
    return { value: 0, unit: 'unknown' };
}
function normalizeSlotValue(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}
// =============================================================================
// SLOT MATCHING (For contradiction eligibility)
// =============================================================================
export function slotsMatch(a, b) {
    // Exact match on slotType and entityKey
    return a.slotType === b.slotType && a.entityKey === b.entityKey;
}
export function slotsCompatible(a, b) {
    // Same slot type is required for any relationship
    if (a.slotType !== b.slotType)
        return false;
    // For contradiction, entity keys must also match
    return true;
}
export function computeSlotSimilarity(a, b) {
    if (a.slotType !== b.slotType)
        return 0;
    if (a.entityKey === b.entityKey)
        return 1;
    // Partial credit for same slot type but different entity key
    return 0.3;
}
// =============================================================================
// VALUE CONTRADICTION CHECK
// =============================================================================
export function valuesContradict(a, b) {
    // If slots don't match, they can't contradict
    if (!slotsMatch(a, b))
        return false;
    // If no values, can't determine contradiction
    if (a.value === undefined || b.value === undefined)
        return false;
    if (a.valueNorm === undefined || b.valueNorm === undefined)
        return false;
    // Different normalized values = potential contradiction
    return a.valueNorm !== b.valueNorm;
}
