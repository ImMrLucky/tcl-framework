/**
 * Scoring Configuration
 *
 * ALL thresholds and weights must come from here - NO hard-coded values in graph/scoring code.
 * This enables tuning per-vertical (billing, insurance, support) and per-org.
 */
/**
 * Default configuration - can be overridden per-vertical or per-org.
 */
export const DEFAULT_SCORING_CONFIG = {
    thresholds: {
        supportThreshold: 0.45,
        contradictionThreshold: 0.55,
        groundingThreshold: 0.40,
        minTopicOverlapForContradiction: 0.25, // At least 25% keyword overlap for DIRECT
        minTopicOverlapForAnyEdge: 0.10, // At least 10% for any edge
    },
    weights: {
        wContradictionEnergy: 0.35,
        wUngrounded: 0.25,
        wUnverified: 0.20,
        wPromiseRisk: 0.30,
        wDirectContradiction: 1.0, // Full weight for direct contradictions
        issueComposite: {
            risk: 0.5,
            impact: 0.3,
            fixability: 0.2,
        },
    },
    review: {
        topKContradictions: 5,
        topKDestructiveClaims: 3,
        topKReviewItems: 10,
        minSeverityForReview: "medium",
    },
    classification: {
        // These kinds CANNOT create direct contradictions
        nonContradictoryKinds: ["intent", "emotion", "question", "meta"],
        // These kinds can only contradict other claims of the same kind
        selfContradictoryKinds: ["promise"],
    },
    topicKeywords: {
        billing: ["bill", "billing", "charge", "charged", "payment", "pay", "cost", "price", "rate", "invoice"],
        plan: ["plan", "package", "subscription", "service", "account", "tier", "level"],
        fees: ["fee", "fees", "charge", "penalty", "surcharge", "extra", "additional", "adjustment"],
        termination: ["cancel", "cancellation", "terminate", "termination", "end", "close", "discontinue", "early"],
        promises: ["will", "i'll", "i'm going to", "send", "email", "call", "confirm", "follow up", "get back"],
        account: ["account", "profile", "settings", "information", "details", "record"],
        contact: ["email", "phone", "call", "contact", "reach", "address", "write", "send"],
    },
};
/**
 * Get scoring config, allowing environment overrides.
 */
export function getScoringConfig() {
    // Start with defaults
    const config = { ...DEFAULT_SCORING_CONFIG };
    // Allow environment overrides for key thresholds
    if (process.env.TCL_CONTRADICTION_THRESHOLD) {
        config.thresholds.contradictionThreshold = parseFloat(process.env.TCL_CONTRADICTION_THRESHOLD);
    }
    if (process.env.TCL_SUPPORT_THRESHOLD) {
        config.thresholds.supportThreshold = parseFloat(process.env.TCL_SUPPORT_THRESHOLD);
    }
    if (process.env.TCL_MIN_TOPIC_OVERLAP) {
        config.thresholds.minTopicOverlapForContradiction = parseFloat(process.env.TCL_MIN_TOPIC_OVERLAP);
    }
    if (process.env.TCL_TOP_K_REVIEW_ITEMS) {
        config.review.topKReviewItems = parseInt(process.env.TCL_TOP_K_REVIEW_ITEMS, 10);
    }
    return config;
}
/**
 * Merge custom config with defaults (for per-org overrides).
 */
export function mergeConfig(custom) {
    const base = getScoringConfig();
    return {
        thresholds: { ...base.thresholds, ...custom.thresholds },
        weights: { ...base.weights, ...custom.weights },
        review: { ...base.review, ...custom.review },
        classification: { ...base.classification, ...custom.classification },
        topicKeywords: { ...base.topicKeywords, ...custom.topicKeywords },
    };
}
