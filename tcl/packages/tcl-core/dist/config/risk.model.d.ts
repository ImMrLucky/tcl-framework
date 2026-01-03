/**
 * Risk Model Configuration
 *
 * ALL thresholds, weights, escalation rules, and category mappings live here.
 * NO values should be hard-coded in the scoring/clustering code.
 *
 * This file is versioned and its hash is included in reproducibility metadata.
 */
import type { IssueCategory, IssueSeverity } from "../issues/types.js";
export interface CategoryWeights {
    /** Base weight for each category (multiplies into risk score) */
    [key: string]: number;
}
export interface SeverityThresholds {
    /** Risk score >= this = CRITICAL */
    critical: number;
    /** Risk score >= this = HIGH */
    high: number;
    /** Risk score >= this = MEDIUM */
    medium: number;
}
export interface ConfidenceThresholds {
    /** Confidence score >= this = HIGH */
    high: number;
    /** Confidence score >= this = MEDIUM */
    medium: number;
}
export interface SignalMultipliers {
    /** Multiplier when sensitive data is detected */
    sensitiveData: number;
    /** Multiplier when financial impact is detected */
    financialImpact: number;
    /** Multiplier when policy conflict is detected */
    policyConflict: number;
    /** Multiplier when regulatory risk is detected */
    regulatoryRisk: number;
    /** Multiplier for explicit commitment language */
    explicitCommitment: number;
    /** Multiplier for agent statements (vs customer) */
    agentStatement: number;
    /** Multiplier for recency (more recent = higher risk) */
    recency: number;
}
export interface EscalationRule {
    id: string;
    description: string;
    conditions: {
        sensitiveData?: boolean;
        financialImpact?: boolean;
        policyConflict?: boolean;
        regulatoryRisk?: boolean;
        ungrounded?: boolean;
        contradictionMassMin?: number;
    };
    /** Minimum severity to escalate to */
    minSeverity: IssueSeverity;
}
export interface ClusteringConfig {
    /** Cosine similarity threshold for initial clustering */
    similarityThreshold: number;
    /** Edge density threshold for merging clusters */
    edgeDensityMergeThreshold: number;
    /** Max evidence snippets per issue */
    maxEvidenceSnippets: number;
    /** Max issues to return */
    maxIssues: number;
    /** Minimum claims to form an issue */
    minClaimsPerIssue: number;
}
export interface RedFlagPattern {
    id: string;
    category: IssueCategory;
    patterns: string[];
    severity: IssueSeverity;
    description: string;
}
export interface TopicKeywords {
    [category: string]: string[];
}
export interface RiskModelConfig {
    version: string;
    categoryWeights: CategoryWeights;
    severityThresholds: SeverityThresholds;
    confidenceThresholds: ConfidenceThresholds;
    signalMultipliers: SignalMultipliers;
    escalationRules: EscalationRule[];
    clustering: ClusteringConfig;
    redFlagPatterns: RedFlagPattern[];
    topicKeywords: TopicKeywords;
}
export declare const DEFAULT_RISK_MODEL: RiskModelConfig;
/**
 * Get the risk model config with optional environment overrides.
 */
export declare function getRiskModelConfig(): RiskModelConfig;
/**
 * Get hash of the config for reproducibility.
 */
export declare function getConfigHash(config?: RiskModelConfig): string;
/**
 * Merge custom config with defaults.
 */
export declare function mergeRiskModelConfig(custom: Partial<RiskModelConfig>): RiskModelConfig;
