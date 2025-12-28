/**
 * Local NLI scorer using transformers.js
 * Downloads model on first run, caches locally
 * No API keys needed, works out of box
 */

import type { SemanticScorer } from "./edge_builder.js";
import type { BatchPair, BatchScore } from "./edge_builder.js";

// Softmax helper for logits
function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map(x => Math.exp(x - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(x => x / sum);
}

export class TransformersNliScorer implements SemanticScorer {
  id: string;
  private model: any = null;
  private modelName: string;
  private cacheDir: string;
  public labelMap: Record<string, string> = {}; // Expose label map for debug

  constructor(cfg: { modelName?: string; cacheDir?: string }) {
    // Default to roberta-large-mnli (best for NLI tasks, specifically trained for MNLI)
    // Can override with TCL_LOCAL_NLI_MODEL env var or pass modelName
    // roberta-large-mnli is trained on Multi-Genre Natural Language Inference dataset
    this.modelName = cfg.modelName || process.env.TCL_LOCAL_NLI_MODEL || "Xenova/roberta-large-mnli";
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
      // Set environment variable BEFORE import to force WASM-only mode
      // This prevents onnxruntime-node from trying to load native bindings
      if (typeof process !== 'undefined' && process.env) {
        process.env.USE_WASM = '1';
        // Prevent onnxruntime-node from being used
        process.env.ONNXRUNTIME_EXECUTION_PROVIDERS = '';
      }
      
      // Dynamic import to avoid bundling transformers.js if not used
      const { pipeline, env } = await import("@xenova/transformers");
      
      // Force WASM backend to avoid native onnxruntime-node dependency
      // This prevents errors in containers that don't have native libraries
      if (env && env.backends && env.backends.onnx) {
        // Disable proxy mode and use WASM directly
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.numThreads = 1;
      }
      
      console.log(`Loading NLI model: ${this.modelName} (this may take a minute on first run)...`);
      
      // For MNLI models (like roberta-large-mnli), use text-classification pipeline
      // MNLI models are specifically trained for Natural Language Inference tasks
      // They expect premise-hypothesis pairs and return entailment/contradiction/neutral
      const isMnliModel = this.modelName.includes("mnli");
      const pipelineType = isMnliModel ? "text-classification" : "zero-shot-classification";
      
      this.model = await pipeline(
        pipelineType,
        this.modelName,
        {
          quantized: true, // Use quantized model (smaller, faster)
          cache_dir: this.cacheDir
        }
      );

      // Extract label map from model if available (for MNLI models)
      if (this.model?.model?.config?.id2label) {
        this.labelMap = this.model.model.config.id2label;
        console.log(`✅ Label map extracted:`, this.labelMap);
      } else if (this.model?.processor?.tokenizer?.model?.config?.id2label) {
        this.labelMap = this.model.processor.tokenizer.model.config.id2label;
        console.log(`✅ Label map extracted from tokenizer:`, this.labelMap);
      }

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

          // Format input based on model type
          const isMnliModel = this.modelName.includes("mnli");
          let result: any;
          
          if (isMnliModel) {
            // For MNLI models, use premise-hypothesis pair format
            // text-classification pipeline expects: { text: premise, text_pair: hypothesis }
            // This correctly represents a single pair, not a batch of two items
            result = await model({ text: a, text_pair: b });
          } else {
            // For zero-shot models, use formatted text with labels
            let input: string;
            if (task === "entailment") {
              input = `${a}. Therefore, ${b}`;
            } else if (task === "contradiction") {
              input = `${a}. However, ${b} contradicts this.`;
            } else {
              input = `${a}. This is supported by: ${b}`;
            }
            result = await model(input, labels);
          }
          
          // Extract score based on result format
          let score = 0.0;
          if (isMnliModel) {
            // MNLI text-classification returns: { label: "ENTAILMENT"|"CONTRADICTION"|"NEUTRAL", score: number }
            // OR: { logits: number[], ... } - need to map using id2label
            let label = "";
            let prob = 0.0;
            
            // Handle different result formats from transformers.js
            if (Array.isArray(result)) {
              // Sometimes returns array of results
              result = result[0];
            }
            
            if (result.label) {
              // Direct label format
              label = result.label.toUpperCase();
              prob = result.score || 0.0;
            } else if (result.logits && this.labelMap) {
              // Logits format - map using id2label
              const logits = Array.isArray(result.logits) ? result.logits : Object.values(result.logits);
              const probs = softmax(logits);
              
              // Build label->prob map using id2label
              const labelProb: Record<string, number> = {};
              for (let i = 0; i < probs.length; i++) {
                const labelRaw = (this.labelMap[String(i)] || "").toLowerCase();
                labelProb[labelRaw] = probs[i];
              }
              
              // Normalize possible variants
              const entail = labelProb["entailment"] ?? labelProb["entails"] ?? 0;
              const contra = labelProb["contradiction"] ?? labelProb["contradicts"] ?? 0;
              const neutral = labelProb["neutral"] ?? 0;
              
              // Use the appropriate probability based on task
              if (task === "entailment") {
                prob = entail;
                label = "ENTAILMENT";
              } else if (task === "contradiction") {
                prob = contra;
                label = "CONTRADICTION";
              } else if (task === "grounding") {
                prob = entail + neutral * 0.5; // Entailment is strong, neutral is weak
                label = entail > neutral ? "ENTAILMENT" : "NEUTRAL";
              }
            } else {
              // Fallback: try to extract from result
              label = (result.label || "").toUpperCase();
              prob = result.score || 0.0;
            }
            
            // Map label to score based on task
            if (task === "entailment" && (label === "ENTAILMENT" || label.includes("ENTAIL"))) {
              score = prob;
            } else if (task === "contradiction" && (label === "CONTRADICTION" || label.includes("CONTRAD"))) {
              score = prob;
            } else if (task === "grounding") {
              if (label === "ENTAILMENT" || label.includes("ENTAIL")) {
                score = prob;
              } else if (label === "NEUTRAL") {
                score = prob * 0.5; // Neutral is weaker support
              }
            } else {
              // Label doesn't match task - score is 0.0 (correct behavior)
              // But log it for debugging
              if (pairs.indexOf(pair) < 3) {
                console.log(`  [MNLI] Task=${task} but label=${label}, prob=${prob.toFixed(3)} → score=0.0`);
              }
            }
          } else {
            // Zero-shot returns: { labels: string[], scores: number[] }
            const labelIndex = result.labels?.indexOf(labels[0]) ?? -1;
            score = labelIndex >= 0 && result.scores?.[labelIndex] !== undefined
              ? result.scores[labelIndex]
              : 0.0;
          }
          
          // Enhanced debug logging - log more samples to see what's happening
          const pairIndex = pairs.indexOf(pair);
          if (pairIndex < 5 || Math.random() < 0.1) { // Log first 5 or 10% randomly
            if (isMnliModel) {
              const logLabel = (result as any).label || 'N/A';
              const logProb = (result as any).score || 0.0;
              console.log(`[TransformersNliScorer] ${task} #${pairIndex}: "${a.substring(0, 40)}..." -> "${b.substring(0, 40)}..." | score=${score.toFixed(3)} | label=${logLabel} | prob=${logProb.toFixed(3)}`);
            } else {
              console.log(`[TransformersNliScorer] ${task} #${pairIndex}: "${a.substring(0, 40)}..." -> "${b.substring(0, 40)}..." | score=${score.toFixed(3)}`);
              if (result.labels && result.scores) {
                console.log(`  All scores: ${result.labels.map((l: string, i: number) => `${l}=${result.scores[i].toFixed(3)}`).join(', ')}`);
              }
            }
          }

          const finalScore = Math.max(0, Math.min(1, score));
          if (pairIndex < 3 && finalScore === 0.0 && task !== "grounding") {
            console.warn(`  ⚠️ Zero score for ${task} - this pair will not create an edge`);
          }
          
          return { key, score: finalScore };
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

