// Types matching TCL framework output
export type Source = { id: string; text: string };

export type CallMetadata = {
  agentId?: string;
  customerId?: string;
  callDate?: string;
  duration?: number; // in minutes
};

export type Claim = {
  id: string;
  text: string;
  confidence: number;
  evidence: { source_id: string; quote?: string; span?: string; weight?: number }[];
};

export type SpectralReport = {
  coherenceScore: number;
  contradictionEnergy: number;
  supportEnergy: number;
  circularityScore: number;
  spectralGap: number;
  cycleMass?: number;
  heatTrace?: number[];
};

export type SupportEdge = { claimA: string; claimB: string; weight: number };
export type ContradictionEdge = { claimA: string; claimB: string; weight: number };
export type GroundingEdge = { claimId: string; sourceId: string; weight: number; quote?: string };

export type ValidateOutput = {
  answer: string;
  refusal: boolean;
  scores: { truth: number; consistency: number; coherence: number; overall: number };
  scorerId?: string; // ID of the NLI scorer used
  latency?: number; // Request latency in milliseconds
  cacheHitRate?: number; // Cache hit rate percentage (0-100)
  engineVersion?: string; // Engine version/commit hash
  report: {
    claims: Claim[];
    violations: any[];
    missingEvidence: { claimId: string; reason: string }[];
    contradictions: { claimA: string; claimB: string; reason: string }[];
    spectral?: SpectralReport;
    graph?: {
      supports: SupportEdge[];
      contradictions: ContradictionEdge[];
      grounding: GroundingEdge[];
    };
  };
};

export type ValidationOptions = {
  spectral?: boolean;
  ann?: boolean;
  cache?: boolean;
  spectralServiceUrl?: string;
  // Graph thresholds
  supportThreshold?: number;
  contradictionThreshold?: number;
  groundingThreshold?: number;
  maxPairwiseEdges?: number;
  neighborK?: number;
};

// Extended types for UI
export type ClaimWithMetadata = Claim & {
  grounded: boolean;
  supportCount: number;
  contradictionCount: number;
  inCycles: boolean;
};

export type GraphEdge = {
  from: string;
  to: string;
  type: 'support' | 'contradiction' | 'grounding';
  weight: number;
};

