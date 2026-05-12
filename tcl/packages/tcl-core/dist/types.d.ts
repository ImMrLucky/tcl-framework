import type { LLMAdapter } from "./adapters/llm_adapter";
import type { CanonicalCategory, EvidenceCitation } from "./types/evidence.types";
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
        speakerType?: "agent" | "customer" | "supervisor" | "bot" | "system" | "unknown";
        speakerLabel?: string;
        rawSpeaker?: string;
        turnIndex?: number;
        participantId?: string;
        /** Speech-act type from claim extractor (ASSERTION, PROMISE, …) */
        claimType?: string;
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
/** Verification level based on available evidence - for EvalMode */
export type VerificationLevel = "UNVERIFIED" | "TRANSCRIPT_ONLY" | "TRANSCRIPT_PROVABLE" | "DOC_BACKED" | "SYSTEM_VERIFIED" | "EXTERNALLY_VERIFIED";
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
export type IssueTypeV2 = "CONTRADICTION" | "UNVERIFIED_CLAIM" | "UNSUPPORTED_CLAIM" | "UNGROUNDED" | "RISK_SIGNAL" | "POLICY" | "NUMERIC_MISMATCH" | "COMMITMENT_INCONSISTENCY" | "FEE_DISCLOSURE_RISK" | "DATA_INTEGRITY" | "GUARANTEED_APPROVAL" | "APPROVAL_BEFORE_APPLICATION" | "GUARANTEED_PAYOUT" | "DAY_ONE_FULL_BENEFIT" | "HEALTH_UNDERWRITING_MISREPRESENTATION" | "CARRIER_OVERGENERALIZATION" | "BEST_RATE_CLAIM" | "NO_EXAM_ABSOLUTE" | "PRIVACY_ABSOLUTE" | "LICENSE_CLAIM_UNVERIFIED" | "HALLUCINATED_AUTHORITY" | "UNSUPPORTED_PRODUCT_CLAIM" | "MISSING_REQUIRED_DISCLOSURE" | "COMMITMENT_ESCALATION_DRIFT" | "DISCLOSURE_OMISSION_DRIFT" | "SPEAKER_ATTRIBUTION_FAILURE" | "CONTAMINATED_CLAIM"
/** AI / automation conversation risk */
 | "AI_HALLUCINATION" | "AI_UNSUPPORTED_CLAIM" | "AI_POLICY_DRIFT" | "AI_KNOWLEDGE_DRIFT" | "AI_INSTRUCTION_DRIFT" | "AI_TOOL_USE_DRIFT" | "AI_CONTRADICTORY_ANSWER" | "AI_OVERCONFIDENT_ANSWER" | "AI_MISSING_CITATION" | "AI_SOURCE_MISMATCH" | "AI_UNSAFE_RECOMMENDATION" | "AI_PRIVACY_OVERCLAIM" | "AI_ACTION_WITHOUT_PERMISSION"
/** Human speaker compliance surface (maps from domain rules + detectors) */
 | "HUMAN_MISLEADING_CLAIM" | "HUMAN_UNSUPPORTED_CLAIM" | "HUMAN_COMPLIANCE_RISK" | "HUMAN_MISSING_DISCLOSURE" | "HUMAN_GUARANTEE_LANGUAGE" | "HUMAN_PRIVACY_OVERCLAIM" | "HUMAN_PRICING_OVERCLAIM" | "HUMAN_PRODUCT_OVERCLAIM" | "HUMAN_LICENSE_OVERCLAIM" | "HUMAN_POLICY_DRIFT" | "HUMAN_CONTRADICTION"
