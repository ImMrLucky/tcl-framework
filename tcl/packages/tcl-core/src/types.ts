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
  numSourceClaims: number;
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
  scores: { truth: number; consistency: number; coherence: number | null; overall: number };
  scorerId?: string; // ID of the NLI scorer used (e.g., "transformers-deberta-v3-base", "token-heuristic-v1")
  latency?: number; // Request latency in milliseconds
  cacheHitRate?: number; // Cache hit rate percentage (0-100)
  engineVersion?: string; // Engine version/commit hash
  report: {
    claims: Claim[];
    violations: Violation[];
    missingEvidence: { claimId: string; reason: string }[];
    contradictions: { claimA: string; claimB: string; reason: string }[];
    spectral?: SpectralReport & { spectralSkipped?: boolean; debugReason?: string };
    // Graph edges from buildClaimGraph
    graph?: {
      supports: SupportEdge[];
      contradictions: ContradictionEdge[];
      grounding: GroundingEdge[];
      debug?: GraphDebugInfo;
    };
    // New features
    suggestions?: Suggestion[]; // Actionable suggestions for fixing issues
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
