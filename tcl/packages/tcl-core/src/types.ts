import type { LLMAdapter } from "./adapters/llm_adapter";
import type { 
  CanonicalCategory, 
  EvidenceCitation 
} from "./types/evidence.types";

export type Source = { id: string; text: string };

// ============================================================================
// CLAIM CLASSIFICATION - For contradiction gating
// ============================================================================

/** Claim kind determines how it participates in contradiction detection */
export type ClaimKind = 
  | "assertion"  // Factual statement that can be contradicted
  | "intent"     // "I want to...", "I'd like to..." - customer goals
  | "question"   // Ends with "?" or interrogative
  | "meta"       // References docs/agreements, conversation control
  | "emotion"    // Expresses feelings: frustrated, upset, confused
  | "promise"    // Agent commitment: "I will...", "I'll send..."
  | "unknown";   // Fallback

/** Grounding status - where the claim gets its support */
export type ClaimGrounding = {
  kind: "transcript" | "external" | "none";
  evidenceIds: string[];
  quoteSpans?: Array<{ start: number; end: number }>;
};

/** Verification status - for claims against external sources */
export type ClaimVerification = {
  status: "unverified" | "verified" | "disputed" | "not_applicable";
  evidenceIds: string[];
};

/** Consistency status - relationship to other claims */
export type ClaimConsistency = {
  status: "consistent" | "inconsistent" | "unknown";
  against: string[]; // IDs of conflicting claims
};

export type Claim = {
  id: string;
  text: string;
  confidence: number; // 0..1 (calculated confidence score)
  evidence: { source_id: string; quote?: string; span?: string; weight?: number }[];
  
  // NEW: Evidence refs from grounding edges (transcript citations)
  evidenceRefs?: Array<{
    sourceId: string;
    quote?: string;
    turnIndex?: number;
    weight?: number;
  }>;
  
  // NEW: Claim classification for contradiction gating
  claimKind?: ClaimKind;
  grounding?: ClaimGrounding;
  verification?: ClaimVerification;
  consistency?: ClaimConsistency;
  
  // Enhanced confidence metrics
  confidenceMetrics?: {
    groundingScore: number; // 0-1, based on evidence
    supportScore: number; // 0-1, based on support from other claims
    contradictionScore: number; // 0-1, inverse (higher = fewer contradictions)
    overall: number; // 0-1, weighted average
    risk?: number; // 1 - overall, for easy consumption
  };
  // Metadata for transcript-aware extraction
  meta?: {
    speaker?: string; // "Agent" | "Customer" | "Other" (legacy)
    speakerType?: "agent" | "customer" | "unknown"; // B2: Normalized speaker type
    speakerLabel?: string; // B2: Raw speaker label (e.g., "AGENT", "CUSTOMER", "KENT")
    turnIndex?: number;
  };
  
  // Truth state derived from graph topology
  // - SUPPORTED: Has external evidence support (non-transcript)
  // - UNVERIFIED: Grounded in transcript but lacks external evidence
  // - CONTRADICTED: Has contradiction edge on same slot
  // - UNGROUNDED: No edges (isolated node)
  truthState?: "SUPPORTED" | "CONTRADICTED" | "UNVERIFIED" | "UNGROUNDED" | 
               // Legacy values (deprecated)
               "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
  
  whyFlagged?: {
    reasons: string[];
    evidence: Array<{ source_id: string; quote?: string; span?: string }>;
    conflictsWith: Array<{ claimId: string; score: number }>;
    missingEvidence: boolean;
  };
  suggestedRewrite?: string; // Optional agent coaching suggestion
};

// ============================================================================
// ISSUE NARRATIVE - QA-Manager Grade Findings
// ============================================================================

export type EvidenceQuote = {
  quoteId: string;
  claimId: string;
  speaker: "Agent" | "Customer" | "System";
  turnIndex: number;
  lineSpan?: [number, number];
  text: string; // Exact quote (not truncated)
  evidenceRef?: {
    type: "Call" | "Policy" | "KB";
    ref: string;
  };
};

export type ContradictionPair = {
  claimAId: string;
  claimBId: string;
  score: number;
  explanation: string; // Auto-generated: "These cannot both be true because…"
  quoteIds: [string, string]; // References into evidenceQuotes
};

