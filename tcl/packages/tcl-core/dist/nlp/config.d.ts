/**
 * NLP Configuration - Domain-agnostic extraction patterns
 *
 * The core engine is universal. Domain-specific patterns are loaded via config.
 * Each app (call center, loans, AI chat) provides its own config.
 */
export interface EntityPattern {
    type: string;
    patterns: RegExp[];
    normalizer?: (match: RegExpMatchArray) => string | number;
    priority?: number;
}
export interface SynonymGroup {
    canonical: string;
    terms: string[];
}
export interface ActionPattern {
    type: string;
    patterns: RegExp[];
    speakerConstraint?: 'any' | 'agent' | 'customer' | 'system';
}
export interface NLPConfig {
    /**
     * Domain identifier (for logging/debugging)
     */
    domain: string;
    /**
     * Entity extraction patterns
     */
    entities: EntityPattern[];
    /**
     * Synonym groups for semantic matching
     */
    synonyms: SynonymGroup[];
    /**
     * Action detection patterns
     */
    actions: ActionPattern[];
    /**
     * Statement classification keywords
     */
    statementClassification: {
        promise: string[];
        denial: string[];
        explanation: string[];
        question: string[];
    };
    /**
     * Minimum thresholds
     */
    thresholds: {
        entityConfidence: number;
        topicOverlap: number;
        polarityStrength: number;
    };
}
/**
 * Universal entity patterns (work across all domains)
 */
export declare const UNIVERSAL_ENTITIES: EntityPattern[];
/**
 * Universal synonym groups (work across all domains)
 */
export declare const UNIVERSAL_SYNONYMS: SynonymGroup[];
/**
 * Universal action patterns
 */
export declare const UNIVERSAL_ACTIONS: ActionPattern[];
/**
 * Default NLP config (minimal, universal)
 */
export declare const DEFAULT_NLP_CONFIG: NLPConfig;
/**
 * Merge configs (domain config extends universal)
 */
export declare function mergeNLPConfig(base: NLPConfig, extension: Partial<NLPConfig>): NLPConfig;
/**
 * Set the active NLP config (called by app layer)
 */
export declare function setNLPConfig(config: Partial<NLPConfig>): void;
/**
 * Get the active NLP config
 */
export declare function getNLPConfig(): NLPConfig;
/**
 * Reset to default config
 */
export declare function resetNLPConfig(): void;
