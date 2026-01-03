/**
 * Fact Extractor - Converts claims into normalized Facts using pattern-driven schemas.
 *
 * This is deterministic: same input always produces same output.
 * No ML/NLI calls.
 */
import { createHash } from "crypto";
import { DEFAULT_CONFIG } from "../config/types.js";
import { classifyClaimKind } from "../../claim_classifier.js";
/**
 * Parse raw transcript into enhanced claims with modality, polarity, entities.
 */
export function extractEnhancedClaims(transcript, config = DEFAULT_CONFIG) {
    const lines = transcript.split('\n').filter(line => line.trim().length > 0);
    const claims = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Parse speaker: "Agent: text" or "Customer: text"
        const speakerMatch = line.match(/^(Agent|Customer|System):\s*(.+)/i);
        if (!speakerMatch)
            continue;
        const speaker = speakerMatch[1].toLowerCase();
        const text = speakerMatch[2].trim();
        if (text.length < 3)
            continue;
        // Detect modality
        const modality = detectModality(text, config.modalityLexicon);
        // Detect polarity
        const polarity = detectPolarity(text, config.modalityLexicon);
        // Extract topics from subject schemas
        const topics = extractTopics(text, config.subjectSchemas);
        // Extract entities (simple pattern-based)
        const entities = extractEntities(text);
        // Extract numbers
        const numbers = extractNumbers(text);
        // Flags
        const hasNegation = config.modalityLexicon.denialWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(text));
        const hasAbsoluteLanguage = config.modalityLexicon.absoluteWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(text));
        const hasConditionalLanguage = config.modalityLexicon.conditionalWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(text));
        // NEW: Classify claim kind and detect intent
        const claimKind = classifyClaimKind(text, speakerMatch[1]);
        const intent = detectIntent(text, speaker);
        claims.push({
            id: generateClaimId(i, text),
            speaker,
            text,
            turnIndex: i,
            modality,
            polarity,
            topics,
            claimKind, // NEW
            intent, // NEW
            entities,
            numbers,
            hasNegation,
            hasAbsoluteLanguage,
            hasConditionalLanguage,
        });
    }
    return claims;
}
/**
 * Extract normalized Facts from enhanced claims.
 */
export function extractFacts(claims, config = DEFAULT_CONFIG) {
    const facts = [];
    for (const claim of claims) {
        // Skip questions and requests - they don't assert facts
        if (claim.modality === 'question' || claim.modality === 'request') {
            continue;
        }
        // Try to match each subject schema
        for (const schema of config.subjectSchemas) {
            const match = matchesSchema(claim.text, schema);
            if (!match)
                continue;
            // Determine predicate and value
            const { predicate, value } = inferPredicateAndValue(claim, schema);
            // Determine polarity specific to this subject
            let factPolarity = claim.polarity;
            for (const [trigger, pol] of Object.entries(schema.polarityMapping)) {
                if (claim.text.toLowerCase().includes(trigger)) {
                    factPolarity = pol;
                    break;
                }
            }
            // Extract conditions
            const conditions = extractConditions(claim.text);
            // Extract timeframe cues
            const timeframe = extractTimeframe(claim.text);
            // NEW: Normalize fields
            const subjectNormalized = normalizeSubject(schema.id, config.normalization);
            const predicateNormalized = normalizePredicate(predicate, config.normalization);
            const { valueType, normalizedValue } = normalizeValue(value, factPolarity, claim, config.normalization);
            const certainty = deriveCertainty(claim.modality, claim.hasAbsoluteLanguage, claim.hasConditionalLanguage);
            const timeframeNormalized = normalizeTimeframe(timeframe, config.normalization);
            facts.push({
                id: generateFactId(claim.id, schema.id, predicate),
                claimId: claim.id,
                turnIndex: claim.turnIndex,
                speaker: claim.speaker,
                subject: schema.id,
                predicate,
                value: factPolarity === 'deny' ? false : (factPolarity === 'affirm' ? true : value),
                // NEW: Normalized fields
                subjectNormalized,
                predicateNormalized,
                valueType,
                normalizedValue,
                polarity: factPolarity,
                certainty,
                conditions,
                timeframe: timeframe || undefined,
                timeframeNormalized,
                sourceCertainty: "stated", // Renamed from certainty
            });
        }
    }
    return facts;
}
// ============================================================================
// Helper functions
// ============================================================================
/**
 * Detect intent from claim text and speaker
 */
