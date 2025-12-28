import { Claim, Source, SupportEdge, ContradictionEdge, GroundingEdge } from "../types.js";
import { EmbeddingProvider } from "./ann.js";
/**
 * PRODUCTION EDGE BUILDER (ANN + CACHE)
 *
 * Improvements:
 * - ANN-based candidate retrieval (HNSW if available, else brute-force) fed by embeddings provider.
 * - Persistent, versioned cache for NLI scores (entailment/contradiction/grounding) with TTL + file-backed JSONL.
 * - True batch scoring support (HttpNliScorer.scoreBatch).
 *
 * This is the module you harden and protect. It is a major part of your moat.
 */
export type ClaimGraph = {
    supports: SupportEdge[];
    contradictions: ContradictionEdge[];
    grounding: GroundingEdge[];
    groundedClaimIds: string[];
    cacheStats?: {
        hits: number;
        misses: number;
        total: number;
        hitRate: number;
    };
    debug?: {
        numClaims: number;
        numSources: number;
        annEnabled: boolean;
        cacheEnabled: boolean;
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
};
export type ScoreTask = "entailment" | "contradiction" | "grounding";
export type BatchPair = {
    task: ScoreTask;
    a: string;
    b: string;
    key: string;
};
export type BatchScore = {
    key: string;
    score: number;
    quote?: string;
};
export interface SemanticScorer {
    id: string;
    entailment(premise: string, hypothesis: string): Promise<number>;
    contradiction(a: string, b: string): Promise<number>;
    grounding(claim: string, sourceText: string): Promise<{
        score: number;
        quote?: string;
    }>;
    scoreBatch?(pairs: BatchPair[]): Promise<BatchScore[]>;
}
export interface SemanticScorerWithBatch extends SemanticScorer {
    scoreBatch: (pairs: BatchPair[]) => Promise<BatchScore[]>;
}
export type AnnConfig = {
    provider?: EmbeddingProvider;
    index?: "hnsw" | "bruteforce";
    neighborK?: number;
    hnsw?: {
        M?: number;
        efConstruction?: number;
        efSearch?: number;
    };
};
export type EdgeBuilderCacheConfig = {
    enabled?: boolean;
    ttlSeconds?: number;
    persistPath?: string;
    maxEntries?: number;
};
export type EdgeBuilderOptions = {
    scorer?: SemanticScorer;
    supportThreshold?: number;
    contradictionThreshold?: number;
    groundingThreshold?: number;
    topGroundingK?: number;
    maxPairwiseEdges?: number;
    batchSize?: number;
    ann?: AnnConfig;
    cache?: EdgeBuilderCacheConfig;
};
export declare class TokenHeuristicScorer implements SemanticScorer {
    id: string;
    private overlap;
    entailment(premise: string, hypothesis: string): Promise<number>;
    contradiction(a: string, b: string): Promise<number>;
    grounding(claim: string, sourceText: string): Promise<{
        score: number;
        quote?: string;
    }>;
}
/**
 * HTTP scorer with batching. You operate this service.
 */
export declare class HttpNliScorer implements SemanticScorer {
    private cfg;
    id: string;
    constructor(cfg: {
        endpoint: string;
        apiKey?: string;
        timeoutMs?: number;
        modelId: string;
    });
    private post;
    scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]>;
    entailment(premise: string, hypothesis: string): Promise<number>;
    contradiction(a: string, b: string): Promise<number>;
    grounding(claim: string, sourceText: string): Promise<{
        score: number;
        quote?: string;
    }>;
}
/**
 * Built-in Mistral API scorer. Auto-enabled if MISTRAL_API_KEY is set.
 * No separate service deployment needed.
 */
export declare class MistralNliScorer implements SemanticScorer {
    id: string;
    private apiKey;
    private model;
    private endpoint;
    constructor(cfg: {
        apiKey: string;
        model?: string;
        endpoint?: string;
    });
    private callMistral;
    scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]>;
    entailment(premise: string, hypothesis: string): Promise<number>;
    contradiction(a: string, b: string): Promise<number>;
    grounding(claim: string, sourceText: string): Promise<{
        score: number;
        quote?: string;
    }>;
}
export declare function buildClaimGraph(claims: Claim[], sources: Source[] | undefined, opts?: EdgeBuilderOptions): Promise<ClaimGraph>;