/** ProtectQA final expense — client-visible labels */
 | "PROTECTQA_GUARANTEED_APPROVAL" | "PROTECTQA_APPROVAL_BEFORE_APPLICATION" | "PROTECTQA_NO_RISK_OF_DENIAL" | "PROTECTQA_CARRIER_OVERGENERALIZATION" | "PROTECTQA_HEALTH_DOES_NOT_MATTER" | "PROTECTQA_BEST_RATE_OVERCLAIM" | "PROTECTQA_DAY_ONE_FULL_BENEFIT_OVERCLAIM" | "PROTECTQA_GUARANTEED_PAYOUT" | "PROTECTQA_NO_EXAM_ABSOLUTE" | "PROTECTQA_PREMIUM_NEVER_INCREASES_ABSOLUTE" | "PROTECTQA_CANCELLATION_OVERCLAIM" | "PROTECTQA_PRIVACY_ABSOLUTE" | "PROTECTQA_LICENSE_UNVERIFIED" | "PROTECTQA_MISSING_CARRIER_APPROVAL_DISCLOSURE" | "PROTECTQA_MISSING_WAITING_PERIOD_DISCLOSURE" | "PROTECTQA_MISSING_POLICY_TERMS_DISCLOSURE" | "PROTECTQA_UNSUPPORTED_QUALIFICATION_RECOMMENDATION" | "PROTECTQA_AI_QUALIFICATION_DRIFT" | "PROTECTQA_AI_UNSUPPORTED_CARRIER_CLAIM" | "PROTECTQA_AI_UNSUPPORTED_HEALTH_ELIGIBILITY_CLAIM" | "PROTECTQA_AI_FINAL_APPROVAL_OVERCLAIM" | "PROTECTQA_AI_CARRIER_RULE_HALLUCINATION" | "PROTECTQA_AI_RATE_HALLUCINATION" | "PROTECTQA_AI_HEALTH_ANSWER_CONTRADICTION" | "PROTECTQA_AI_MISSING_UNDERWRITING_DISCLOSURE" | "PROTECTQA_AI_POLICY_DRIFT" | "OTHER";