function detectIntent(text, speaker) {
    if (speaker !== 'agent')
        return undefined;
    const lower = text.toLowerCase();
    if (/send.*email|email.*send|email.*copy|email.*agreement|email.*document/i.test(lower)) {
        return 'send_document';
    }
    if (/call.*back|call.*you|follow.*up|get.*back/i.test(lower)) {
        return 'call_back';
    }
    if (/refund|reimburse|return.*money/i.test(lower)) {
        return 'refund';
    }
    if (/cancel|cancellation/i.test(lower)) {
        return 'cancel';
    }
    if (/change.*plan|modify.*plan|switch.*plan/i.test(lower)) {
        return 'change_plan';
    }
    return undefined;
}
function detectModality(text, lexicon) {
    const lower = text.toLowerCase();
    // Check patterns first
    for (const pattern of lexicon.questionPatterns) {
        if (new RegExp(pattern, 'i').test(text)) {
            return 'question';
        }
    }
    for (const pattern of lexicon.requestPatterns) {
        if (new RegExp(pattern, 'i').test(lower)) {
            return 'request';
        }
    }
    // Check lexicon words
    for (const word of lexicon.apologyWords) {
        if (lower.includes(word)) {
            return 'apology';
        }
    }
    // Check for absolute language
    const hasAbsolute = lexicon.absoluteWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(lower));
    if (hasAbsolute) {
        return 'absolute';
    }
    // Check for conditional language
    const hasConditional = lexicon.conditionalWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(lower));
    if (hasConditional) {
        return 'conditional';
    }
    return 'informational';
}
function detectPolarity(text, lexicon) {
    const lower = text.toLowerCase();
    // Count denial and affirm indicators
    let denyScore = 0;
    let affirmScore = 0;
    for (const word of lexicon.denialWords) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
            denyScore++;
        }
    }
    for (const word of lexicon.affirmWords) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
            affirmScore++;
        }
    }
    // Double negation = affirm
    const doubleNegation = /(not|n't)\s+(no|never|without)/i.test(lower);
    if (doubleNegation) {
        affirmScore += 2;
        denyScore -= 1;
    }
    if (denyScore > affirmScore)
        return 'deny';
    if (affirmScore > denyScore)
        return 'affirm';
    return 'unknown';
}
function extractTopics(text, schemas) {
    const topics = [];
    for (const schema of schemas) {
        if (matchesSchema(text, schema)) {
            topics.push(schema.id);
        }
    }
    return topics;
}
function matchesSchema(text, schema) {
    const lower = text.toLowerCase();
    // Check keywords
    for (const keyword of schema.keywords) {
        if (lower.includes(keyword.toLowerCase())) {
            return true;
        }
    }
    // Check patterns
    for (const pattern of schema.patterns) {
        if (pattern.test(text)) {
            return true;
        }
    }
    return false;
}
function inferPredicateAndValue(claim, schema) {
    const lower = claim.text.toLowerCase();
    // Try to match specific predicates
    if (lower.includes('started') || lower.includes('began') || lower.includes('effective')) {
        return { predicate: 'started', value: true };
    }
    if (lower.includes('amount') || claim.numbers.length > 0) {
        const num = claim.numbers[0];
        return { predicate: 'amount', value: num?.value ?? num?.raw ?? null };
    }
    // Default to "exists" predicate
    return { predicate: 'exists', value: claim.polarity === 'deny' ? false : true };
}
function extractConditions(text) {
    const conditions = [];
    const lower = text.toLowerCase();
    // Promotional period condition
    if (/promo(tional)?\s*(period)?/i.test(lower) || /before.*end/i.test(lower)) {
        conditions.push('promo_period');
    }
    // Early termination condition
    if (/early/i.test(lower) || /before.*contract/i.test(lower)) {
        conditions.push('early_termination');
    }
    // Specific situations
    if (/in some cases/i.test(lower) || /depends/i.test(lower) || /situation/i.test(lower)) {
        conditions.push('situational');
    }
    return conditions;
}
function extractTimeframe(text) {
    const lower = text.toLowerCase();
    if (/this cycle/i.test(lower) || /this month/i.test(lower)) {
        return { relative: 'this_cycle' };
    }
    if (/today/i.test(lower)) {
        return { relative: 'today' };
    }
    if (/right after/i.test(lower) || /after this call/i.test(lower)) {
        return { relative: 'immediately' };
    }
    return null;
}
function extractEntities(text) {
    const entities = [];
    // Email addresses
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
        entities.push({ type: 'email', value: emailMatch[0] });
    }
    // Phone numbers
    const phoneMatch = text.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
    if (phoneMatch) {
        entities.push({ type: 'phone', value: phoneMatch[0] });
    }
    // Names (simple heuristic: "My name is X")
    const nameMatch = text.match(/my name is (\w+)/i);
    if (nameMatch) {
        entities.push({ type: 'person', value: nameMatch[1] });
    }
    return entities;
}
function extractNumbers(text) {
    const numbers = [];
    // Dollar amounts
    const dollarMatch = text.matchAll(/\$?\s*(\d+(?:\.\d{2})?)\s*(dollars?)?/gi);
    for (const match of dollarMatch) {
        numbers.push({
            raw: match[0],
            value: parseFloat(match[1]),
            unit: 'USD'
        });
    }
    // "twenty dollars" style
    const wordDollarMatch = text.match(/(twenty|thirty|forty|fifty|hundred)\s*dollars?/i);
    if (wordDollarMatch) {
        const wordToNum = {
            'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'hundred': 100
        };
        const val = wordToNum[wordDollarMatch[1].toLowerCase()];
        if (val) {
            numbers.push({ raw: wordDollarMatch[0], value: val, unit: 'USD' });
        }
    }
    // Percentages
    const percentMatch = text.matchAll(/(\d+(?:\.\d+)?)\s*%/g);
    for (const match of percentMatch) {
        numbers.push({
            raw: match[0],
            value: parseFloat(match[1]),
            unit: 'percent'
        });
    }
    return numbers;
}
// ============================================================================
// Normalization functions
// ============================================================================
/**
 * Normalize subject using synonym mapping
 */
