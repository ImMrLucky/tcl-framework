/**
 * Local NLI scorer using transformers.js
 * Downloads model on first run, caches locally
 * No API keys needed, works out of box
 *
 * CRITICAL: This scorer must correctly map NLI labels (LABEL_0/1/2) to semantic labels
 * (ENTAILMENT/NEUTRAL/CONTRADICTION) using the model's id2label config.
 */
import type { SemanticScorer } from "./edge_builder.js";
import type { BatchPair, BatchScore } from "./edge_builder.js";
export declare class TransformersNliScorer implements SemanticScorer {
    id: string;
    private model;
    private modelName;
    private cacheDir;
    labelMap: Record<string, string>;
    private labelMapInitialized;
    constructor(cfg: {
        modelName?: string;
        cacheDir?: string;
    });
    private loadModel;
    scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]>;
    entailment(premise: string, hypothesis: string): Promise<number>;
    contradiction(a: string, b: string): Promise<number>;
    grounding(claim: string, sourceText: string): Promise<{
        score: number;
        quote?: string;
    }>;
}
