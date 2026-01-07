/**
 * Scoring Defaults Configuration
 *
 * Production-grade scoring math (deterministic + calibrated).
 * All weights and thresholds are configurable and validated on startup.
 */
/**
 * Default scoring configuration
 */
export const DEFAULT_SCORING = {
    severityWeights: {
        low: 0.25,
        medium: 0.5,
        high: 0.75,
        critical: 1.0,
    },
    riskScoreMultipliers: {
        spectralEnergy: 0.2, // k1
        centrality: 0.15, // k2
    },
    rankScoreWeights: {
        riskScore: 0.55,
        contradictionStrength: 0.25,
        spectralEnergy: 0.20,
    },
    confidenceThresholds: {
        high: 0.7,
        medium: 0.4,
        low: 0.0,
    },
    impactRules: {
        criticalComplianceFlags: [
            'PCI_CVV_STORAGE',
            'RECORDING_MISREPRESENTATION',
            'DATA_BREACH',
            'FRAUD',
        ],
        highImpactCategories: [
            'billing',
            'compliance',
            'cancellation',
            'refund',
        ],
        highImpactTypes: [
            'CONTRADICTION',
            'RISK_SIGNAL',
            'FEE_DISCLOSURE_RISK',
        ],
        mediumImpactCategories: [
            'evidence',
            'disclosure',
        ],
        mediumImpactTypes: [
            'UNSUPPORTED_CLAIM',
            'UNVERIFIED_CLAIM',
        ],
    },
};
/**
 * Get scoring defaults (can be overridden by config file)
 */
export function getScoringDefaults() {
    // TODO: Load from config file if exists, otherwise use defaults
    return DEFAULT_SCORING;
}
