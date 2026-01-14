/**
 * Evidence Embeddings
 * Creates embeddings for evidence chunks using OpenAI or fallback methods
 */
export interface EmbeddingResult {
    embedding: number[];
    model: string;
}
/**
 * Create embedding for text
 * Uses OpenAI API if available, otherwise uses free hash-based fallback
 * The fallback works without any external services but provides keyword-based similarity, not semantic similarity
 */
export declare function createEmbedding(text: string, options?: {
    apiKey?: string;
    model?: string;
}): Promise<EmbeddingResult>;
/**
 * Create embeddings for multiple texts in batch (if API supports it)
 */
export declare function createEmbeddingsBatch(texts: string[], options?: {
    apiKey?: string;
    model?: string;
    batchSize?: number;
}): Promise<EmbeddingResult[]>;
