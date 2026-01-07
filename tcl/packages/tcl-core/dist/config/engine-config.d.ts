/**
 * EngineConfig - Single Source of Truth for All Thresholds and Policies
 *
 * This replaces all hard-coded values throughout the codebase.
 * All thresholds, weights, and policies must come from this config.
 */
import { ScoringConfig } from './scoring.js';
export type AnalysisMode = 'transcript_only' | 'with_external_docs';
export interface SeverityPolicy {
    /**
     * Default severity for unverified claims in transcript-only mode
     */
    transcriptOnlyUnverified: 'LOW' | 'MEDIUM' | 'HIGH';
    /**
     * Escalation rules for transcript-only mode
     */
    transcriptOnlyEscalation: {
        /**
         * Escalate to MEDIUM if category is regulated
         */
        regulatedCategory: 'MEDIUM' | 'HIGH';
        /**
         * Escalate to HIGH if financial impact + promise/commitment
         */
        financialImpactPromise: 'HIGH' | 'CRITICAL';
        /**
         * Escalate if real contradiction survives gating
         */
        realContradiction: 'MEDIUM' | 'HIGH';
    };
    /**
     * Default severity for unverified claims in external-doc mode
     */
    externalDocUnverified: 'MEDIUM' | 'HIGH';
    /**
     * When policy is required and missing
     */
    missingRequiredPolicy: 'MEDIUM' | 'HIGH';
}
export interface EngineConfig extends ScoringConfig {
    /**
     * Analysis mode determines how grounding/verification is interpreted
     */
    mode: AnalysisMode;
    /**
     * Risk multipliers by category (optional overrides)
     */
    riskMultipliers?: Record<string, number>;
    /**
     * Severity policy for different modes
     */
    severityPolicy: SeverityPolicy;
    /**
     * Additional threshold for contradicted claims (if separate from contradictionThreshold)
     */
    thresholds: ScoringConfig['thresholds'] & {
        /**
         * Minimum weight for a contradiction to count as "contradicted" in finalTruthState
         * If not set, uses contradictionThreshold
         */
        contradictedThreshold?: number;
        /**
         * Minimum topic overlap for contradiction eligibility (0-1)
         */
        topicOverlapThreshold: number;
        /**
         * Minimum polarity/opposition signal for contradiction (0-1)
         */
        polarityOppositionThreshold: number;
    };
}
/**
 * Default EngineConfig
 */
export declare const DEFAULT_ENGINE_CONFIG: EngineConfig;
/**
 * Get engine config, allowing environment overrides
 */
export declare function getEngineConfig(overrides?: Partial<EngineConfig>): EngineConfig;
