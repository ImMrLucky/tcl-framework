// Types matching TCL framework output
export type Source = { id: string; text: string };

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

export type ValidateOutput = {
  answer: string;
  refusal: boolean;
  scores: { truth: number; consistency: number; coherence: number; overall: number };
  report: {
    claims: Claim[];
    violations: any[];
    missingEvidence: { claimId: string; reason: string }[];
    contradictions: { claimA: string; claimB: string; reason: string }[];
    spectral?: SpectralReport;
  };
};

export type ValidationOptions = {
  spectral?: boolean;
  ann?: boolean;
  cache?: boolean;
  spectralServiceUrl?: string;
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

