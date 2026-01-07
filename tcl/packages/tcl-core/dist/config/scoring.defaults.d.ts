/**
 * Scoring Defaults Configuration
 *
 * Production-grade scoring math (deterministic + calibrated).
 * All weights and thresholds are configurable and validated on startup.
 */
export interface ScoringDefaults {
    severityWeights: {
        low: number;
        medium: number;
        high: number;
        critical: number;
    };
    riskScoreMultipliers: {
        spectralEnergy: number;
        centrality: number;
    };
    rankScoreWeights: {
        riskScore: number;
        contradictionStrength: number;
        spectralEnergy: number;
    };
    confidenceThresholds: {
        high: number;
        medium: number;
        low: number;
    };
    impactRules: {
        criticalComplianceFlags: string[];
        highImpactCategories: string[];
        highImpactTypes: string[];
        mediumImpactCategories: string[];
        mediumImpactTypes: string[];
    };
}
/**
 * Default scoring configuration
 */
export declare const DEFAULT_SCORING: ScoringDefaults;
/**
 * Get scoring defaults (can be overridden by config file)
 */
export declare function getScoringDefaults(): ScoringDefaults;
