/**
 * Risk Ranking Configuration
 *
 * Config-driven risk scoring and ranking for issues.
 * NO hard-coded thresholds or weights.
 */
export interface RiskRankingConfig {
    ui: {
        maxTopIssues: number;
    };
    issueLimits?: {
        perClaimMax: number;
        globalMax: number;
        topIssuesMax: number;
        evidenceQuotesMax: number;
    };
    severityThresholds: {
        low: number;
        medium: number;
        high: number;
        critical: number;
    };
    weights: {
        riskScoring: {
            impact: number;
            evidence: number;
            signal: number;
            category: number;
        };
        typeBase: Record<string, number>;
        speakerMultiplier: Record<string, number>;
        verificationMultiplier: Record<string, number>;
        severityWeight?: number;
        categoryMultiplier?: Record<string, number>;
        confidenceWeight?: number;
        structuralImportanceWeight?: number;
        evidencePenaltyWeight?: number;
        customerImpactWeight?: number;
    };
    impactMap: {
        low: number;
        medium: number;
        high: number;
    };
    evidenceMap: {
        EXTERNAL_VERIFIED: number;
        TRANSCRIPT_ONLY: number;
        NONE: number;
    };
    categoryNormalization: {
        min: number;
        max: number;
    };
    degradedMode: {
        missingSpectralSignal01: number;
        missingEdgesSignal01: number;
    };
    typePriority: string[];
}
export declare function getRiskRankingConfig(): RiskRankingConfig;
/**
 * Validate risk ranking config on startup (fail fast)
 * Exported for testing
 */
export declare function validateRiskRankingConfig(config: RiskRankingConfig): void;
