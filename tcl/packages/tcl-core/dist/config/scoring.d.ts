/**
 * Scoring Configuration
 *
 * ALL thresholds and weights must come from here - NO hard-coded values in graph/scoring code.
 * This enables tuning per-vertical (billing, insurance, support) and per-org.
 */
export interface ScoringConfig {
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
        /** Weights for issue composite scoring (risk + impact + fixability) */
        issueComposite: {
            risk: number;
            impact: number;
            fixability: number;
        };
    };
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
    classification: {
        /** Claim kinds that CANNOT create direct contradictions */
        nonContradictoryKinds: string[];
        /** Claim kinds that can only contradict their own kind */
        selfContradictoryKinds: string[];
    };
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
export declare const DEFAULT_SCORING_CONFIG: ScoringConfig;
/**
 * Get scoring config, allowing environment overrides.
 */
export declare function getScoringConfig(): ScoringConfig;
/**
 * Merge custom config with defaults (for per-org overrides).
 */
export declare function mergeConfig(custom: Partial<ScoringConfig>): ScoringConfig;
