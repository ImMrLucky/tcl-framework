/**
 * Scoring Configuration
 * 
 * ALL thresholds and weights must come from here - NO hard-coded values in graph/scoring code.
 * This enables tuning per-vertical (billing, insurance, support) and per-org.
 */

export interface ScoringConfig {
  // ============================================================================
  // THRESHOLDS
  // ============================================================================
  thresholds: {
    /** Minimum score for support edge creation (0-1) */
    supportThreshold: number;
    /** Minimum score for contradiction edge creation (0-1) */
    contradictionThreshold: number;
    /** Minimum score for grounding edge creation (0-1) */
    groundingThreshold: number;
    /** Minimum topic overlap for DIRECT contradiction (0-1) */
    minTopicOverlapForContradiction: number;
    /** Below this, don't create any contradiction edge at all */
    minTopicOverlapForAnyEdge: number;
  };

  // ============================================================================
  // WEIGHTS for score computation
  // ============================================================================
  weights: {
    /** Weight for contradiction energy in overall score */
    wContradictionEnergy: number;
    /** Weight for ungrounded claims penalty */
    wUngrounded: number;
    /** Weight for unverified claims penalty */
    wUnverified: number;
    /** Weight for unverified promises (agent commitments) */
    wPromiseRisk: number;
    /** Weight for direct contradictions vs topic_mismatch */
    wDirectContradiction: number;
  };

  // ============================================================================
  // REVIEW ITEM generation
  // ============================================================================
  review: {
    /** Top K contradictions to surface */
    topKContradictions: number;
    /** Top K destructive claims to surface */
    topKDestructiveClaims: number;
    /** Max review items to return */
    topKReviewItems: number;
    /** Minimum severity to include in review items */
    minSeverityForReview: "low" | "medium" | "high";
  };

  // ============================================================================
  // CLAIM CLASSIFICATION
  // ============================================================================
  classification: {
    /** Claim kinds that CANNOT create direct contradictions */
    nonContradictoryKinds: string[];
    /** Claim kinds that can only contradict their own kind */
    selfContradictoryKinds: string[];
  };

  // ============================================================================
  // TOPIC KEYWORDS for overlap detection
  // ============================================================================
  topicKeywords: {
    /** Domain-specific keywords grouped by topic */
    billing: string[];
    plan: string[];
    fees: string[];
    termination: string[];
    promises: string[];
    account: string[];
    contact: string[];
  };
}

/**
 * Default configuration - can be overridden per-vertical or per-org.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  thresholds: {
    supportThreshold: 0.45,
    contradictionThreshold: 0.55,
    groundingThreshold: 0.40,
    minTopicOverlapForContradiction: 0.25, // At least 25% keyword overlap for DIRECT
    minTopicOverlapForAnyEdge: 0.10,       // At least 10% for any edge
  },

  weights: {
    wContradictionEnergy: 0.35,
    wUngrounded: 0.25,
    wUnverified: 0.20,
    wPromiseRisk: 0.30,
    wDirectContradiction: 1.0, // Full weight for direct contradictions
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
export function getScoringConfig(): ScoringConfig {
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
export function mergeConfig(custom: Partial<ScoringConfig>): ScoringConfig {
  const base = getScoringConfig();
  return {
    thresholds: { ...base.thresholds, ...custom.thresholds },
    weights: { ...base.weights, ...custom.weights },
    review: { ...base.review, ...custom.review },
    classification: { ...base.classification, ...custom.classification },
    topicKeywords: { ...base.topicKeywords, ...custom.topicKeywords },
  };
}

