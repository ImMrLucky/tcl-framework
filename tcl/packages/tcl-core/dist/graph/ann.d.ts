/**
 * ANN + Embeddings design for production candidate pruning.
 *
 * This file provides a plug-in interface:
 * - EmbeddingProvider: getVector(text) => Float32Array
 * - CandidateIndex: add(id, vector), query(vector, k) => neighbor ids
 *
 * Included:
 * - SparseHashEmbeddingProvider (no deps): for dev / bootstrap
 * - BruteForceIndex (no deps): for small n
 * - Optional HnswIndex: uses hnswlib-node if installed (graceful fallback)
 *
 * For scale (thousands+ claims), use:
 * - OpenAI embeddings + HNSW, or
 * - local SBERT + FAISS, or
 * - pgvector (Postgres) + ivfflat/hnsw indexes.
 */
export type EmbeddingProvider = {
    id: string;
    dim: number;
    embed(texts: string[]): Promise<Float32Array[]>;
};
export declare class SparseHashEmbeddingProvider implements EmbeddingProvider {
    id: string;
    dim: number;
    embed(texts: string[]): Promise<Float32Array[]>;
}
export type CandidateIndex = {
    name: string;
    add(ids: string[], vectors: Float32Array[]): Promise<void>;
    query(vector: Float32Array, k: number): Promise<string[]>;
};
export declare class BruteForceIndex implements CandidateIndex {
    name: string;
    private ids;
    private vecs;
    add(ids: string[], vectors: Float32Array[]): Promise<void>;
    query(vector: Float32Array, k: number): Promise<string[]>;
}
/**
 * Optional HNSW index wrapper.
 * Install: npm i hnswlib-node
 */
export declare class HnswIndex implements CandidateIndex {
    private cfg;
    name: string;
    private idx;
    private dim;
    private idList;
    private ready;
    constructor(dim: number, cfg?: {
        M?: number;
        efConstruction?: number;
        efSearch?: number;
    });
    private ensure;
    add(ids: string[], vectors: Float32Array[]): Promise<void>;
    query(vector: Float32Array, k: number): Promise<string[]>;
}
