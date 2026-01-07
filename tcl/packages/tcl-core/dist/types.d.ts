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
    evidenceRefs?: Array<{
        sourceId: string;
        quote?: string;
        turnIndex?: number;
        weight?: number;
    }>;
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
    truthState?: "SUPPORTED" | "CONTRADICTED" | "UNVERIFIED" | "UNGROUNDED" | "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
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
/** Support basis for a claim - where is it supported from? */
export type SupportBasis = 'TRANSCRIPT' | 'EXTERNAL' | 'NONE';
/** Verification level based on available evidence */
export type VerificationLevel = 'TRANSCRIPT_ONLY' | 'EXTERNALLY_VERIFIED';
/** Evidence mode for the evaluation run */
export type EvidenceMode = 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL';
export type IssueNarrative = {
    issueId: string;
    category: string;
    subcategory?: string;
    title: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    confidence: "LOW" | "MEDIUM" | "HIGH";
    status: "OPEN" | "RESOLVED" | "DISMISSED";
    /** Support basis for claims in this issue */
    supportBasis: SupportBasis;
    /** Verification level based on available evidence */
    verificationLevel: VerificationLevel;
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
export type IssueTypeV2 = "CONTRADICTION" | "UNVERIFIED_CLAIM" | "UNSUPPORTED_CLAIM" | "UNGROUNDED" | "RISK_SIGNAL" | "POLICY" | "NUMERIC_MISMATCH" | "COMMITMENT_INCONSISTENCY" | "FEE_DISCLOSURE_RISK" | "DATA_INTEGRITY" | "OTHER";
export type IssueCategoryV2 = "evidence" | "consistency" | "compliance" | "billing" | "disclosure" | "data_integrity" | "other";
export type SeverityV2 = "low" | "medium" | "high" | "critical";
export type ImpactV2 = "low" | "medium" | "high";
export type SeverityDisplayV2 = "low" | "medium" | "high";
export type SpeakerV2 = "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
export type VerificationLevelV2 = "EXTERNAL_VERIFIED" | "TRANSCRIPT_ONLY" | "NONE";
export type RecommendedActionType = "NEEDS_EXTERNAL_EVIDENCE" | "QA_REVIEW" | "COACH_AGENT" | "LEGAL_ESCALATION" | "BILLING_FOLLOWUP";
export interface IssueV2 {
    issueId: string;
    issueKey: string;
    runId: string;
    conversationId: string;
    type: IssueTypeV2;
    category: IssueCategoryV2;
    severity: SeverityV2;
    severityDisplay: SeverityDisplayV2;
    impact: ImpactV2;
    riskScore: number;
    score: number;
    confidence: number;
    reviewRequired: boolean;
    verification: {
        level: VerificationLevelV2;
        reasonCodes: string[];
    };
    scoreBreakdown?: {
        impactScore: number;
        verificationScore: number;
        disputeScore: number;
        contradictionScore: number;
        commitmentScore: number;
        escalationScore: number;
        templateScore: number;
        penalties: {
            transcriptOnlyCapPenalty?: number;
            [key: string]: number | undefined;
        };
    };
    scoring?: {
        components: {
            impact01: number;
            evidence01: number;
            signal01: number;
            category01: number;
        };
        weights: {
            impact: number;
            evidence: number;
            signal: number;
            category: number;
        };
        reasons: string[];
    };
    severityReason?: string[];
    capsApplied?: string[];
    recommendedAction?: {
        actionType: RecommendedActionType;
        explanation: string;
        requiredEvidence?: string[];
    };
    who: {
        speaker: SpeakerV2;
        turnIndex?: number;
    };
    what: {
        primaryClaimId: string;
        relatedClaimIds?: string[];
        claimText?: string;
        issueSummary: string;
        issueDetail: string;
    };
    evidence: {
        refs: Array<{
            sourceType: "TRANSCRIPT" | "POLICY" | "DOC" | "SYSTEM_FACT";
            sourceId: string;
            quote: string;
            weight?: number;
            turnIndex?: number;
        }>;
        edges?: Array<{
            kind: "grounding" | "support" | "contradiction";
            claimA: string;
            claimB?: string;
            weight: number;
        }>;
    };
    compliance: {
        tags: string[];
        impactedPolicies?: Array<{
            policyId: string;
            section?: string;
        }>;
        legalHoldSuggested?: boolean;
        disclaimers: string[];
    };
    audit: {
        createdAt: string;
        engineVersion: string;
        scorerId: string;
        modelFingerprint?: any;
        configHash?: string;
        inputHash?: string;
    };
}
export interface IssueSummaryV2 {
    totalIssues: number;
    byType: Record<IssueTypeV2, number>;
    bySeverity: Record<SeverityV2, number>;
    byCategory: Record<IssueCategoryV2, number>;
    topIssuesCount: number;
    allIssuesCount: number;
}
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
    /**
     * Graph builder mode:
     * - "unified" (DEFAULT): 3-stage pipeline with Subject Slots
     *   - Prevents nonsense contradictions via slot matching
     *   - Config-driven thresholds and gating
     *   - Best edge quality for spectral.py
     * - "legacy": NLI-based edge scoring (slower, ML model calls)
     * - "truth-engine": Deterministic rule-based (no ML, reproducible)
     */
    graphBuilder?: 'unified' | 'legacy' | 'truth-engine';
    /**
     * Template ID for unified graph builder.
     * Options: "generic" | "telco" | "loans" | "ai_chat"
     * Auto-detected from transcript content if not specified.
     */
    template?: string;
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
    transcriptEvidenceNodes?: number;
    annEnabled: boolean;
    cacheEnabled: boolean;
    spectralEnabled: boolean;
    spectralDegraded?: boolean;
    spectralDegradedReason?: string;
    neighborK?: number;
    graphBuilderMode?: 'unified' | 'legacy' | 'truth-engine';
    graphStatus?: 'OK' | 'DEGRADED' | 'FAILED';
    graphReasons?: string[];
    supportThreshold: number;
    contradictionThreshold: number;
    groundingThreshold: number;
    pairsGenerated: number;
    pairsScored: number;
    edgesCreated?: number;
    claimsWithZeroCandidates?: number;
    edges: {
        supportsAdded: number;
        contradictionsAdded: number;
        groundingAdded: number;
    };
    filtered?: {
        belowSupportThreshold: number;
        belowContradictionThreshold: number;
        belowGroundingThreshold: number;
        droppedByMaxEdges: number;
    };
    /** NEW: Detailed breakdown of WHY pairs were rejected (unified graph builder) */
    rejectionBreakdown?: {
        bySlotGating: number;
        byTopicGating: number;
        byPolarityGating: number;
        byThreshold: number;
    };
    /** NEW: Sample rejected pairs for debugging */
    sampleRejections?: Array<{
        claimA: string;
        claimB: string;
        reason: string;
        slotA: string;
        slotB: string;
        textA: string;
        textB: string;
    }>;
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
    /** Schema version for backward compatibility */
    schemaVersion?: string;
    /** SHA-256 hash of input */
    inputHash?: string;
    /** SHA-256 hash of config bundle (scoring + templates + taxonomy) */
    configHash?: string;
    /** Artifact ID if provided */
    artifactId?: string;
    /** Claim extractor version */
    claimExtractorVersion?: string;
    /** NLI model ID (legacy, use graphBuilderMode for unified) */
    nliModelId?: string;
    /** NLI thresholds used (legacy) */
    nliThresholds?: {
        support: number;
        contradiction: number;
        grounding: number;
    };
    /** Embedding model for retrieval */
    embeddingModel?: string;
    /** Retrieval k (top-k chunks per claim) */
    retrievalK?: number;
    /** Spectral engine version */
    spectralEngineVersion?: string;
    /** Code version (git commit SHA) */
    codeVersion?: string;
    /** Engine version */
    engineVersion?: string;
    /** Graph builder mode: unified (default) | legacy | truth-engine */
    graphBuilderMode?: 'unified' | 'legacy' | 'truth-engine';
    /** Template ID used for unified graph builder */
    templateId?: string;
    /** Timestamp */
    timestamp?: string;
    /** Legacy: createdAt */
    createdAt?: string;
    /** Evidence mode: TRANSCRIPT_ONLY or TRANSCRIPT_PLUS_EXTERNAL */
    evidenceMode?: EvidenceMode;
    /** Model fingerprint (all model versions used) */
    modelFingerprint?: {
        nliModel?: string;
        claimExtractor?: string;
        embeddingModel?: string;
        spectralEngine?: string;
        configHash?: string;
    };
    /** Number of transcript sources generated (legacy) */
    transcriptSourcesCount?: number;
    /** Graph health check results (legacy) */
    graphHealth?: {
        supportEdges: number;
        contradictionEdges: number;
        groundingEdges: number;
        totalEdges: number;
        healthy: boolean;
        reason?: string;
    };
    /** NEW: Unified graph builder diagnostics */
    diagnostics?: {
        status: 'OK' | 'DEGRADED' | 'FAILED';
        reasons: string[];
        transcriptEvidenceNodes: number;
        supportsAdded: number;
        groundingAdded: number;
        /** Count of grounded claims (for consistency check) */
        groundedClaimCount?: number;
        contradictionsAdded: number;
        spectralDegraded?: boolean;
        spectralDegradedReason?: string | null;
        /** Notes for transcript-only mode */
        notes?: string[];
    };
    /** NEW: Truth derivation summary from graph */
    truthDerivationSummary?: {
        supported: number;
        contradicted: number;
        unverified: number;
        ungrounded: number;
        total: number;
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
            /** Grounded claim IDs (for consistency check) */
            grounded?: string[];
            /** Alias for grounded (for spectral input) */
            groundedClaimIds?: string[];
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
