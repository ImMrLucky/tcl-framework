/**
 * NLP Configuration - Domain-agnostic extraction patterns
 *
 * The core engine is universal. Domain-specific patterns are loaded via config.
 * Each app (call center, loans, AI chat) provides its own config.
 */
/**
 * Universal entity patterns (work across all domains)
 */
export const UNIVERSAL_ENTITIES = [
    {
        type: 'MONEY',
        patterns: [
            /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
            /(\d+(?:\.\d{2})?)\s*(dollar|cent)s?/gi,
        ],
        normalizer: (match) => {
            const value = match[1].replace(/,/g, '');
            const isCents = match[2]?.toLowerCase() === 'cent';
            return Math.round(parseFloat(value) * (isCents ? 1 : 100));
        },
        priority: 100
    },
    {
        type: 'PERCENT',
        patterns: [/(\d+(?:\.\d+)?)\s*(%|percent)/gi],
        normalizer: (match) => parseFloat(match[1]),
        priority: 90
    },
    {
        type: 'DATE',
        patterns: [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g,
            /(today|yesterday|tomorrow|this week|last week|next week|this month|last month)/gi,
        ],
        priority: 80
    },
    {
        type: 'DURATION',
        patterns: [/(\d+)\s*(minute|hour|day|week|month|year)s?/gi],
        normalizer: (match) => {
            const value = parseInt(match[1]);
            const unit = match[2].toLowerCase();
            const days = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
            return Math.round(value * (days[unit] || 1));
        },
        priority: 70
    },
    {
        type: 'EMAIL',
        patterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g],
        priority: 60
    },
    {
        type: 'PHONE',
        patterns: [/(?:\+1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g],
        priority: 60
    }
];
/**
 * Universal synonym groups (work across all domains)
 */
export const UNIVERSAL_SYNONYMS = [
    { canonical: 'affirm', terms: ['yes', 'correct', 'right', 'true', 'accurate', 'confirmed'] },
    { canonical: 'deny', terms: ['no', 'incorrect', 'wrong', 'false', 'inaccurate', 'not'] },
    { canonical: 'send', terms: ['send', 'email', 'mail', 'deliver', 'provide', 'forward'] },
    { canonical: 'change', terms: ['change', 'modify', 'update', 'alter', 'adjust', 'amend'] },
    { canonical: 'cancel', terms: ['cancel', 'terminate', 'end', 'discontinue', 'close', 'stop'] },
    { canonical: 'approve', terms: ['approve', 'accept', 'grant', 'authorize', 'allow'] },
    { canonical: 'reject', terms: ['reject', 'deny', 'decline', 'refuse', 'disallow'] },
];
/**
 * Universal action patterns
 */
export const UNIVERSAL_ACTIONS = [
    {
        type: 'PROMISE',
        patterns: [
            /\b(i will|i'll|we will|we'll)\s/i,
            /\b(i can|we can)\s/i,
            /\b(i('ll| will) make sure|i('ll| will) ensure)\s/i,
        ],
        speakerConstraint: 'agent'
    },
    {
        type: 'DECISION',
        patterns: [
            /\b(approved|denied|rejected|accepted|granted|declined)\b/i,
            /\b(we (can|cannot|can't) (do|offer|provide))\b/i,
        ]
    },
    {
        type: 'EXPLANATION',
        patterns: [
            /\b(because|due to|as a result|the reason is|this is because)\b/i,
            /\b(let me explain|to clarify|what this means)\b/i,
        ]
    }
];
/**
 * Default NLP config (minimal, universal)
 */
export const DEFAULT_NLP_CONFIG = {
    domain: 'universal',
    entities: UNIVERSAL_ENTITIES,
    synonyms: UNIVERSAL_SYNONYMS,
    actions: UNIVERSAL_ACTIONS,
    statementClassification: {
        promise: ['will', "i'll", "we'll", 'going to', 'make sure', 'ensure'],
        denial: ['not', "don't", "doesn't", "didn't", 'never', 'cannot', "can't"],
        explanation: ['because', 'since', 'due to', 'reason', 'explain'],
        question: ['?', 'what', 'why', 'how', 'when', 'where', 'who', 'can you', 'could you'],
    },
    thresholds: {
        entityConfidence: 0.7,
        topicOverlap: 0.25,
        polarityStrength: 0.3,
    }
};
/**
 * Merge configs (domain config extends universal)
 */
export function mergeNLPConfig(base, extension) {
    return {
        domain: extension.domain || base.domain,
        entities: [...base.entities, ...(extension.entities || [])],
        synonyms: [...base.synonyms, ...(extension.synonyms || [])],
        actions: [...base.actions, ...(extension.actions || [])],
        statementClassification: {
            promise: [...base.statementClassification.promise, ...(extension.statementClassification?.promise || [])],
            denial: [...base.statementClassification.denial, ...(extension.statementClassification?.denial || [])],
            explanation: [...base.statementClassification.explanation, ...(extension.statementClassification?.explanation || [])],
            question: [...base.statementClassification.question, ...(extension.statementClassification?.question || [])],
        },
        thresholds: { ...base.thresholds, ...extension.thresholds },
    };
}
// ============================================================================
// Domain-specific configs are loaded from external sources, not hardcoded here
// ============================================================================
let currentConfig = DEFAULT_NLP_CONFIG;
/**
 * Set the active NLP config (called by app layer)
 */
export function setNLPConfig(config) {
    currentConfig = mergeNLPConfig(DEFAULT_NLP_CONFIG, config);
}
/**
 * Get the active NLP config
 */
export function getNLPConfig() {
    return currentConfig;
}
/**
 * Reset to default config
 */
export function resetNLPConfig() {
    currentConfig = DEFAULT_NLP_CONFIG;
}
