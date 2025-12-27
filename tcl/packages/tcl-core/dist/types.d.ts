import type { LLMAdapter } from "./adapters/llm_adapter";
export type Source = {
    id: string;
    text: string;
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
    maxPairwiseEdges?: number;
    neighborK?: number;
    batchSize?: number;
    cachePersistPath?: string;
    annIndex?: 'hnsw' | 'bruteforce';
    annNeighborK?: number;
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
    scores: {
        truth: number;
        consistency: number;
        coherence: number;
        overall: number;
    };
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
        spectral?: SpectralReport;
    };
};
