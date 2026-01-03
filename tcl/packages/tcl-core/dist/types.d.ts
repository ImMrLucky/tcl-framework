import type { LLMAdapter } from "./adapters/llm_adapter";
export type Source = {
    id: string;
    text: string;
};
/** Claim kind determines how it participates in contradiction detection */
export type ClaimKind = "assertion" | "intent" | "question" | "meta" | "emotion" | "promise" | "unknown";
/** Grounding status - where the claim gets its support */
export type ClaimGrounding = {
    kind: "transcript" | "external" | "none";
    evidenceIds: string[];
    quoteSpans?: Array<{
        start: number;
        end: number;
    }>;
};
/** Verification status - for claims against external sources */
export type ClaimVerification = {
    status: "unverified" | "verified" | "disputed" | "not_applicable";
    evidenceIds: string[];
};
/** Consistency status - relationship to other claims */
export type ClaimConsistency = {
    status: "consistent" | "inconsistent" | "unknown";
    against: string[];
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
    claimKind?: ClaimKind;
    grounding?: ClaimGrounding;
    verification?: ClaimVerification;
    consistency?: ClaimConsistency;
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
    truthState?: "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
    whyFlagged?: {
        reasons: string[];
        evidence: Array<{
            source_id: string;
            quote?: string;
            span?: string;
        }>;
        conflictsWith: Array<{
            claimId: string;
            score: number;
        }>;
        missingEvidence: boolean;
    };
    suggestedRewrite?: string;
};
export type EvidenceQuote = {
    quoteId: string;
    claimId: string;
    speaker: "Agent" | "Customer" | "System";
    turnIndex: number;
    lineSpan?: [number, number];
    text: string;
    evidenceRef?: {
        type: "Call" | "Policy" | "KB";
        ref: string;
    };
};
export type ContradictionPair = {
    claimAId: string;
    claimBId: string;
    score: number;
    explanation: string;
    quoteIds: [string, string];
};
export type IssueNarrative = {
    issueId: string;
    category: string;
    subcategory?: string;
    title: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    confidence: "LOW" | "MEDIUM" | "HIGH";
    status: "OPEN" | "RESOLVED" | "DISMISSED";
    scope: {
        turnRange: [number, number];
        claimIds: string[];
        speakerFocus: "AGENT" | "SYSTEM" | "CUSTOMER";
    };
    whatIsWrong: string;
    whyWrong: string[];
    whyItMatters: string[];
    recommendedActions: Array<{
        type: "COACHING" | "PROCESS" | "COMPLIANCE" | "SYSTEM_FIX";
        action: string;
    }>;
    evidenceQuotes: EvidenceQuote[];
    contradictionPairs?: ContradictionPair[];
    traceability: {
        topEdges: Array<{
            type: "support" | "contradiction" | "grounding";
            fromClaimId: string;
            toClaimId: string;
            weight: number;
            reason?: string;
        }>;
    };
    scoring: {
        riskScore: number;
        impactScore: number;
        fixabilityScore: number;
        compositeScore: number;
        rationale: string[];
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
/** Support edge types */
export type SupportType = "entailed" | "paraphrase" | "reinforced" | "weak";
export type SupportEdge = {
    claimA: string;
    claimB: string;
    weight: number;
    supportType?: SupportType;
};
/** Contradiction edge types - critical for gating */
export type ContradictionType = "direct" | "topic_mismatch" | "low_overlap" | "needs_review";
export type ContradictionEdge = {
    claimA: string;
    claimB: string;
    weight: number;
    contradictionType?: ContradictionType;
    overlapScore?: number;
    reasonCodes?: string[];
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
/** Review item severity */
export type ReviewSeverity = "low" | "medium" | "high" | "critical";
/** Review item - the "money" output users actually need */
export type ReviewItem = {
    id: string;
    title: string;
    severity: ReviewSeverity;
    category: "contradiction" | "ungrounded" | "promise_unverified" | "policy" | "destructive";
    whyItMatters: string;
    involvedClaimIds: string[];
    claimTexts: string[];
    speakerLabels: string[];
    transcriptSpans?: Array<{
        start: number;
        end: number;
    }>;
    recommendedAction: string;
    actionTemplate?: string;
    drivers: {
        nodeBlameNorm?: number;
        contradictionWeight?: number;
        overlapScore?: number;
        destructiveImportance?: number;
        reasonCodes?: string[];
    };
};
/** Enhanced scores that reflect reality */
export type EnhancedScores = {
    groundednessScore: number | null;
    verificationScore: number | null;
    consistencyScore: number | null;
    coherenceScore: number | null;
    /** @deprecated Use groundednessScore instead */
    truth: number | null;
    consistency: number | null;
    coherence: number | null;
    overall: number | null;
};
/** Summary stats for UI display */
export type SummaryStats = {
    totalClaims: number;
    groundedClaims: number;
    verifiedClaims: number;
    directContradictions: number;
    needsReviewCount: number;
    hasExternalEvidence: boolean;
};
export type GraphDebugInfo = {
    numClaims: number;
    numSources: number;
    transcriptSourcesGenerated?: number;
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
/**
 * Run Manifest - AUDIT-CRITICAL
 *
 * Contains all configuration and metadata needed to reproduce an evaluation.
 * Required for enterprise adoption and compliance.
 */
export type RunManifest = {
    /** SHA-256 hash of input */
    inputHash: string;
    /** SHA-256 hash of config bundle (scoring + templates + taxonomy) */
    configHash: string;
    /** Artifact ID if provided */
    artifactId?: string;
    /** Claim extractor version */
    claimExtractorVersion: string;
    /** NLI model ID */
    nliModelId: string;
    /** NLI thresholds used */
    nliThresholds: {
        support: number;
        contradiction: number;
        grounding: number;
    };
    /** Embedding model for retrieval */
    embeddingModel: string;
    /** Retrieval k (top-k chunks per claim) */
    retrievalK: number;
    /** Spectral engine version */
    spectralEngineVersion?: string;
    /** Code version (git commit SHA) */
    codeVersion: string;
    /** Engine version */
    engineVersion: string;
    /** Model fingerprint (all model versions used) */
    modelFingerprint: {
        nliModel?: string;
        claimExtractor?: string;
        embeddingModel?: string;
        spectralEngine?: string;
        configHash?: string;
    };
    /** Timestamp */
    createdAt: string;
    /** Number of transcript sources generated */
    transcriptSourcesCount: number;
    /** Graph health check results */
    graphHealth: {
        supportEdges: number;
        contradictionEdges: number;
        groundingEdges: number;
        totalEdges: number;
        healthy: boolean;
        reason?: string;
    };
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
    enhancedScores?: EnhancedScores;
    summaryStats?: SummaryStats;
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
            graphHealthDiagnostic?: any;
        };
        graph?: {
            supports: SupportEdge[];
            contradictions: ContradictionEdge[];
            grounding: GroundingEdge[];
            debug?: GraphDebugInfo;
        };
        reviewItems?: ReviewItem[];
        suggestions?: Suggestion[];
        destructiveClaims?: DestructiveClaim[];
        trajectory?: TrajectoryReport;
        manifest?: RunManifest;
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
