import type { LLMAdapter } from "./adapters/llm_adapter";
export type Source = {
    id: string;
    text: string;
};
export type Claim = {
    id: string;
    text: string;
    confidence: number;
    evidence: {
        source_id: string;
        quote?: string;
        span?: string;
        weight?: number;
    }[];
    confidenceMetrics?: {
        groundingScore: number;
        supportScore: number;
        contradictionScore: number;
        overall: number;
        risk?: number;
    };
    meta?: {
        speaker?: string;
        turnIndex?: number;
    };
};
export type Violation = {
    type: "MISSING_EVIDENCE";
    claimId: string;
    detail: string;
} | {
    type: "CONTRADICTION";
    claimA: string;
    claimB: string;
    detail: string;
} | {
    type: "LOW_CONFIDENCE";
    claimId: string;
    detail: string;
} | {
    type: "CUSTOM_RULE";
    claimId?: string;
    ruleId: string;
    detail: string;
};
export type CustomRule = {
    id: string;
    name: string;
    description: string;
    pattern?: {
        type: 'contains' | 'regex' | 'semantic';
        value: string;
        caseSensitive?: boolean;
        mode?: 'must_contain' | 'must_not_contain';
    };
    semantic?: {
        type: 'must_contain' | 'must_not_contain' | 'must_support' | 'must_not_contradict';
        reference: string;
    };
    scope: 'claim' | 'document';
    severity: 'error' | 'warning' | 'info';
    suggestion?: string;
};
export type SpectralReport = {
    coherenceScore: number;
    contradictionEnergy: number;
    supportEnergy: number;
    circularityScore: number;
    spectralGap: number;
    cycleMass?: number;
    heatTrace?: number[];
    truthVector?: number[];
    truthStates?: string[];
    topBadContradictions?: EdgeAttributionExpanded[];
    topBadSupports?: EdgeAttributionExpanded[];
    nodeBlame?: number[];
    nodeBlameNorm?: number[];
    fingerprint?: any;
};
export type DestructiveReason = "node_blame" | "contradiction_pressure" | "low_confidence" | "policy_violation" | "ungrounded" | "contradicted";
export type DestructiveClaim = {
    claimId: string;
    text: string;
    importance: number;
    truthState?: "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
    truthValue?: number;
    nodeBlameNorm?: number;
    contradictionIncident?: number;
    confidenceOverall?: number;
    groundingScore?: number;
    policySeverity?: "none" | "warning" | "error";
    policyRuleIds?: string[];
    reasons: Array<{
        kind: DestructiveReason;
        weight: number;
        detail?: string;
    }>;
};
export type EdgeAttributionExpanded = {
    claimAIndex: number;
    claimBIndex: number;
    weight: number;
    badness: number;
    claimAId?: string;
    claimBId?: string;
};
export type TrajectorySegment = {
    segmentIndex: number;
    startTurn: number;
    endTurn: number;
    textPreview: string;
    scores: {
        truth: number | null;
        consistency: number | null;
        coherence: number | null;
        overall: number | null;
    };
    spectral?: {
        coherenceScore: number;
        contradictionEnergy: number;
        supportEnergy: number;
        circularityScore: number;
        spectralGap: number;
        cycleMass: number;
        heatTrace: number[];
        fingerprint?: any;
    };
    destructiveClaimsTop?: DestructiveClaim[];
};
export type TrajectoryReport = {
    enabled: boolean;
    segments: TrajectorySegment[];
    summary: {
        worstSegmentIndex: number | null;
        worstOverallScore: number | null;
        instability: number;
        peakRiskImportanceSum: number;
    };
};
export type ValidationOptions = {
    spectral?: boolean;
    repair?: boolean;
    thresholds?: {
        truth?: number;
        consistency?: number;
        overall?: number;
    };
    spectralServiceUrl?: string;
    llmAdapter?: LLMAdapter;
    requireCitations?: boolean;
    nliEndpoint?: string;
    nliApiKey?: string;
    nliModelId?: string;
    mistralApiKey?: string;
    mistralModel?: string;
    useLocalNli?: boolean;
    supportThreshold?: number;
    contradictionThreshold?: number;
    groundingThreshold?: number;
    maxPairwiseEdges?: number;
    neighborK?: number;
    batchSize?: number;
    cache?: boolean;
    cachePersistPath?: string;
    annIndex?: 'hnsw' | 'bruteforce';
    annNeighborK?: number;
    customRules?: CustomRule[];
    includeSuggestions?: boolean;
    includeConfidenceMetrics?: boolean;
    spectralMode?: "score" | "analyze";
    trajectory?: boolean;
    trajectoryWindowTurns?: number;
    maxTrajectorySegments?: number;
};
export type ValidateInput = {
    question: string;
    answer: string;
    sources?: Source[];
    options?: ValidationOptions;
};
export type SupportEdge = {
    claimA: string;
    claimB: string;
    weight: number;
};
export type ContradictionEdge = {
    claimA: string;
    claimB: string;
    weight: number;
};
export type GroundingEdge = {
    claimId: string;
    sourceId: string;
    weight: number;
    quote?: string;
};
export type Suggestion = {
    type: 'fix_contradiction' | 'add_evidence' | 'improve_consistency' | 'resolve_circular' | 'custom_rule';
    claimId?: string;
    claimIds?: string[];
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    suggestedAction: string;
    example?: string;
};
export type GraphDebugInfo = {
    numClaims: number;
    numSources: number;
    annEnabled: boolean;
    cacheEnabled: boolean;
    spectralEnabled: boolean;
    neighborK: number;
    supportThreshold: number;
    contradictionThreshold: number;
    groundingThreshold: number;
    pairsGenerated: number;
    pairsScored: number;
    edges: {
        supportsAdded: number;
        contradictionsAdded: number;
        groundingAdded: number;
    };
    filtered: {
        belowSupportThreshold: number;
        belowContradictionThreshold: number;
        belowGroundingThreshold: number;
        droppedByMaxEdges: number;
    };
    model: {
        scorerId: string;
        labelMap?: Record<string, string>;
    };
    reasonIfEmptyGraph: string | null;
};
export type ValidateOutput = {
    answer: string;
    refusal: boolean;
    scores: {
        truth: number | null;
        consistency: number | null;
        coherence: number | null;
        overall: number | null;
    };
    scorerId?: string;
    latency?: number;
    cacheHitRate?: number;
    engineVersion?: string;
    report: {
        claims: Claim[];
        violations: Violation[];
        missingEvidence: {
            claimId: string;
            reason: string;
        }[];
        contradictions: {
            claimA: string;
            claimB: string;
            reason: string;
        }[];
        spectral?: SpectralReport & {
            spectralSkipped?: boolean;
            debugReason?: string;
        };
        graph?: {
            supports: SupportEdge[];
            contradictions: ContradictionEdge[];
            grounding: GroundingEdge[];
            debug?: GraphDebugInfo;
        };
        suggestions?: Suggestion[];
        destructiveClaims?: DestructiveClaim[];
        trajectory?: TrajectoryReport;
    };
};
export type BatchValidateInput = {
    items: ValidateInput[];
    options?: ValidationOptions;
};
export type BatchValidateOutput = {
    results: ValidateOutput[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        averageScore: number;
        averageLatency: number;
    };
};