/** Support basis for a claim - where is it supported from? */
export type SupportBasis = 'TRANSCRIPT' | 'EXTERNAL' | 'NONE';

/** Verification level based on available evidence - for EvalMode */
export type VerificationLevel = 
  | "UNVERIFIED"
  | "TRANSCRIPT_ONLY"
  | "TRANSCRIPT_PROVABLE"
  | "DOC_BACKED"
  | "SYSTEM_VERIFIED"
  | "EXTERNALLY_VERIFIED";

/** Evidence mode for the evaluation run */
export type EvidenceMode = 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL';

export type IssueNarrative = {
  issueId: string;
  category: string; // e.g., "BILLING"
  subcategory?: string; // e.g., "Cancellation Fees"
  title: string; // Human-friendly (no "discrepancy about X and Y")
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
    speakerFocus: "AGENT" | "SYSTEM" | "CUSTOMER"; // Default "AGENT"
  };
  
  whatIsWrong: string; // 1–3 sentences, specific
  whyWrong: string[]; // Bullet reasons (policy/logic)
  whyItMatters: string[]; // Business impact bullets
  
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
    riskScore: number; // 0–100 (configurable mapping)
    impactScore: number; // 0–100
    fixabilityScore: number; // 0–100
    compositeScore: number; // Used for ranking
    rationale: string[]; // Bullet explanation of score drivers
  };
};

// ============================================================================
// ISSUE V2 - Enterprise-Grade Schema
// ============================================================================

export type IssueTypeV2 =
  | "CONTRADICTION"
  | "UNVERIFIED_CLAIM"
  | "UNSUPPORTED_CLAIM"
  | "UNGROUNDED"
  | "RISK_SIGNAL"
  | "POLICY"
  | "NUMERIC_MISMATCH"
  | "COMMITMENT_INCONSISTENCY"
  | "FEE_DISCLOSURE_RISK"
  | "DATA_INTEGRITY"
  | "OTHER";

// Legacy categories (for backward compatibility)
export type IssueCategoryV2 =
  | "evidence"
  | "consistency"
  | "compliance"
  | "billing"
  | "disclosure"
  | "data_integrity"
  | "other";

// Canonical categories (new stable taxonomy)
// Imported from evidence.types.ts - see CanonicalCategory type

export type SeverityV2 = "low" | "medium" | "high" | "critical";

export type ImpactV2 = "low" | "medium" | "high";

export type SeverityDisplayV2 = "low" | "medium" | "high";

export type SpeakerV2 = "AGENT" | "CUSTOMER" | "SYSTEM" | "MIXED" | "UNKNOWN";

export type VerificationLevelV2 = 
  | "TRANSCRIPT_PROVABLE"  // High confidence transcript-only contradictions
  | "DOC_SUPPORTED"        // Document-backed support
  | "SYSTEM_VERIFIED"      // System export match (ledger/CRM)
  | "EXTERNAL_VERIFIED"    // Legacy: externally verified
  | "TRANSCRIPT_ONLY"      // Legacy: transcript-only
  | "UNVERIFIED"           // No evidence found
  | "NONE";                // Legacy: no verification

// ============================================================================
// INGESTION MODE & PROVENANCE
// ============================================================================

export type IngestionMode =
  | "TRANSCRIPT_ONLY"
  | "AUDIO_AND_TRANSCRIPT"
  | "AUDIO_ONLY_TRANSCRIBED"
  | "DOC_BACKED";

export type Provenance = {
  ingestionMode: IngestionMode;
  transcriptSource: "USER_PROVIDED" | "AUTO_TRANSCRIBED" | "UNKNOWN";
  hasAudio: boolean;
  audioFingerprint?: string;      // hash, duration, codec, etc.
  transcriptFingerprint?: string; // hash
  alignmentAvailable: boolean;    // word/segment timestamps available
};

export type TranscriptQuality = {
  asrConfidence01?: number;  // 0..1
  diarizationConfidence01?: number;
  alignmentCoverage01?: number; // % of tokens with timestamps
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
  transcript: NormalizedTranscript; // always required (may be provided or generated)
  audio?: AudioMeta;                // optional
  externalEvidence?: EvidenceDoc[]; // optional
  provenance: Provenance;
  transcriptQuality?: TranscriptQuality;
};

