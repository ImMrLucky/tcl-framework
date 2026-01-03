/**
 * Configuration types for the deterministic truth graph engine.
 * All weights, thresholds, and rule parameters come from config - never hard-coded.
 */
export interface EdgeWeightConfig {
    contradictionBase: number;
    supportBase: number;
    groundingBase: number;
    structureBase: number;
    modalityAbsoluteMultiplier: number;
    modalityConditionalMultiplier: number;
    polarityConflictMultiplier: number;
    timeframeConflictMultiplier: number;
    agentSpeakerMultiplier: number;
    customerSpeakerMultiplier: number;
    paraphraseSupportMultiplier: number;
    agentConfirmMultiplier: number;
    qualificationEdgeMultiplier: number;
}
export interface PruningConfig {
    topKPerNodePerType: number;
    minWeightContradiction: number;
    minWeightSupport: number;
    minWeightGrounding: number;
    minWeightStructure: number;
    mergeBeforePrune: boolean;
}
export interface ModalityLexicon {
    absoluteWords: string[];
    conditionalWords: string[];
    denialWords: string[];
    affirmWords: string[];
    apologyWords: string[];
    questionPatterns: string[];
    requestPatterns: string[];
}
export interface SubjectSchema {
    id: string;
    keywords: string[];
    patterns: RegExp[];
    predicates: string[];
    polarityMapping: Record<string, 'affirm' | 'deny'>;
    relatedSubjects?: string[];
}
export interface EvidenceRetrievalConfig {
    enabled: boolean;
    maxChunksPerClaim: number;
    minKeywordOverlap: number;
    authorityWeights: Record<string, number>;
}
export interface RuleConfig {
    id: string;
    enabled: boolean;
    priority: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    maxTurnDistance?: number;
    topicOverlapMin?: number;
    mode?: 'qualification' | 'contradiction';
    windowTurns?: number;
    bucketOverlapMap?: Record<string, string[]>;
}
export interface NormalizationConfig {
    subjectSynonyms: Record<string, string[]>;
    predicateSynonyms: Record<string, string[]>;
    enumLexicon: Record<string, string[]>;
    antonyms: Array<[string, string]>;
    moneyTolerance: number;
    numericTolerance: number;
    numericConflictTolerance: number;
    timeframeBuckets: string[];
    timeframeOverlapMap: Record<string, string[]>;
    negationTokens: string[];
    modalityTokens: {
        absolute: string[];
        conditional: string[];
    };
}
export interface IssueScoringConfig {
    ruleSeverityWeights: Record<string, number>;
    agentBoost: number;
    recurrenceBoost: number;
    confidenceWeights: {
        high: number;
        medium: number;
        low: number;
    };
}
export interface AnalysisModeConfig {
    evidenceMode: 'transcript_only' | 'evidence_corpus';
}
export interface TruthEngineConfig {
    version: string;
    edgeWeights: EdgeWeightConfig;
    pruning: PruningConfig;
    modalityLexicon: ModalityLexicon;
    subjectSchemas: SubjectSchema[];
    evidenceRetrieval: EvidenceRetrievalConfig;
    rules: Record<string, RuleConfig>;
    normalization: NormalizationConfig;
    issueScoring: IssueScoringConfig;
    analysis: AnalysisModeConfig;
}
/**
 * Default configuration - loaded if no custom config provided.
 * Can be overridden by vertical-specific or org-specific configs.
 */
export declare const DEFAULT_CONFIG: TruthEngineConfig;
