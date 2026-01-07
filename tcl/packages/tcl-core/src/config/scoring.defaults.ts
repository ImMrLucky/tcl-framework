/**
 * Scoring Defaults Configuration
 * 
 * Production-grade scoring math (deterministic + calibrated).
 * All weights and thresholds are configurable and validated on startup.
 */

export interface ScoringDefaults {
  // Severity weights for risk score computation
  severityWeights: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };

  // Risk score multipliers
  riskScoreMultipliers: {
    spectralEnergy: number;  // k1: 0.1-0.3
    centrality: number;      // k2: 0.1-0.3
  };

  // Rank score weights (for triage/manager utility)
  rankScoreWeights: {
    riskScore: number;           // 0.55
    contradictionStrength: number; // 0.25
    spectralEnergy: number;      // 0.20
  };

  // Confidence thresholds
  confidenceThresholds: {
    high: number;   // >= 0.7
    medium: number; // >= 0.4
    low: number;     // < 0.4
  };

  // Impact severity rules (category/type-driven)
  impactRules: {
    // Compliance flags that trigger critical impact
    criticalComplianceFlags: string[];
    // Categories/types that trigger high impact
    highImpactCategories: string[];
    highImpactTypes: string[];
    // Categories/types that trigger medium impact
    mediumImpactCategories: string[];
    mediumImpactTypes: string[];
  };
}

/**
 * Default scoring configuration
 */
export const DEFAULT_SCORING: ScoringDefaults = {
  severityWeights: {
    low: 0.25,
    medium: 0.5,
    high: 0.75,
    critical: 1.0,
  },
  riskScoreMultipliers: {
    spectralEnergy: 0.2,  // k1
    centrality: 0.15,     // k2
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
export function getScoringDefaults(): ScoringDefaults {
  // TODO: Load from config file if exists, otherwise use defaults
  return DEFAULT_SCORING;
}