export type IssueCategoryV2 = "evidence" | "consistency" | "compliance" | "billing" | "disclosure" | "data_integrity" | "other";
export type SeverityV2 = "low" | "medium" | "high" | "critical";
export type ImpactV2 = "low" | "medium" | "high";
export type SeverityDisplayV2 = "low" | "medium" | "high";
export type SpeakerV2 = "AGENT" | "CUSTOMER" | "SYSTEM" | "MIXED" | "UNKNOWN";
export type VerificationLevelV2 = "TRANSCRIPT_PROVABLE" | "DOC_SUPPORTED" | "SYSTEM_VERIFIED" | "EXTERNAL_VERIFIED" | "TRANSCRIPT_ONLY" | "UNVERIFIED" | "NONE";
export type IngestionMode = "TRANSCRIPT_ONLY" | "AUDIO_AND_TRANSCRIPT" | "AUDIO_ONLY_TRANSCRIBED" | "DOC_BACKED";
export type Provenance = {
    ingestionMode: IngestionMode;
    transcriptSource: "USER_PROVIDED" | "AUTO_TRANSCRIBED" | "UNKNOWN";
    hasAudio: boolean;
    audioFingerprint?: string;
    transcriptFingerprint?: string;
    alignmentAvailable: boolean;
};
export type TranscriptQuality = {
    asrConfidence01?: number;
    diarizationConfidence01?: number;
    alignmentCoverage01?: number;
    noisyAudioFlag?: boolean;
};
export type AudioMeta = {
    fingerprint: string;
    durationMs?: number;
    codec?: string;
    sampleRate?: number;
    channels?: number;
};
export type EvidenceDoc = {
    id: string;
    kind: "document" | "policy" | "system_fact";
    content: string;
    sourceId?: string;
};
export type NormalizedTranscript = {
    turns: Array<{
        turnIndex: number;
        speaker: string;
        text: string;
        startTimeMs?: number;
        endTimeMs?: number;
        timestamp?: string;
    }>;
    participants: Array<{
        id: string;
        role: string;
        displayName: string;
    }>;
};
export type AnalysisInput = {
    transcript: NormalizedTranscript;
    audio?: AudioMeta;
    externalEvidence?: EvidenceDoc[];
    provenance: Provenance;
    transcriptQuality?: TranscriptQuality;
};
export interface EvalMode {
    verificationLevel: VerificationLevel;
    hasExternalEvidence: boolean;
    evidenceCoverage01: number;
    transcriptOnlyReasonCodes?: string[];
}
export type RecommendedActionType = "NEEDS_EXTERNAL_EVIDENCE" | "QA_REVIEW" | "COACH_AGENT" | "LEGAL_ESCALATION" | "BILLING_FOLLOWUP";
export interface IssueV2 {
    issueId: string;
    issueKey: string;
    clusterKey?: string;
    clusterId?: string;
    topicId?: string;
    slotKey?: string;
    runId: string;
    conversationId: string;
    type: IssueTypeV2;
    category: IssueCategoryV2;
    primaryCategory?: CanonicalCategory;
    severity: SeverityV2;
    impact: ImpactV2;
    riskScore: number;
    score: number;
    confidence: number;
    reviewRequired: boolean;
    verification: {
        level: VerificationLevelV2;
        reasonCodes: string[];
        provenance?: {
            transcriptAnchors: Array<{
                turnIndex: number;
                claimId: string;
                excerpt?: string;
                start?: number;
                end?: number;
            }>;
            evidenceDocRefs: Array<{
                docId: string;
                chunkId?: string;
                snippet: string;
                score: number;
                sourceType: string;
                version: string;
                sha256: string;
            }>;
        };
    };
    scoring: {
        components: {
            impact01: number;
            evidence01: number;
            signal01: number;
            category01: number;
            verificationMultiplier: number;
            risk01Raw: number;
            risk01Final: number;
        };
        weights: {
            impact: number;
            evidence: number;
            signal: number;
            category: number;
        };
        reasons: string[];
        modeCapsApplied?: string[];
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
        speakerLabel?: string;
        turnIndex?: number;
    };
    what: {
        primaryClaimId: string;
        relatedClaimIds?: string[];
        claimText?: string;
        issueSummary: string;
        issueDetail: string;
        saferVersion?: string;
        /** Plain English for clients — what was said and why it matters */
        plainEnglishSummary?: string;
        whyItMatters?: string;
        missingEvidence?: string[];
        recommendedActionLabel?: string;
        businessImpact?: string;
        expectedSource?: string;
    };
    evidence: {
        refs?: Array<{
            sourceType: "TRANSCRIPT" | "POLICY" | "DOC" | "SYSTEM_FACT";
            sourceId: string;
            quote: string;
            weight?: number;
            turnIndex?: number;
        }>;
        evidenceRefs?: EvidenceCitation[];
        edges?: Array<{
            kind: "grounding" | "support" | "contradiction" | "SUPPORT_TRANSCRIPT" | "SUPPORT_EVIDENCE" | "CONTRADICTION_TRANSCRIPT" | "CONTRADICTION_EVIDENCE" | "GROUNDING_TRANSCRIPT" | "GROUNDING_EVIDENCE";
            claimA: string;
            claimB?: string;
            weight: number;
        }>;
        verification?: {
            level: VerificationLevelV2;
            reasonCodes: string[];
            provenance?: {
                transcriptAnchors: Array<{
                    turnIndex: number;
                    claimId: string;
                }>;
                externalDocRefs: string[];
            };
        };
    };
    transcriptSpans?: Array<{
        turnIndex: number;
        speaker: SpeakerV2;
        speakerLabel?: string;
        excerpt: string;
        start?: number;
        end?: number;
    }>;
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
    byType: Partial<Record<IssueTypeV2, number>> & Record<string, number>;
    bySeverity: Record<SeverityV2, number>;
    byCategory: Record<IssueCategoryV2, number>;
    topIssuesCount: number;
    allIssuesCount: number;
}
export interface AggregatedIssue {
    clusterId: string;
    clusterKey: string;
    category: string;
    type: string;
    title: string;
    summary: string;
    severity: SeverityV2;
    riskScore: number;
    occurrences: number;
    firstTurnIndex: number;
    lastTurnIndex: number;
    verification: EvalMode;
    reviewRequired: boolean;
    evidence: {
        refs: any[];
        edges: any[];
        atomicIssueIds: string[];
        claimIds: string[];
    };
    scoring: {
        components: {
            impact01: number;
            signal01: number;
            evidence01: number;
            category01: number;
            clusterPenalty01: number;
            verificationMultiplier: number;
        };
        reasons: string[];
    };
}
/**
 * GroupedIssue: Cluster rollup for "Top Issues (Grouped)" table
 * One row per clusterId, representing all atomic issues in that cluster
 */
