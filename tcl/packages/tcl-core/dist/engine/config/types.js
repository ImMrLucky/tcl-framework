/**
 * Configuration types for the deterministic truth graph engine.
 * All weights, thresholds, and rule parameters come from config - never hard-coded.
 */
/**
 * Default configuration - loaded if no custom config provided.
 * Can be overridden by vertical-specific or org-specific configs.
 */
export const DEFAULT_CONFIG = {
    version: "1.0.0",
    edgeWeights: {
        contradictionBase: 0.8,
        supportBase: 0.5,
        groundingBase: 0.6,
        structureBase: 0.4,
        modalityAbsoluteMultiplier: 1.3,
        modalityConditionalMultiplier: 0.8,
        polarityConflictMultiplier: 1.2,
        timeframeConflictMultiplier: 1.1,
        agentSpeakerMultiplier: 1.2,
        customerSpeakerMultiplier: 0.9,
        paraphraseSupportMultiplier: 0.9,
        agentConfirmMultiplier: 1.1,
        qualificationEdgeMultiplier: 0.7,
    },
    pruning: {
        topKPerNodePerType: 5,
        minWeightContradiction: 0.3,
        minWeightSupport: 0.4,
        minWeightGrounding: 0.3,
        minWeightStructure: 0.2,
        mergeBeforePrune: true,
    },
    modalityLexicon: {
        absoluteWords: [
            "never", "always", "guarantee", "guaranteed", "definitely", "certainly",
            "no", "none", "any time", "anytime", "will not", "won't", "cannot", "can't",
            "without", "free", "zero", "unlimited"
        ],
        conditionalWords: [
            "may", "might", "could", "depends", "depending", "in some cases",
            "if", "unless", "when", "sometimes", "potentially", "possibly"
        ],
        denialWords: [
            "no", "not", "none", "never", "don't", "doesn't", "didn't", "won't",
            "can't", "cannot", "without", "zero", "nothing"
        ],
        affirmWords: [
            "yes", "will", "can", "do", "does", "is", "are", "there is", "there are",
            "absolutely", "correct", "right", "exactly"
        ],
        apologyWords: [
            "apologize", "apology", "sorry", "apologies", "regret", "unfortunately"
        ],
        questionPatterns: [
            "\\?$", "^can i", "^can you", "^is there", "^are there", "^do you",
            "^does", "^what", "^where", "^when", "^why", "^how", "^who"
        ],
        requestPatterns: [
            "can you send", "please send", "i want", "i need", "i'd like",
            "could you", "would you", "send me", "give me", "show me"
        ],
    },
    subjectSchemas: [
        {
            id: "cancellation_fee",
            keywords: ["cancel", "cancellation", "cancelling"],
            patterns: [/cancel(l?ation)?\s*(fee|charge|penalty)/i],
            predicates: ["exists", "amount", "applies", "waived"],
            polarityMapping: { "without": "deny", "no": "deny", "free": "deny" },
            relatedSubjects: ["early_termination_fee"],
        },
        {
            id: "early_termination_fee",
            keywords: ["early", "termination", "terminate"],
            patterns: [/early\s*termination\s*(fee|charge)/i, /terminate\s*early/i],
            predicates: ["exists", "amount", "applies", "conditions"],
            polarityMapping: { "may be": "affirm", "there may": "affirm" },
            relatedSubjects: ["cancellation_fee"],
        },
        {
            id: "extra_fees",
            keywords: ["extra", "additional", "hidden"],
            patterns: [/(extra|additional|hidden)\s*(fee|charge|cost)s?/i],
            predicates: ["exists", "amount", "types"],
            polarityMapping: { "no": "deny", "none": "deny", "without": "deny" },
        },
        {
            id: "adjustment_fee",
            keywords: ["adjustment", "service adjustment"],
            patterns: [/(service\s*)?adjustment\s*(fee|charge)/i],
            predicates: ["exists", "amount", "started", "cycle"],
            polarityMapping: {},
        },
        {
            id: "rate_change",
            keywords: ["rate", "price", "cost", "bill"],
            patterns: [/rate\s*(change|increas|decreas)/i, /bill.*higher/i, /price.*change/i],
            predicates: ["changed", "amount", "reason"],
            polarityMapping: { "hasn't changed": "deny", "hasn't": "deny" },
        },
        {
            id: "plan_change",
            keywords: ["plan", "package", "subscription"],
            patterns: [/plan\s*(change|modif)/i],
            predicates: ["changed", "type", "effective"],
            polarityMapping: { "hasn't changed": "deny" },
        },
        {
            id: "written_confirmation",
            keywords: ["email", "writing", "written", "send", "copy"],
            patterns: [/send.*email/i, /email.*copy/i, /in\s*writing/i],
            predicates: ["promised", "timeframe", "content"],
            polarityMapping: {},
        },
        {
            id: "promo_period",
            keywords: ["promo", "promotional", "promotion"],
            patterns: [/promo(tional)?\s*period/i, /promotional\s*pricing/i],
            predicates: ["active", "end_date", "conditions"],
            polarityMapping: {},
        },
    ],
    evidenceRetrieval: {
        enabled: false, // Disabled by default, enable when corpus available
        maxChunksPerClaim: 3,
        minKeywordOverlap: 0.2,
        authorityWeights: {
            policy: 1.0,
            agreement: 0.9,
            kb: 0.7,
            product: 0.6,
        },
    },
    rules: {
        "POLARITY_CONFLICT": {
            id: "POLARITY_CONFLICT",
            enabled: true,
            priority: 1,
            severity: "high",
            description: "Same subject with conflicting polarity (affirm vs deny)",
            maxTurnDistance: 20, // Only compare within 20 turns
            topicOverlapMin: 0.3, // Minimum topic overlap
        },
        "ABSOLUTE_TO_CONDITIONAL": {
            id: "ABSOLUTE_TO_CONDITIONAL",
            enabled: true,
            priority: 2,
            severity: "high",
            description: "Absolute statement followed by conditional qualifier",
            mode: "qualification", // Default to qualification edge, not contradiction
            maxTurnDistance: 15,
        },
        "TIMEFRAME_CONFLICT": {
            id: "TIMEFRAME_CONFLICT",
            enabled: true,
            priority: 3,
            severity: "medium",
            description: "Overlapping timeframes with conflicting states",
            bucketOverlapMap: {}, // Will use normalization.timeframeOverlapMap
        },
        "AGENT_SELF_CONTRADICTION": {
            id: "AGENT_SELF_CONTRADICTION",
            enabled: true,
            priority: 1,
            severity: "critical",
            description: "Agent contradicts their own previous statement",
        },
        "SUPPORT_REPETITION": {
            id: "SUPPORT_REPETITION",
            enabled: true,
            priority: 5,
            severity: "low",
            description: "Same claim repeated or paraphrased",
        },
        "QUESTION_ANSWER": {
            id: "QUESTION_ANSWER",
            enabled: true,
            priority: 4,
            severity: "low",
            description: "Customer question followed by agent answer",
        },
        "REQUEST_FULFILLMENT": {
            id: "REQUEST_FULFILLMENT",
            enabled: true,
            priority: 4,
            severity: "low",
            description: "Customer request followed by agent promise",
            windowTurns: 4,
        },
        "SUPPORT_COMPATIBLE": {
            id: "SUPPORT_COMPATIBLE",
            enabled: true,
            priority: 5,
            severity: "low",
            description: "Compatible values support each other",
            maxTurnDistance: 10,
        },
        "SUPPORT_PARAPHRASE": {
            id: "SUPPORT_PARAPHRASE",
            enabled: true,
            priority: 5,
            severity: "low",
            description: "Paraphrased statements support each other",
            maxTurnDistance: 10,
        },
        "SUPPORT_AGENT_CONFIRM": {
            id: "SUPPORT_AGENT_CONFIRM",
            enabled: true,
            priority: 4,
            severity: "low",
            description: "Agent confirms customer statement",
            maxTurnDistance: 5,
        },
    },
    // NEW: Normalization configuration
    normalization: {
        subjectSynonyms: {
            "cancellation_fee": ["cancel fee", "termination charge", "cancellation charge"],
            "early_termination_fee": ["early termination", "termination fee", "early exit fee"],
            "adjustment_fee": ["service adjustment", "adjustment charge", "monthly adjustment"],
            "rate_change": ["price change", "cost change", "bill change", "rate increase", "rate decrease"],
            "plan_change": ["package change", "subscription change", "plan modification"],
        },
        predicateSynonyms: {
            "exists": ["present", "applies", "charged", "incurred"],
            "amount": ["cost", "price", "value", "charge"],
            "applies": ["active", "relevant", "in effect"],
            "changed": ["modified", "updated", "altered"],
        },
        enumLexicon: {
            "fee_present": ["fee", "charge", "cost", "payment"],
            "cancellation_fee_present": ["cancellation fee", "cancel fee", "termination charge"],
            "promo_period_active": ["promo", "promotional", "promotion period"],
            "plan_changed": ["plan change", "package change", "subscription change"],
        },
        antonyms: [
            ["yes", "no"],
            ["has", "hasn't"],
            ["changed", "unchanged"],
            ["exists", "doesn't exist"],
            ["present", "absent"],
            ["active", "inactive"],
        ],
        moneyTolerance: 0.01,
        numericTolerance: 0.1,
        numericConflictTolerance: 0.5,
        timeframeBuckets: [
            "this_cycle",
            "last_cycle",
            "today",
            "yesterday",
            "promo_period",
            "contract_term",
            "this_month",
            "last_month",
        ],
        timeframeOverlapMap: {
            "this_cycle": ["today", "this_month", "promo_period"],
            "today": ["this_cycle", "this_month"],
            "promo_period": ["this_cycle", "this_month"],
            "this_month": ["this_cycle", "today", "promo_period"],
            "last_cycle": ["last_month"],
            "last_month": ["last_cycle"],
        },
        negationTokens: ["no", "not", "none", "never", "don't", "doesn't", "didn't", "won't", "can't", "cannot", "without", "zero", "nothing"],
        modalityTokens: {
            absolute: ["never", "always", "guarantee", "guaranteed", "definitely", "certainly", "will not", "won't", "cannot", "can't", "without", "free", "zero", "unlimited"],
            conditional: ["may", "might", "could", "depends", "depending", "in some cases", "if", "unless", "when", "sometimes", "potentially", "possibly"],
        },
    },
    // NEW: Issue scoring configuration
    issueScoring: {
        ruleSeverityWeights: {
            "AGENT_SELF_CONTRADICTION": 1.5,
            "POLARITY_CONFLICT": 1.2,
            "ABSOLUTE_TO_CONDITIONAL": 1.1,
            "TIMEFRAME_CONFLICT": 1.0,
            "SUPPORT_REPETITION": 0.5,
            "QUESTION_ANSWER": 0.3,
            "REQUEST_FULFILLMENT": 0.3,
        },
        agentBoost: 1.3,
        recurrenceBoost: 1.2,
        confidenceWeights: {
            high: 1.0,
            medium: 0.7,
            low: 0.4,
        },
    },
    // NEW: Analysis mode
    analysis: {
        evidenceMode: 'transcript_only', // Default to transcript-only mode
    },
};
