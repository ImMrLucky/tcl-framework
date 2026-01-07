/**
 * EngineConfig - Single Source of Truth for All Thresholds and Policies
 *
 * This replaces all hard-coded values throughout the codebase.
 * All thresholds, weights, and policies must come from this config.
 */
import { getScoringConfig } from './scoring.js';
/**
 * Default EngineConfig
 */
export const DEFAULT_ENGINE_CONFIG = {
    ...getScoringConfig(),
    mode: 'transcript_only',
    severityPolicy: {
        transcriptOnlyUnverified: 'LOW',
        transcriptOnlyEscalation: {
            regulatedCategory: 'MEDIUM',
            financialImpactPromise: 'HIGH',
            realContradiction: 'MEDIUM',
        },
        externalDocUnverified: 'MEDIUM',
        missingRequiredPolicy: 'HIGH',
    },
    thresholds: {
        ...getScoringConfig().thresholds,
        contradictedThreshold: undefined, // Use contradictionThreshold
        topicOverlapThreshold: 0.25,
        polarityOppositionThreshold: 0.3,
    },
};
/**
 * Get engine config, allowing environment overrides
 */
export function getEngineConfig(overrides) {
    const base = { ...DEFAULT_ENGINE_CONFIG };
    // Allow mode override
    if (process.env.TCL_ANALYSIS_MODE) {
        base.mode = process.env.TCL_ANALYSIS_MODE;
    }
    // Merge any provided overrides
    if (overrides) {
        return {
            ...base,
            ...overrides,
            thresholds: { ...base.thresholds, ...overrides.thresholds },
            severityPolicy: { ...base.severityPolicy, ...overrides.severityPolicy },
        };
    }
    return base;
}