export interface GroupedIssue {
    clusterId: string;
    clusterKey: string;
    category: string;
    type: string;
    topicId?: string;
    slotKey?: string;
    severity: "low" | "medium" | "high" | "critical";
    riskScore: number;
    score: number;
    confidence: number;
    impact?: "low" | "medium" | "high";
    reviewRequired: boolean;
    verification: {
        level: VerificationLevelV2;
        reasonCodes?: string[];
    };
    what: {
        issueSummary: string;
        issueDetail?: string;
        representativeClaimText?: string;
        primaryClaimId?: string;
        relatedClaimIds?: string[];
    };
    rollup: {
        atomicIssueCount: number;
        atomicIssueIds: string[];
        issueKeys: string[];
        involvedClaimIds: string[];
        involvedTurnIndexes: number[];
        topEdges?: Array<{
            kind: "contradiction" | "support" | "grounding" | string;
            claimA?: string;
            claimB?: string;
            weight?: number;
        }>;
        refs?: Array<{
            quote?: string;
            sourceId?: string;
            sourceType?: string;
            turnIndex?: number;
        }>;
    };
    audit: {
        scorerId: string;
        createdAt: string;
        engineVersion: string;
        inputHash?: string;
        configHash?: string;
    };
}
export interface ExecutiveSummary {
    overallRiskScore: number;
    truthScore: number;
    coherenceScore: number;
    consistencyScore: number;
    verificationLevel: VerificationLevel;
    auditDefensibility: "low" | "medium" | "high";
    ingestionMode?: string;
    criticalFindings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
    topRootCauses: Array<{
        title: string;
        severity: string;
        riskScore: number;
        occurrences: number;
    }>;
    recommendedActions: Array<{
        action: string;
        reason: string;
        linkedClusterId?: string;
    }>;
    disclaimers: string[];
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
/** Evidence linkage per claim — powers evidenceSupport score & dashboards */
export type EvidenceDependencyStatus = "supported" | "partially_supported" | "transcript_only" | "unsupported" | "contradicted" | "false_by_rule" | "unverifiable";
/** Conversation value mining — objections, churn risk, KB gaps, etc. */
export type BusinessInsightType = "CUSTOMER_OBJECTION" | "FEATURE_REQUEST" | "PRICING_CONFUSION" | "PRODUCT_CONFUSION" | "COMPETITOR_MENTION" | "BUYING_INTENT" | "CHURN_RISK" | "COMPLAINT_RISK" | "PROCESS_FRICTION" | "POLICY_CONFUSION" | "KB_GAP" | "SCRIPT_GAP" | "AI_PROMPT_GAP" | "TRAINING_GAP" | "REVENUE_OPPORTUNITY" | "PROTECTQA_LEAD_QUALITY_SIGNAL" | "PROTECTQA_HEALTH_CONDITION_SIGNAL" | "PROTECTQA_QUALIFICATION_BLOCKER" | "PROTECTQA_COVERAGE_AMOUNT_INTENT" | "PROTECTQA_PRICE_SENSITIVITY" | "PROTECTQA_BENEFICIARY_CONCERN" | "PROTECTQA_BURIAL_COST_CONCERN" | "PROTECTQA_TRUST_OBJECTION" | "PROTECTQA_NO_PRESSURE_SIGNAL" | "PROTECTQA_CALL_BACK_REQUEST" | "PROTECTQA_CARRIER_CONFUSION" | "PROTECTQA_WAITING_PERIOD_CONFUSION" | "PROTECTQA_POLICY_TYPE_CONFUSION" | "PROTECTQA_APPLICATION_READINESS" | "PROTECTQA_AGENT_SCRIPT_GAP" | "PROTECTQA_AI_KNOWLEDGE_GAP";
export interface BusinessInsight {
    type: BusinessInsightType;
    summary: string;
    evidenceQuote?: string;
    speaker?: string;
    turnIndex?: number;
    confidence: number;
    recommendedAction: string;
    businessImpact: string;
}
export type ClaimSpeakerRole = NonNullable<Claim["meta"]>["speakerType"];
export interface ClientClaimSnapshot {
    id: string;
    speaker?: string;
    speakerType?: ClaimSpeakerRole;
    turnIndex?: number;
    text: string;
    claimType?: string;
    truthState?: Claim["truthState"];
    evidenceStatus: EvidenceDependencyStatus;
    requiredEvidence: string[];
    missingEvidence: string[];
    riskScore?: number;
    businessValueTags?: string[];
}
export interface DashboardSummary {
    title: string;
    subtitle?: string;
    /** dashboardMode: broader TCL vs ProtectQA-specific framing */
    dashboardMode?: "tcl" | "protectqa";
    plainEnglishSummary: string;
    conversationTrustScore?: {
        label: string;
        score: number;
        subtitle: string;
    };
    topRisks: Array<{
        title: string;
        quote: string;
        speaker?: string;
        turnIndex?: number;
        whyItMatters: string;
        recommendedFix: string;
        severity: SeverityV2;
    }>;
    topUnsupportedClaims: Array<{
        claimText: string;
        missingEvidence: string[];
        requiredSource: string;
        recommendedEvidenceSource?: string;
    }>;
    topDriftEvents: Array<{
        earlierQuote: string;
        laterQuote: string;
        driftType: string;
        recommendedFix: string;
    }>;
    topBusinessInsights: BusinessInsight[];
    nextBestActions: string[];
}
/** Enhanced scores that reflect reality */
export type EnhancedScores = {
    groundednessScore: number | null;
    transcriptGrounding?: number | null;
    factualTruth?: number | null;
    compliance?: number | null;
    hallucination?: number | null;
    drift?: number | null;
    verificationScore: number | null;
    consistencyScore: number | null;
    coherenceScore: number | null;
    /** @deprecated Use groundednessScore instead */
    truth: number | null;
    consistency: number | null;
    coherence: number | null;
    overall: number | null;
    /** Conversation Truth & Risk primary score — aligns with weighted compliance + truth + disclosures + evidence */
    tcl?: number | null;
    evidenceSupport?: number | null;
    speakerConfidence?: number | null;
    businessValue?: number | null;
    disclosureCoverage?: number | null;
    modeAware?: {
        consistencyScore: number | null;
        groundingScore: number;
        evidenceScore: number;
    };
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
    /** Industry / product template (e.g. general_conversation_integrity, final_expense) */
    industryTemplateId?: string;
    /** Domain pack ids applied for this run */
    domainPackIds?: string[];
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
export type ScoreBandV2 = "low" | "medium" | "high" | "critical";
export interface ScoredMetricV2 {
    value: number;
    band: ScoreBandV2;
    confidence: number;
    explanation: string;
    components: Array<{
        name: string;
        value: number;
        weight: number;
        reason: string;
    }>;
}
export interface EvidenceRefViewV2 {
    id: string;
    sourceType: string;
    sourceId?: string;
    title?: string;
    textSnippet?: string;
    speaker?: string;
    turnIndex?: number;
    timestamp?: string;
    chunkIndex?: number;
    matchType?: "exact" | "semantic" | "entity" | "rule" | "graph";
    matchScore?: number;
    supportsOrContradicts?: "supports" | "contradicts" | "neutral";
}
export interface AnalysisIssueV2 {
    id: string;
    title: string;
    severity: SeverityV2;
    category: string;
    issueType: string;
    score: number;
    confidence: number;
    summary: string;
    flaggedClaim?: string;
    evidenceRefs: EvidenceRefViewV2[];
    relatedClaimIds?: string[];
    graphSignals?: string[];
    scoringBreakdown?: IssueV2["scoring"];
    recommendedAction?: string;
    customerImpact?: string;
    complianceImpact?: string;
    modelBehaviorImpact?: string;
}
export interface EvidenceCoverageStatsV2 {
    claimsExtracted: number;
    /** Claims with external / doc-backed support edges */
    supported: number;
    /** Transcript-grounded in graph but not externally verified */
    unverified: number;
    /** No grounding edge to transcript evidence */
    ungrounded: number;
    contradicted: number;
    sourcesUsed: Array<{
        sourceType: string;
        count: number;
    }>;
}
export interface ClaimTimelineEventV2 {
    claimId: string;
    turnIndex?: number;
    label: "claimed" | "repeated" | "contradicted" | "drifted" | "unsupported" | "flagged";
    textPreview: string;
}
export interface AnalysisResultPayload {
    schemaVersion: string;
    industryTemplateId: string;
    graphTemplateId: string;
    domainPackIds: string[];
    integrity: ScoredMetricV2;
    complianceRisk: ScoredMetricV2;
    hallucinationRisk: ScoredMetricV2;
    drift: ScoredMetricV2;
    evidenceCoverage: ScoredMetricV2;
    transcriptQuality: ScoredMetricV2;
    graphConflict: ScoredMetricV2;
    issuesEnriched: AnalysisIssueV2[];
    issuesV2: IssueV2[];
    evidenceCoverageStats: EvidenceCoverageStatsV2;
    claimTimeline: ClaimTimelineEventV2[];
    templatePanel: {
        selectedTemplateId: string;
        selectedTemplateName: string;
        graphTemplateId: string;
        rulesSignalsApplied: string[];
        confidenceImpactNote: string;
    };
}
export type ValidateOutput = {
    answer: string;
    refusal: boolean;
    /** Scoring model: truth = factual/supported safety; tcl = primary client score; overall = alias of tcl */
    scores: {
        truth: number | null;
        consistency: number | null;
        coherence: number | null;
        overall: number | null;
        tcl?: number | null;
        transcriptGrounding?: number | null;
        compliance?: number | null;
        hallucination?: number | null;
        drift?: number | null;
        evidenceSupport?: number | null;
        speakerConfidence?: number | null;
        businessValue?: number | null;
    };
    enhancedScores?: EnhancedScores;
    summaryStats?: SummaryStats;
    scorerId?: string;
    latency?: number;
    cacheHitRate?: number;
    engineVersion?: string;
    diagnostics?: {
        status?: "ok" | "degraded" | "failed";
        sanitizedTranscript: boolean;
        removedAnnotationLines: number;
        normalizedInlineSpeakerBoundaries: number;
        contaminatedClaims: number;
        unknownSpeakerLines: number;
        speakerConfidence: number;
        /** @deprecated Prefer speakerConfidence */
        speakerMappingConfidence: number;
        claimContaminationIndex?: number;
        agentClaimCount: number;
        customerClaimCount: number;
        aiClaimCount?: number;
        systemClaimCount?: number;
        evidenceGapCount?: number;
        complianceIssueCount: number;
        hallucinationIssueCount: number;
        driftIssueCount: number;
        crossTurnIssueCount?: number;
        domainPacksApplied?: string[];
        scoringCapsApplied: string[];
    };
    risk?: {
        level: "low" | "medium" | "high" | "critical";
        criticalCount: number;
        highCount: number;
        mediumCount: number;
        lowCount: number;
        reviewRequired: boolean;
        /** Single headline risk label for executives */
        primaryRisk?: string;
        recommendedAction?: string;
        businessImpact?: string;
    };
    /** Applied domain packs and default ProtectQA posture */
    productContext?: {
        positioning: string;
        defaultDomain: string;
        domainPacksApplied: string[];
    };
    businessInsights?: BusinessInsight[];
    /** Cross-cutting recommendations (compliance review, KB update, etc.) */
    recommendedActions?: Array<{
        label: string;
        rationale?: string;
    }>;
    /** Client dashboard sections — pre-structured narrative */
    dashboardSummary?: DashboardSummary;
    /** Claim-level snapshots with evidence dependency */
    claimsAnalysis?: ClientClaimSnapshot[];
    /** Issues grouped by severity for dashboards */
    issuesBySeverity?: {
        critical: IssueV2[];
        high: IssueV2[];
        medium: IssueV2[];
        low: IssueV2[];
    };
    evidenceDependencyGraph?: Array<{
        claimId: string;
        speakerType?: ClaimSpeakerRole;
        turnIndex?: number;
        claimText: string;
        claimKind?: ClaimKind | string;
        requiredEvidenceTypes: string[];
        presentEvidenceTypes: string[];
        missingEvidenceTypes: string[];
        status: EvidenceDependencyStatus;
    }>;
    executiveSummary?: {
        trustGrade: "A" | "B" | "C" | "D" | "F";
        headline: string;
        oneLineVerdict: string;
        topIssues: Array<{
            title: string;
            severity: "low" | "medium" | "high" | "critical";
            speakerLabel?: string;
            turnIndex?: number;
            quote: string;
            saferVersion?: string;
            why: string;
        }>;
        highlights: string[];
        recommendedActions: Array<{
            kind: "COACHING" | "COMPLIANCE" | "PROCESS" | "LEGAL";
            action: string;
            priority: "high" | "medium" | "low";
        }>;
        riskByCategory: Record<string, number>;
        scoreBreakdown: Array<{
            label: string;
            value: number | null;
            description: string;
        }>;
        callQualityIndicators: {
            speakerMappingConfidence: number;
            contaminatedClaims: number;
            unknownSpeakerLines: number;
            capsApplied: string[];
        };
    };
    /** Structured analysis contract (scores, issues, evidence, template) for API + UI */
    analysisResult?: AnalysisResultPayload;
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
        drift?: {
            driftScore: number;
            driftTimeline: Array<{
                turnIndex?: number;
                claimId: string;
                marker: string;
                text: string;
                topic?: string;
                strength?: number;
                band?: string;
            }>;
        };
        crossTurn?: {
            consistencyScore: number;
            events: Array<{
                kind: "customer_fact" | "agent_assertion" | "agent_dismissal" | "numeric" | "commitment";
                topic: string;
                turnIndex?: number;
                claimId: string;
                text: string;
                entities: string[];
                numbers?: number[];
            }>;
            pairs: Array<{
                earlier: {
                    claimId: string;
                    turnIndex?: number;
                    text: string;
                    topic: string;
                };
                later: {
                    claimId: string;
                    turnIndex?: number;
                    text: string;
                    topic: string;
                };
                reason: string;
            }>;
        };
        domainPacksApplied?: Array<{
            id: string;
            version: string;
        }>;
        issues?: {
            atomic: IssueV2[];
            grouped?: unknown[];
        };
        allIssuesV2?: IssueV2[];
        manifest?: RunManifest;
        /** Structured analysis payload for UI (scores, enriched issues, template panel) */
        analysisResult?: AnalysisResultPayload;
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
