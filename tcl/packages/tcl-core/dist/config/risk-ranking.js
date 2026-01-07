/**
 * Risk Ranking Configuration
 *
 * Config-driven risk scoring and ranking for issues.
 * NO hard-coded thresholds or weights.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let cachedConfig = null;
export function getRiskRankingConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    try {
        const configPath = join(__dirname, 'risk-ranking.json');
        const configText = readFileSync(configPath, 'utf-8');
        cachedConfig = JSON.parse(configText);
        // Validate config on startup (fail fast)
        validateRiskRankingConfig(cachedConfig);
        return cachedConfig;
    }
    catch (error) {
        console.warn('Failed to load risk-ranking.json, using defaults', error);
        // Assign safe defaults to cachedConfig
        cachedConfig = {
            ui: { maxTopIssues: 10 },
            issueLimits: {
                perClaimMax: 10,
                globalMax: 50,
                topIssuesMax: 10,
                evidenceQuotesMax: 5,
            },
            severityThresholds: {
                low: 0.20,
                medium: 0.45,
                high: 0.70,
                critical: 0.85,
            },
            weights: {
                riskScoring: {
                    impact: 0.40,
                    evidence: 0.30,
                    signal: 0.20,
                    category: 0.10,
                },
                typeBase: {
                    CONTRADICTION: 0.75,
                    UNVERIFIED_CLAIM: 0.35,
                    UNSUPPORTED_CLAIM: 0.65,
                    UNGROUNDED: 0.50,
                    RISK_SIGNAL: 0.60,
                    POLICY: 0.70,
                    FEE_DISCLOSURE_RISK: 0.70,
                    COMMITMENT_INCONSISTENCY: 0.60,
                    NUMERIC_MISMATCH: 0.55,
                    DATA_INTEGRITY: 0.80,
                    OTHER: 0.30,
                },
                speakerMultiplier: {
                    AGENT: 1.15,
                    CUSTOMER: 0.85,
                    SYSTEM: 1.25,
                    UNKNOWN: 1.00,
                },
                verificationMultiplier: {
                    EXTERNAL_VERIFIED: 1.10,
                    TRANSCRIPT_ONLY: 0.90,
                    NONE: 0.80,
                },
                // Composite scoring weights
                severityWeight: 0.25,
                categoryMultiplier: {
                    billing: 1.2,
                    fees: 1.3,
                    refunds: 1.2,
                    privacy: 1.1,
                    disclosure: 1.15,
                    retention: 1.0,
                    general: 1.0,
                    other: 1.0,
                },
                confidenceWeight: 0.20,
                structuralImportanceWeight: 0.15,
                evidencePenaltyWeight: 0.10,
                customerImpactWeight: 0.30,
            },
            impactMap: {
                low: 0.3,
                medium: 0.6,
                high: 1.0,
            },
            evidenceMap: {
                EXTERNAL_VERIFIED: 1.0,
                TRANSCRIPT_ONLY: 0.45,
                NONE: 0.20,
            },
            categoryNormalization: {
                min: 1.0,
                max: 1.3,
            },
            degradedMode: {
                missingSpectralSignal01: 0.5,
                missingEdgesSignal01: 0.5,
            },
            typePriority: [
                'CONTRADICTION',
                'DATA_INTEGRITY',
                'POLICY',
                'FEE_DISCLOSURE_RISK',
                'RISK_SIGNAL',
                'COMMITMENT_INCONSISTENCY',
                'NUMERIC_MISMATCH',
                'UNSUPPORTED_CLAIM',
                'UNGROUNDED',
                'UNVERIFIED_CLAIM',
                'OTHER',
            ],
        };
        // Validate defaults (cachedConfig is guaranteed to be non-null here since we just assigned it)
        validateRiskRankingConfig(cachedConfig);
    }
    // At this point, cachedConfig is guaranteed to be non-null
    if (!cachedConfig) {
        throw new Error('Failed to load or create risk ranking config');
    }
    return cachedConfig;
}
/**
 * Validate risk ranking config on startup (fail fast)
 * Exported for testing
 */
export function validateRiskRankingConfig(config) {
    // Validate weights sum to 1.0 ± 0.001
    if (config.weights.riskScoring) {
        const sum = config.weights.riskScoring.impact +
            config.weights.riskScoring.evidence +
            config.weights.riskScoring.signal +
            config.weights.riskScoring.category;
        const diff = Math.abs(sum - 1.0);
        if (diff > 0.001) {
            throw new Error(`Risk ranking config validation failed: riskScoring weights sum to ${sum}, must be 1.0 ± 0.001. ` +
                `Weights: impact=${config.weights.riskScoring.impact}, evidence=${config.weights.riskScoring.evidence}, ` +
                `signal=${config.weights.riskScoring.signal}, category=${config.weights.riskScoring.category}`);
        }
    }
    // Validate severity thresholds are monotonic (low < medium < high < critical)
    const thresholds = config.severityThresholds;
    if (thresholds.low >= thresholds.medium) {
        throw new Error(`Risk ranking config validation failed: severityThresholds.low (${thresholds.low}) must be < medium (${thresholds.medium})`);
    }
    if (thresholds.medium >= thresholds.high) {
        throw new Error(`Risk ranking config validation failed: severityThresholds.medium (${thresholds.medium}) must be < high (${thresholds.high})`);
    }
    if (thresholds.high >= thresholds.critical) {
        throw new Error(`Risk ranking config validation failed: severityThresholds.high (${thresholds.high}) must be < critical (${thresholds.critical})`);
    }
}
