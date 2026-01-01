import type { LLMAdapter } from "./adapters/llm_adapter";

export type Source = { id: string; text: string };

export type Claim = {
  id: string;
  text: string;
  confidence: number; // 0..1 (calculated confidence score)
  evidence: { source_id: string; quote?: string; span?: string; weight?: number }[];
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
    speaker?: string; // "Agent" | "Customer" | "Other"
    turnIndex?: number;
  };
};

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

  // Production knobs (graph)
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
  spectralMode?: "score" | "analyze"; // default "analyze" (use /spectral/analyze endpoint)
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

export type SupportEdge = { claimA: string; claimB: string; weight: number };
export type ContradictionEdge = { claimA: string; claimB: string; weight: number };
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

export type GraphDebugInfo = {
  numClaims: number;
  numSources: number; // Renamed from numSourceClaims for clarity
  transcriptSourcesGenerated?: number; // NEW: transcript-derived sources
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
  /** Code version */
  codeVersion: string;
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
  scores: { truth: number | null; consistency: number | null; coherence: number | null; overall: number | null };
  scorerId?: string; // ID of the NLI scorer used (e.g., "transformers-deberta-v3-base", "token-heuristic-v1")
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
      debug?: GraphDebugInfo;
    };
    // New features
    suggestions?: Suggestion[]; // Actionable suggestions for fixing issues
    destructiveClaims?: DestructiveClaim[]; // All destructive claims ranked by importance
    trajectory?: TrajectoryReport; // Trajectory scoring for transcripts
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