export interface EvalMode {
  verificationLevel: VerificationLevel;
  hasExternalEvidence: boolean;         // true if any refs/evidence sources provided
  evidenceCoverage01: number;           // 0..1 (% of high-impact claims that have evidence edges)
  transcriptOnlyReasonCodes?: string[]; // e.g. ["NO_EXTERNAL_EVIDENCE"]
}

export type RecommendedActionType = 
  | "NEEDS_EXTERNAL_EVIDENCE" 
  | "QA_REVIEW" 
  | "COACH_AGENT" 
  | "LEGAL_ESCALATION" 
  | "BILLING_FOLLOWUP";

export interface IssueV2 {
  issueId: string;                 // stable hash from (runId + issueKey)
  issueKey: string;                // stable dedupe key (atomic uniqueness)
  clusterKey?: string;             // cluster key for aggregation: `${category}:${type}:${topicId}:${slotKey}:${speakerType}`
  clusterId?: string;              // hash of clusterKey
  topicId?: string;                // topic identifier for gating
  slotKey?: string;                // slot identifier for gating
  runId: string;                   // evaluation.id
  conversationId: string;

  type: IssueTypeV2;
  category: IssueCategoryV2;       // Legacy category (for backward compatibility)
  primaryCategory?: CanonicalCategory; // NEW: Canonical category (compliance, privacy_security, billing_financial, etc.)
  severity: SeverityV2;            // Canonical severity (high/medium/low)
  impact: ImpactV2;                // How bad if true (not affected by mode)
  riskScore: number;               // 0..1 normalized (computed)
  score: number;                   // Numeric for sorting (0..100)
  confidence: number;              // 0..1 (based on edge weights / extractor confidence)
  reviewRequired: boolean;

