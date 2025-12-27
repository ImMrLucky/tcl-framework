import type { LLMAdapter } from "./adapters/llm_adapter";

export type Source = { id: string; text: string };

export type Claim = {
  id: string;
  text: string;
  confidence: number; // 0..1
  evidence: { source_id: string; quote?: string; span?: string; weight?: number }[];
};

export type Violation =
  | { type: "MISSING_EVIDENCE"; claimId: string; detail: string }
  | { type: "CONTRADICTION"; claimA: string; claimB: string; detail: string }
  | { type: "LOW_CONFIDENCE"; claimId: string; detail: string };

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
  maxPairwiseEdges?: number; // cap O(n^2)
  neighborK?: number; // candidates per claim
  batchSize?: number; // NLI scoring batch size
  cachePersistPath?: string; // optional JSONL cache path
  annIndex?: 'hnsw' | 'bruteforce'; // ANN index choice
  annNeighborK?: number; // alias for neighborK

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

export type ValidateOutput = {
  answer: string;
  refusal: boolean;
  scores: { truth: number; consistency: number; coherence: number; overall: number };
  scorerId?: string; // ID of the NLI scorer used (e.g., "transformers-deberta-v3-base", "token-heuristic-v1")
  report: {
    claims: Claim[];
    violations: Violation[];
    missingEvidence: { claimId: string; reason: string }[];
    contradictions: { claimA: string; claimB: string; reason: string }[];
    spectral?: SpectralReport;
    // Graph edges from buildClaimGraph
    graph?: {
      supports: SupportEdge[];
      contradictions: ContradictionEdge[];
      grounding: GroundingEdge[];
    };
  };
};