function normalizeSubject(subject, normConfig) {
    // Check if subject has synonyms - use first synonym as normalized, or keep original
    for (const [normalized, synonyms] of Object.entries(normConfig.subjectSynonyms)) {
        if (synonyms.includes(subject) || subject === normalized) {
            return normalized;
        }
    }
    return subject.toLowerCase().replace(/\s+/g, '_');
}
/**
 * Normalize predicate using synonym mapping
 */
function normalizePredicate(predicate, normConfig) {
    for (const [normalized, synonyms] of Object.entries(normConfig.predicateSynonyms)) {
        if (synonyms.includes(predicate) || predicate === normalized) {
            return normalized;
        }
    }
    return predicate.toLowerCase();
}
/**
 * Normalize value and determine its type
 */
function normalizeValue(value, polarity, claim, normConfig) {
    // Handle boolean/null
    if (value === null || value === undefined) {
        return { valueType: 'unknown', normalizedValue: null };
    }
    if (typeof value === 'boolean') {
        return { valueType: 'boolean', normalizedValue: value };
    }
    // Handle money
    if (typeof value === 'number' && claim.numbers.some(n => n.unit === 'USD')) {
        return { valueType: 'money', normalizedValue: Math.round(value * 100) / 100 }; // Round to 2 decimals
    }
    // Handle numbers
    if (typeof value === 'number') {
        return { valueType: 'number', normalizedValue: value };
    }
    // Handle string values
    if (typeof value === 'string') {
        const lower = value.toLowerCase();
        // Check enum lexicon
        for (const [enumKey, terms] of Object.entries(normConfig.enumLexicon)) {
            if (terms.some(term => lower.includes(term))) {
                return { valueType: 'enum', normalizedValue: enumKey };
            }
        }
        // Boolean-like strings
        if (['yes', 'true', 'has', 'exists', 'present'].includes(lower)) {
            return { valueType: 'boolean', normalizedValue: true };
        }
        if (['no', 'false', "doesn't", "don't", 'absent', 'none'].includes(lower)) {
            return { valueType: 'boolean', normalizedValue: false };
        }
        // Default to string
        return { valueType: 'string', normalizedValue: lower };
    }
    return { valueType: 'unknown', normalizedValue: value };
}
/**
 * Derive certainty from modality and language flags
 */
function deriveCertainty(modality, hasAbsoluteLanguage, hasConditionalLanguage) {
    if (hasAbsoluteLanguage || modality === 'absolute') {
        return 'high';
    }
    if (hasConditionalLanguage || modality === 'conditional') {
        return 'low';
    }
    return 'medium';
}
/**
 * Normalize timeframe to canonical bucket
 */
function normalizeTimeframe(timeframe, normConfig) {
    if (!timeframe || !timeframe.relative) {
        return undefined;
    }
    const relative = timeframe.relative.toLowerCase();
    // Check if relative matches a bucket
    for (const bucket of normConfig.timeframeBuckets) {
        if (relative.includes(bucket) || bucket.includes(relative)) {
            return {
                bucket,
                relative: timeframe.relative,
            };
        }
    }
    // Default mapping for common phrases
    const defaultMapping = {
        'this_cycle': 'this_cycle',
        'this month': 'this_month',
        'today': 'today',
        'yesterday': 'yesterday',
        'promo': 'promo_period',
        'promotional': 'promo_period',
    };
    for (const [phrase, bucket] of Object.entries(defaultMapping)) {
        if (relative.includes(phrase)) {
            return {
                bucket,
                relative: timeframe.relative,
            };
        }
    }
    // Fallback: use relative as bucket
    return {
        bucket: relative.replace(/\s+/g, '_'),
        relative: timeframe.relative,
    };
}
function generateClaimId(turnIndex, text) {
    const hash = createHash('sha256').update(text).digest('hex').substring(0, 8);
    return `c${turnIndex}_${hash}`;
}
function generateFactId(claimId, subject, predicate) {
    const hash = createHash('sha256').update(`${claimId}:${subject}:${predicate}`).digest('hex').substring(0, 8);
    return `f_${hash}`;
}
