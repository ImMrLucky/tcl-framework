/**
 * Local NLI scorer using transformers.js
 * Downloads model on first run, caches locally
 * No API keys needed, works out of box
 */

import type { SemanticScorer } from "./edge_builder.js";
import type { BatchPair, BatchScore } from "./edge_builder.js";

export class TransformersNliScorer implements SemanticScorer {
  id: string;
  private model: any = null;
  private modelName: string;
  private cacheDir: string;

  constructor(cfg: { modelName?: string; cacheDir?: string }) {
    this.modelName = cfg.modelName || "Xenova/deberta-v3-base";
    this.cacheDir = cfg.cacheDir || ".tcl_models";
    this.id = `transformers-${this.modelName.split("/").pop()}`;
    
    // Bind methods to preserve 'this' context
    this.loadModel = this.loadModel.bind(this);
    this.scoreBatch = this.scoreBatch.bind(this);
    this.entailment = this.entailment.bind(this);
    this.contradiction = this.contradiction.bind(this);
    this.grounding = this.grounding.bind(this);
  }

  private async loadModel() {
    if (this.model) return this.model;

    try {
      // Dynamic import to avoid bundling transformers.js if not used
      const { pipeline } = await import("@xenova/transformers");
      
      console.log(`Loading NLI model: ${this.modelName} (this may take a minute on first run)...`);
      
      // Pipeline downloads model on first run, caches locally
      this.model = await pipeline(
        "zero-shot-classification",
        this.modelName,
        {
          quantized: true, // Use quantized model (smaller, faster)
          cache_dir: this.cacheDir
        }
      );

      console.log(`✅ NLI model loaded: ${this.modelName}`);
      return this.model;
    } catch (error: any) {
      console.error(`Failed to load transformers model:`, error);
      throw new Error(`Failed to load NLI model: ${error.message}`);
    }
  }

  async scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]> {
    // Load model first and store reference
    const model = await this.loadModel();
    if (!model) {
      throw new Error("Failed to load NLI model");
    }

    const scores = await Promise.all(
      pairs.map(async (pair) => {
        const { task, a, b, key } = pair;

        try {
          // Format labels based on task
          let labels: string[];
          if (task === "entailment") {
            labels = ["entailment", "neutral", "contradiction"];
          } else if (task === "contradiction") {
            labels = ["contradiction", "neutral", "entailment"];
          } else if (task === "grounding") {
            labels = ["entailment", "neutral", "contradiction"];
          } else {
            return { key, score: 0.0 };
          }

          // Format input for NLI
          const input = `${a} [SEP] ${b}`;
          
          // Run inference using the loaded model
          const result = await model(input, labels);
          
          // Extract score for the relevant label
          const labelIndex = result.labels.indexOf(labels[0]);
          const score = result.scores[labelIndex] || 0.0;

          return { key, score: Math.max(0, Math.min(1, score)) };
        } catch (error: any) {
          console.error(`Error scoring pair ${key}:`, error);
          return { key, score: 0.0 };
        }
      })
    );

    return scores;
  }

  async entailment(premise: string, hypothesis: string): Promise<number> {
    const out = await this.scoreBatch([{ task: "entailment", a: premise, b: hypothesis, key: "0" }]);
    return Number(out[0]?.score ?? 0);
  }

  async contradiction(a: string, b: string): Promise<number> {
    const out = await this.scoreBatch([{ task: "contradiction", a, b, key: "0" }]);
    return Number(out[0]?.score ?? 0);
  }

  async grounding(claim: string, sourceText: string): Promise<{ score: number; quote?: string }> {
    const out = await this.scoreBatch([{ task: "grounding", a: claim, b: sourceText, key: "0" }]);
    return { score: Number(out[0]?.score ?? 0) };
  }
}