  verification: {
    level: VerificationLevelV2;
    reasonCodes: string[];         // e.g. ["NO_EXTERNAL_EVIDENCE", "DOC_SUPPORTED"]
    provenance?: {                  // NEW: Traceability for audit
      transcriptAnchors: Array<{ 
        turnIndex: number; 
        claimId: string;
        excerpt?: string;           // Transcript excerpt for this anchor
        start?: number;              // Character offset start (if available)
        end?: number;                // Character offset end (if available)
      }>;
      evidenceDocRefs: Array<{      // Evidence citations
        docId: string;              // evidence_item.id
        chunkId?: string;           // evidence_chunk.id
        snippet: string;             // <= ~240 chars excerpt
        score: number;               // Retrieval score (0..1)
        sourceType: string;          // EvidenceSourceType
        version: string;             // evidence_item.version
        sha256: string;              // evidence_item.file.sha256 or link.sha256
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
    modeCapsApplied?: string[]; // Track which caps were applied (optional, only if caps were applied)
  };
  
  severityReason?: string[];        // Human-readable reasons for severity
  capsApplied?: string[];           // e.g. ["TRANSCRIPT_ONLY_SEVERITY_CAP", "TRANSCRIPT_ONLY_EXCEPTION:escalation"]
  
  recommendedAction?: {
    actionType: RecommendedActionType;
    explanation: string;
    requiredEvidence?: string[];     // e.g. ["billing ledger", "contract term", "policy doc"]
  };

  who: {
    speaker: SpeakerV2;
    speakerLabel?: string; // B3: Raw speaker label (e.g., "AGENT", "CUSTOMER", "KENT")
    turnIndex?: number;
  };

  what: {
    primaryClaimId: string;
    relatedClaimIds?: string[];
    claimText?: string;            // snapshot
    issueSummary: string;          // short, UI safe
    issueDetail: string;           // longer, compliance safe
  };

  evidence: {
    // Legacy refs (for backward compatibility)
    refs?: Array<{
      sourceType: "TRANSCRIPT" | "POLICY" | "DOC" | "SYSTEM_FACT";
      sourceId: string;            // e-transcript-#
      quote: string;
      weight?: number;             // grounding/support score
      turnIndex?: number;
    }>;
    // NEW: Evidence citations using EvidenceCitation structure
    evidenceRefs?: EvidenceCitation[];
    edges?: Array<{
      kind: "grounding" | "support" | "contradiction" | "SUPPORT_TRANSCRIPT" | "SUPPORT_EVIDENCE" | "CONTRADICTION_TRANSCRIPT" | "CONTRADICTION_EVIDENCE" | "GROUNDING_TRANSCRIPT" | "GROUNDING_EVIDENCE";
      claimA: string;
      claimB?: string;
      weight: number;
    }>;
    // D1: Always populate evidence.verification
    verification?: {
      level: VerificationLevelV2;
      reasonCodes: string[];
      provenance?: {
        transcriptAnchors: Array<{ turnIndex: number; claimId: string }>;
        externalDocRefs: string[];
      };
    };
  };
  
  // NEW: Transcript spans for traceability
  transcriptSpans?: Array<{
    turnIndex: number;
    speaker: SpeakerV2;
    speakerLabel?: string;
    excerpt: string;               // Transcript excerpt
    start?: number;                 // Character offset start (if available)
    end?: number;                   // Character offset end (if available)
  }>;

  compliance: {
    tags: string[];                // e.g. ["billing", "fee_disclosure", "misrepresentation_risk", "pci", "cvv", "hipaa"]
    impactedPolicies?: Array<{ policyId: string; section?: string }>; // empty in transcript-only
    legalHoldSuggested?: boolean;  // config-driven for high severity
    disclaimers: string[];         // required in transcript-only: "Not externally verified"
  };

  audit: {
    createdAt: string;             // ISO
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

export interface AggregatedIssue {
  clusterId: string;
  clusterKey: string;
  
  category: string;      // consistency, compliance, evidence, etc.
  type: string;          // CONTRADICTION, PCI, RECORDING_CONSENT, ...
  title: string;
  summary: string;
  
  severity: SeverityV2;
  riskScore: number;     // clustered risk score 0..1
  occurrences: number;
  
  firstTurnIndex: number;
  lastTurnIndex: number;
  
  verification: EvalMode;  // include mode + reason codes
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

  category: string;       // e.g. "consistency"
  type: string;           // e.g. "CONTRADICTION" or "PCI"
  topicId?: string;       // best available topicId in cluster
  slotKey?: string;       // best available slotKey in cluster

  severity: "low"|"medium"|"high"|"critical";

  riskScore: number;      // cluster risk score 0..1
  score: number;          // 0..100 (derived from riskScore)

  confidence: number;     // cluster confidence 0..1
  impact?: "low"|"medium"|"high"; // optional: cluster impact (derived)

  reviewRequired: boolean;
  verification: { 
    level: VerificationLevelV2; 
    reasonCodes?: string[] 
  };

  // Summary strings for manager UI
  what: {
    issueSummary: string;
    issueDetail?: string;
    representativeClaimText?: string;
    primaryClaimId?: string;
    relatedClaimIds?: string[];
  };

  // Drilldown + diagnostics
  rollup: {
    atomicIssueCount: number;
    atomicIssueIds: string[];
    issueKeys: string[];

    involvedClaimIds: string[];
    involvedTurnIndexes: number[];

    // strongest edges to show "why"
    topEdges?: Array<{
      kind: "contradiction"|"support"|"grounding"|string;
      claimA?: string;
      claimB?: string;
      weight?: number;
    }>;

    // references aggregated (quotes, doc refs)
    refs?: Array<{
      quote?: string;
      sourceId?: string;
      sourceType?: string; // TRANSCRIPT / DOC / etc
      turnIndex?: number;
    }>;
  };

  // Keep audit provenance
  audit: {
    scorerId: string;
    createdAt: string;
    engineVersion: string;
    inputHash?: string;
    configHash?: string;
  };
}

export interface ExecutiveSummary {
  overallRiskScore: number;      // 0..100
  truthScore: number;            // existing
  coherenceScore: number;        // existing
  consistencyScore: number;      // existing
  
  verificationLevel: VerificationLevel;
  auditDefensibility: "low" | "medium" | "high"; // derived from mode + evidenceCoverage01
  ingestionMode?: string;       // Rule 8: Show ingestion mode
  
  criticalFindings: number; // aggregated count by severity
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
  
  disclaimers: string[]; // e.g., transcript-only not externally verified
}

export type Violation =
  | { type: "MISSING_EVIDENCE"; claimId: string; detail: string }
  | { type: "CONTRADICTION"; claimA: string; claimB: string; detail: string }
  | { type: "LOW_CONFIDENCE"; claimId: string; detail: string }
  | { type: "CUSTOM_RULE"; claimId?: string; ruleId: string; detail: string };

// Custom validation rule (domain-specific)
export type CustomRule = {
  id: string;
  name: string;
  description: string;
  // Pattern-based rule: check if text matches pattern
  pattern?: {
    type: 'contains' | 'regex' | 'semantic';
    value: string;
    caseSensitive?: boolean;
    mode?: 'must_contain' | 'must_not_contain'; // Default: must_contain
  };
  // Semantic rule: use NLI to check relationship
  semantic?: {
    type: 'must_contain' | 'must_not_contain' | 'must_support' | 'must_not_contradict';
    reference: string; // Reference text to check against
  };
  // Claim-level or document-level
  scope: 'claim' | 'document';
  severity: 'error' | 'warning' | 'info';
  suggestion?: string; // Default suggestion if rule fails
};

export type SpectralReport = {
  coherenceScore: number;          // 0-100
  contradictionEnergy: number;     // >=0
  supportEnergy: number;           // >=0
  circularityScore: number;        // 0-100 (higher = more circular)
  spectralGap: number;             // >=0
  cycleMass?: number;              // >=0
  heatTrace?: number[];
  // Enhanced from /spectral/analyze
  truthVector?: number[];          // Per-claim truth values
  truthStates?: string[];          // Per-claim states: "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive"
  topBadContradictions?: EdgeAttributionExpanded[];
  topBadSupports?: EdgeAttributionExpanded[];
  nodeBlame?: number[];            // Per-claim blame scores
  nodeBlameNorm?: number[];         // Normalized node blame (0..1)
  fingerprint?: any;                // Monitoring fingerprint
};

export type DestructiveReason =
  | "node_blame"
  | "contradiction_pressure"
  | "low_confidence"
  | "policy_violation"
  | "ungrounded"
  | "contradicted";

export type DestructiveClaim = {
  claimId: string;
  text: string;
  // 0..1
  importance: number;
  // spectral
  truthState?: "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
  truthValue?: number; // from truthVector
  // metrics 0..1
  nodeBlameNorm?: number;
  contradictionIncident?: number; // normalized
  confidenceOverall?: number;      // from confidenceMetrics.overall
  groundingScore?: number;         // from confidenceMetrics.groundingScore
  // policy
  policySeverity?: "none" | "warning" | "error";
  policyRuleIds?: string[];
  // Explainability
  reasons: Array<{ kind: DestructiveReason; weight: number; detail?: string }>;
};

export type EdgeAttributionExpanded = {
  claimAIndex: number;
  claimBIndex: number;
  weight: number;
  badness: number;
  // add these (server OR client can map)
  claimAId?: string;
  claimBId?: string;
};

export type TrajectorySegment = {
  segmentIndex: number;
  startTurn: number;
  endTurn: number;
  textPreview: string;
  scores: { truth: number | null; consistency: number | null; coherence: number | null; overall: number | null };
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
  destructiveClaimsTop?: DestructiveClaim[]; // top 5 for that segment
};

export type TrajectoryReport = {
  enabled: boolean;
  segments: TrajectorySegment[];
  summary: {
    worstSegmentIndex: number | null;
    worstOverallScore: number | null;
    instability: number;  // variance/STD of overall
    peakRiskImportanceSum: number; // max sum of destructive importance in any segment
  };
};

export type ValidationOptions = {
  spectral?: boolean;
  repair?: boolean;
  thresholds?: { truth?: number; consistency?: number; overall?: number };
  spectralServiceUrl?: string;
  llmAdapter?: LLMAdapter;
  requireCitations?: boolean;

  // ==========================================================================
  // GRAPH BUILDER SELECTION (Critical for spectral.py quality)
  // ==========================================================================
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

  // Production knobs (graph) - Used by legacy mode
  nliEndpoint?: string;   // optional HTTP scorer endpoint for entail/contradiction
  nliApiKey?: string;     // optional auth
  nliModelId?: string;    // optional model ID for NLI scorer
  mistralApiKey?: string; // optional Mistral API key (auto-enables MistralNliScorer)
  mistralModel?: string; // optional Mistral model (defaults to mistral-small-latest)
  useLocalNli?: boolean; // use local transformers.js model (defaults to true, downloads on first run)
  supportThreshold?: number; // threshold for support edges (0-1, default: 0.58)
  contradictionThreshold?: number; // threshold for contradiction edges (0-1, default: 0.70)
  groundingThreshold?: number; // threshold for grounding edges (0-1, default: 0.60)
  maxPairwiseEdges?: number; // cap O(n^2)
  neighborK?: number; // candidates per claim
  batchSize?: number; // NLI scoring batch size
  cache?: boolean; // enable/disable semantic cache
  cachePersistPath?: string; // optional JSONL cache path
  annIndex?: 'hnsw' | 'bruteforce'; // ANN index choice
  annNeighborK?: number; // alias for neighborK

  // New features
  customRules?: CustomRule[]; // Domain-specific validation rules
  includeSuggestions?: boolean; // Generate suggested fixes (default: true)
  includeConfidenceMetrics?: boolean; // Include detailed confidence scores (default: true)
  
  // Upgrade features
  // Note: spectralMode removed - always uses /spectral/analyze (production endpoint)
  trajectory?: boolean;               // enable trajectory scoring for transcripts
  trajectoryWindowTurns?: number;     // default 3
  maxTrajectorySegments?: number;      // default 20 (guard for large transcripts)
};

export type ValidateInput = {
  question: string;
  answer: string;
  sources?: Source[];
  options?: ValidationOptions;
};

// ============================================================================
// EDGE TYPES - Enhanced with classification
// ============================================================================

/** Support edge types */
export type SupportType = "entailed" | "paraphrase" | "reinforced" | "weak";

export type SupportEdge = { 
  claimA: string; 
  claimB: string; 
  weight: number;
  // NEW: Support classification
  supportType?: SupportType;
};

/** Contradiction edge types - critical for gating */
export type ContradictionType = 
  | "direct"         // Real semantic contradiction
  | "topic_mismatch" // Different topics, not a real contradiction
  | "low_overlap"    // Insufficient topic overlap
  | "needs_review";  // Uncertain, flag for human review

export type ContradictionEdge = {
  claimA: string; 
  claimB: string; 
  weight: number;
  // NEW: Contradiction classification
  contradictionType?: ContradictionType;
  overlapScore?: number;  // Topic overlap (0-1)
  reasonCodes?: string[]; // e.g., ["KIND_INTENT", "LOW_OVERLAP"]
};

export type GroundingEdge = { claimId: string; sourceId: string; weight: number; quote?: string };

export type Suggestion = {
  type: 'fix_contradiction' | 'add_evidence' | 'improve_consistency' | 'resolve_circular' | 'custom_rule';
  claimId?: string;
  claimIds?: string[]; // For multi-claim suggestions
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  suggestedAction: string; // What the user should do
  example?: string; // Optional example of how to fix
};

// ============================================================================
// REVIEW ITEMS - Actionable outputs for users
// ============================================================================

/** Review item severity */
export type ReviewSeverity = "low" | "medium" | "high" | "critical";

/** Review item - the "money" output users actually need */
export type ReviewItem = {
  id: string;
  title: string;                    // Short: "Contradiction about plan change vs fee"
  severity: ReviewSeverity;
  category: "contradiction" | "ungrounded" | "promise_unverified" | "policy" | "destructive";
  whyItMatters: string;             // 1-2 lines explaining impact
  
  // Evidence
  involvedClaimIds: string[];
  claimTexts: string[];             // The actual claim text for display
  speakerLabels: string[];          // Who said what
  transcriptSpans?: Array<{ start: number; end: number }>;
  
  // Recommended action
  recommendedAction: string;        // 1 concrete action
  actionTemplate?: string;          // Template key: "billing_clarify", "promise_confirm", etc.
  
  // Drivers (why this was flagged)
  drivers: {
    nodeBlameNorm?: number;
    contradictionWeight?: number;
    overlapScore?: number;
    destructiveImportance?: number;
    reasonCodes?: string[];
  };
};

// ============================================================================
// ENHANCED SCORES - Replace misleading "truth" score
// ============================================================================

/** Enhanced scores that reflect reality */
export type EnhancedScores = {
  // NEW: Meaningful scores
  groundednessScore: number | null;   // 0-100: % of claims with transcript/external grounding
  verificationScore: number | null;   // 0-100: % verified against external sources (null if none)
  consistencyScore: number | null;    // 0-100: derived from DIRECT contradictions only
  coherenceScore: number | null;      // 0-100: from spectral analysis
  
  // LEGACY: Keep for backwards compatibility, but deprecate
  /** @deprecated Use groundednessScore instead */
  truth: number | null;
  consistency: number | null;
  coherence: number | null;
  overall: number | null;
  
      // Mode-aware scores (separated for clarity)
      modeAware?: {
        consistencyScore: number | null; // null if cannot be computed
        groundingScore: number;
        evidenceScore: number;
      };
};

/** Summary stats for UI display */
export type SummaryStats = {
  totalClaims: number;
  groundedClaims: number;            // Claims with grounding.kind !== "none"
  verifiedClaims: number;            // Claims with verification.status === "verified"
  directContradictions: number;      // Only "direct" type contradictions
  needsReviewCount: number;          // Claims/edges flagged for review
  hasExternalEvidence: boolean;      // Whether any external sources connected
};

export type GraphDebugInfo = {
  numClaims: number;
  numSources: number; // Renamed from numSourceClaims for clarity
  transcriptSourcesGenerated?: number; // Legacy: transcript-derived sources
  transcriptEvidenceNodes?: number; // NEW: unified graph builder transcript evidence nodes
  annEnabled: boolean;
  cacheEnabled: boolean;
  spectralEnabled: boolean;
  spectralDegraded?: boolean; // NEW: true if spectral ran with degraded quality
  spectralDegradedReason?: string; // NEW: reason for degraded spectral
  neighborK?: number;
  graphBuilderMode?: 'unified' | 'legacy' | 'truth-engine';
  graphStatus?: 'OK' | 'DEGRADED' | 'FAILED'; // NEW: unified graph status
  graphReasons?: string[]; // NEW: reasons for degraded/failed status
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
    supported: number;   // Claims with external evidence support
    contradicted: number; // Claims with contradiction edges
    unverified: number;   // Claims grounded in transcript but no external evidence
    ungrounded: number;   // Claims with no edges (isolated)
    total: number;
  };
};

export type ValidateOutput = {
  answer: string;
  refusal: boolean;
  
  // LEGACY scores (kept for backwards compatibility)
  scores: { truth: number | null; consistency: number | null; coherence: number | null; overall: number | null };
  
  // NEW: Enhanced scores that reflect reality
  enhancedScores?: EnhancedScores;
  summaryStats?: SummaryStats;
  
  scorerId?: string; // ID of the scorer used
  latency?: number; // Request latency in milliseconds
  cacheHitRate?: number; // Cache hit rate percentage (0-100)
  engineVersion?: string; // Engine version/commit hash
  
  report: {
    claims: Claim[];
    violations: Violation[];
    missingEvidence: { claimId: string; reason: string }[];
    contradictions: { claimA: string; claimB: string; reason: string }[];
    spectral?: SpectralReport & { spectralSkipped?: boolean; debugReason?: string; graphHealthDiagnostic?: any };
    
    // Graph edges from buildClaimGraph
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
    
    // NEW: Top review items - the "money" output
    reviewItems?: ReviewItem[];
    
    // Existing features
    suggestions?: Suggestion[];
    destructiveClaims?: DestructiveClaim[];
    trajectory?: TrajectoryReport;
    
    // AUDIT-CRITICAL: Run manifest for reproducibility
    manifest?: RunManifest;
  };
};

// Batch validation types
export type BatchValidateInput = {
  items: ValidateInput[];
  options?: ValidationOptions; // Shared options for all items
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
