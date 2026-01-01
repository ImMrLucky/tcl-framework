/**
 * NLI scorer that calls the Spectral Python service.
 * 
 * This avoids the native onnxruntime issues in Node.js containers
 * by delegating NLI to the Python service which handles transformers natively.
 */

import type { SemanticScorer, BatchPair, BatchScore } from "./edge_builder.js";

interface NliScore {
  key?: string;
  entailment: number;
  neutral: number;
  contradiction: number;
}

interface NliBatchResponse {
  scores: NliScore[];
  model: string;
}

export class SpectralNliScorer implements SemanticScorer {
  id = "spectral-nli-roberta-large-mnli";
  private endpoint: string;
  private timeoutMs: number;

  constructor(cfg: { endpoint?: string; timeoutMs?: number } = {}) {
    // Use spectral URL and add /nli/score path
    const spectralUrl = cfg.endpoint || process.env.TCL_SPECTRAL_URL || "";
    this.endpoint = spectralUrl.replace(/\/$/, "") + "/nli/score";
    this.timeoutMs = cfg.timeoutMs ?? 30000;
    
    if (!spectralUrl) {
      console.warn("⚠️ SpectralNliScorer: No TCL_SPECTRAL_URL configured");
    } else {
      console.log(`🔌 SpectralNliScorer initialized: ${this.endpoint}`);
    }
  }

  async scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]> {
    if (pairs.length === 0) {
      return [];
    }

    // Convert to the format the spectral service expects
    const payload = {
      pairs: pairs.map((p, i) => ({
        premise: p.a,
        hypothesis: p.b,
        key: p.key || `${i}`
      }))
    };

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`Spectral NLI endpoint error ${res.status}: ${errorText}`);
      }

      const data: NliBatchResponse = await res.json();
      
      // Map results back to BatchScore format based on task
      return pairs.map((pair, i) => {
        const nliScore = data.scores[i];
        if (!nliScore) {
          return { key: pair.key, score: 0 };
        }

        let score = 0;
        let quote: string | undefined;

        switch (pair.task) {
          case "entailment":
            score = nliScore.entailment;
            break;
          case "contradiction":
            score = nliScore.contradiction;
            break;
          case "grounding":
            // For grounding, we want entailment (source entails claim)
            score = nliScore.entailment;
            quote = pair.b.substring(0, 200); // The source text
            break;
          default:
            score = 0;
        }

        return { key: pair.key, score, quote };
      });

    } finally {
      clearTimeout(timeout);
    }
  }

  async entailment(premise: string, hypothesis: string): Promise<number> {
    const results = await this.scoreBatch([
      { task: "entailment", a: premise, b: hypothesis, key: "0" }
    ]);
    return results[0]?.score ?? 0;
  }

  async contradiction(a: string, b: string): Promise<number> {
    const results = await this.scoreBatch([
      { task: "contradiction", a, b, key: "0" }
    ]);
    return results[0]?.score ?? 0;
  }

  async grounding(claim: string, sourceText: string): Promise<{ score: number; quote?: string }> {
    const results = await this.scoreBatch([
      { task: "grounding", a: sourceText, b: claim, key: "0" }
    ]);
    return {
      score: results[0]?.score ?? 0,
      quote: sourceText.substring(0, 200)
    };
  }
}

