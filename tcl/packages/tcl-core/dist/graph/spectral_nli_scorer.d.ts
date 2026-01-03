/**
 * NLI scorer that calls the Spectral Python service.
 *
 * This avoids the native onnxruntime issues in Node.js containers
 * by delegating NLI to the Python service which handles transformers natively.
 */
import type { SemanticScorer, BatchPair, BatchScore } from "./edge_builder.js";
export declare class SpectralNliScorer implements SemanticScorer {
    id: string;
    private endpoint;
    private timeoutMs;
    constructor(cfg?: {
        endpoint?: string;
        timeoutMs?: number;
    });
    scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]>;
    entailment(premise: string, hypothesis: string): Promise<number>;
    contradiction(a: string, b: string): Promise<number>;
    grounding(claim: string, sourceText: string): Promise<{
        score: number;
        quote?: string;
    }>;
}
