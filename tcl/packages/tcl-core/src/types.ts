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

export type ValidateOutput = {
  answer: string;
  refusal: boolean;
  scores: { truth: number; consistency: number; coherence: number; overall: number };
  report: {
    claims: Claim[];
    violations: Violation[];
    missingEvidence: { claimId: string; reason: string }[];
    contradictions: { claimA: string; claimB: string; reason: string }[];
    spectral?: SpectralReport;
  };
};
