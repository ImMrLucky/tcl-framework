import { Claim, Source, SupportEdge, ContradictionEdge, GroundingEdge } from "../types.js";
import { EmbeddingProvider, SparseHashEmbeddingProvider, CandidateIndex, BruteForceIndex, HnswIndex } from "./ann.js";
import { SemanticCache, NoopCache, type CacheLike } from "./cache.js";

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
  cacheStats?: { hits: number; misses: number; total: number; hitRate: number };
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

export type BatchPair = { task: ScoreTask; a: string; b: string; key: string };
export type BatchScore = { key: string; score: number; quote?: string };

export interface SemanticScorer {
  id: string; // model/version id (used for cache keys)
  entailment(premise: string, hypothesis: string): Promise<number>;
  contradiction(a: string, b: string): Promise<number>;
  grounding(claim: string, sourceText: string): Promise<{ score: number; quote?: string }>;
  scoreBatch?(pairs: BatchPair[]): Promise<BatchScore[]>;
}

// Helper type for scorers that have scoreBatch
export interface SemanticScorerWithBatch extends SemanticScorer {
  scoreBatch: (pairs: BatchPair[]) => Promise<BatchScore[]>;
}

export type AnnConfig = {
  provider?: EmbeddingProvider;
  index?: "hnsw" | "bruteforce";
  neighborK?: number;
  // HNSW knobs
  hnsw?: { M?: number; efConstruction?: number; efSearch?: number };
};

export type EdgeBuilderCacheConfig = {
  enabled?: boolean;
  ttlSeconds?: number;
  persistPath?: string;  // e.g. ".tcl_cache/semantic.jsonl"
  maxEntries?: number;
};

export type EdgeBuilderOptions = {
  scorer?: SemanticScorer;

  // thresholds
  supportThreshold?: number;
  contradictionThreshold?: number;
  groundingThreshold?: number;

  // grounding
  topGroundingK?: number;

  // pruning
  maxPairwiseEdges?: number; // hard cap on scored claim-claim pairs

  // batching
  batchSize?: number;

  // ANN
  ann?: AnnConfig;

  // cache
  cache?: EdgeBuilderCacheConfig;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

async function runBatches<T>(items: T[], batchSize: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize));
  }
}

/**
 * Baseline heuristic scorer (dev only).
 */
function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export class TokenHeuristicScorer implements SemanticScorer {
  id = "token-heuristic-v1";
  private overlap(a: string, b: string): number {
    const A = new Set(normalize(a).split(" ").filter((w) => w.length >= 4));
    const B = new Set(normalize(b).split(" ").filter((w) => w.length >= 4));
    if (A.size === 0) return 0;
    let hit = 0;
    for (const w of A) if (B.has(w)) hit++;
    return hit / Math.max(1, A.size);
  }
  async entailment(premise: string, hypothesis: string): Promise<number> {
    return this.overlap(hypothesis, premise);
  }
  async contradiction(a: string, b: string): Promise<number> {
    const na = normalize(a);
    const nb = normalize(b);
    const aHasNot = /\bnot\b|\bis not\b/.test(na);
    const bHasNot = /\bnot\b|\bis not\b/.test(nb);
    const coreA = na.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");
    const coreB = nb.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");
    if (this.overlap(coreA, coreB) >= 0.75 && aHasNot !== bHasNot) return 0.95;
    return 0.05;
  }
  async grounding(claim: string, sourceText: string): Promise<{ score: number; quote?: string }> {
    const sentences = sourceText.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    let best = { score: 0, quote: undefined as string | undefined };
    for (const s of sentences) {
      const sc = this.overlap(claim, s);
      if (sc > best.score) best = { score: sc, quote: s.slice(0, 240) };
    }
    return best;
  }
}

/**
 * HTTP scorer with batching. You operate this service.
 */
export class HttpNliScorer implements SemanticScorer {
  id: string;
  constructor(private cfg: { endpoint: string; apiKey?: string; timeoutMs?: number; modelId: string }) {
    this.id = cfg.modelId;
  }

  private async post(payload: any) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 20000);
    try {
      const res = await fetch(this.cfg.endpoint.replace(/\/$/, "") + "/score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {})
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`NLI endpoint error ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]> {
    const data = await this.post({ pairs });
    const scores = (data.scores ?? []) as Array<any>;
    return scores.map((s) => ({ key: String(s.key), score: Number(s.score ?? 0), quote: s.quote }));
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
    return { score: Number(out[0]?.score ?? 0), quote: out[0]?.quote };
  }
}

/**
 * Built-in Mistral API scorer. Auto-enabled if MISTRAL_API_KEY is set.
 * No separate service deployment needed.
 */
export class MistralNliScorer implements SemanticScorer {
  id: string;
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(cfg: { apiKey: string; model?: string; endpoint?: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model || "mistral-small-latest";
    this.endpoint = cfg.endpoint || "https://api.mistral.ai/v1";
    this.id = `mistral-${this.model}`;
  }

  private async callMistral(prompt: string): Promise<number> {
    try {
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 10
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Mistral API error ${response.status}: ${error}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim() || "0.0";
      
      // Extract number from response (handle cases like "0.85" or "The score is 0.85")
      const match = content.match(/(\d+\.?\d*)/);
      return match ? Math.max(0, Math.min(1, parseFloat(match[1]))) : 0.0;
    } catch (error: any) {
      console.error("Mistral API error:", error);
      throw error;
    }
  }

  async scoreBatch(pairs: BatchPair[]): Promise<BatchScore[]> {
    // Mistral API doesn't support true batching, so we parallelize individual calls
    const scores = await Promise.all(
      pairs.map(async (pair) => {
        const { task, a, b, key } = pair;
        
        let prompt: string;
        if (task === "entailment") {
          prompt = `Given the premise: "${a}"\n\nDoes this hypothesis follow from the premise: "${b}"?\n\nRespond with ONLY a number between 0.0 and 1.0, where 1.0 means the hypothesis definitely follows from the premise, and 0.0 means it does not follow at all.`;
        } else if (task === "contradiction") {
          prompt = `Do these two statements contradict each other?\n\nStatement A: "${a}"\nStatement B: "${b}"\n\nRespond with ONLY a number between 0.0 and 1.0, where 1.0 means they strongly contradict, and 0.0 means they do not contradict.`;
        } else if (task === "grounding") {
          prompt = `Does this source text support this claim?\n\nClaim: "${a}"\nSource: "${b}"\n\nRespond with ONLY a number between 0.0 and 1.0, where 1.0 means the source strongly supports the claim, and 0.0 means it does not support it.`;
        } else {
          return { key, score: 0.0 };
        }

        try {
          const score = await this.callMistral(prompt);
          return { key, score };
        } catch (error) {
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

async function buildIndexForClaims(
  claims: Claim[],
  ann: AnnConfig | undefined
): Promise<{ provider: EmbeddingProvider; index: CandidateIndex; vectors: Float32Array[] }> {
  const provider = ann?.provider ?? new SparseHashEmbeddingProvider();
  const vectors = await provider.embed(claims.map(c => c.text));

  const kind = ann?.index ?? "hnsw";
  let index: CandidateIndex;

  if (kind === "hnsw") {
    try {
      index = new HnswIndex(provider.dim, ann?.hnsw);
    } catch {
      index = new BruteForceIndex();
    }
  } else {
    index = new BruteForceIndex();
  }

  await index.add(claims.map(c => c.id), vectors);
  return { provider, index, vectors };
}

// Type guard to check if scorer has scoreBatch method
function hasScoreBatch(scorer: SemanticScorer): scorer is SemanticScorerWithBatch {
  return 'scoreBatch' in scorer && typeof (scorer as any).scoreBatch === 'function';
}

export async function buildClaimGraph(
  claims: Claim[],
  sources: Source[] | undefined,
  opts: EdgeBuilderOptions = {}
): Promise<ClaimGraph> {
  const n = claims.length; // Declare n early for use throughout function
  const scorer: SemanticScorer = opts.scorer ?? new TokenHeuristicScorer();
  const tSup = opts.supportThreshold ?? 0.58;
  const tCon = opts.contradictionThreshold ?? 0.70;
  const tGnd = opts.groundingThreshold ?? 0.60;
  const topGroundingK = opts.topGroundingK ?? 1;

  const neighborK = opts.ann?.neighborK ?? 12;
  const maxPairs = opts.maxPairwiseEdges ?? 6000;
  const batchSize = opts.batchSize ?? 256;
  const potentialPairs = n > 1 ? n * (n - 1) : 0; // All possible directed pairs

  // Cache: versioned, model-aware (or no-op if disabled)
  const cacheEnabled = opts.cache?.enabled ?? true;
  const makeKeyFn = (task: "ent"|"con"|"gnd", a: string, b: string) => {
    const payload = `tcl|v1|${scorer.id}|${task}|${a.toLowerCase().replace(/\s+/g, " ").trim()}|${b.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const { createHash } = require("crypto");
    return createHash("sha256").update(payload).digest("hex");
  };
  
  const cache: CacheLike = cacheEnabled
    ? (new SemanticCache({
        namespace: "tcl",
        version: "v1",
        model: scorer.id,
        ttlSeconds: opts.cache?.ttlSeconds ?? 60 * 60 * 24 * 7, // 7 days default
        persistPath: opts.cache?.persistPath,
        maxEntries: opts.cache?.maxEntries ?? 250000
      }) as unknown as CacheLike)
    : new NoopCache(makeKeyFn);
  
  if (cacheEnabled) {
    await cache.loadIfNeeded();
  }

  const grounding: GroundingEdge[] = [];
  const groundedClaimIds: string[] = [];
  
  // Debug tracking (declare early)
  let filteredBelowGrounding = 0;

  // -----------------------------
  // Grounding (claim -> sources)
  // -----------------------------
  if (sources?.length) {
    // batch score grounding where possible
    // Check if scorer has scoreBatch method (optional property)
    if (scorer && 'scoreBatch' in scorer && typeof (scorer as any).scoreBatch === 'function') {
      const pairs: BatchPair[] = [];
      for (const c of claims) {
        for (const s of sources) {
          const key = cache.makeKey("gnd", c.text, s.text);
          if (!cache.get(key)) pairs.push({ task: "grounding", a: c.text, b: s.text, key });
        }
      }
      const scoreBatchFn = (scorer as any).scoreBatch as (pairs: BatchPair[]) => Promise<BatchScore[]>;
      await runBatches(pairs, batchSize, async (batch) => {
        const out = await scoreBatchFn(batch);
        for (const r of out) cache.set(r.key, r.score, r.quote);
      });
    }

    for (const c of claims) {
      const scored: Array<{ sid: string; sc: number; quote?: string }> = [];
      for (const s of sources) {
        const key = cache.makeKey("gnd", c.text, s.text);
        const hit = cache.get(key);
        if (hit) {
          scored.push({ sid: s.id, sc: hit.v, quote: hit.quote });
        } else {
          const r = await scorer.grounding(c.text, s.text);
          cache.set(key, r.score, r.quote);
          scored.push({ sid: s.id, sc: r.score, quote: r.quote });
        }
      }
      scored.sort((a, b) => b.sc - a.sc);
      const top = scored.slice(0, Math.max(1, topGroundingK));
      for (const t of top) {
        if (t.sc >= tGnd) {
          grounding.push({ claimId: c.id, sourceId: t.sid, weight: clamp01(t.sc), quote: t.quote });
          groundedClaimIds.push(c.id);
        } else {
          filteredBelowGrounding++;
        }
      }
    }
  }

  // -----------------------------
  // Pair generation: brute force for small n, ANN for large n
  // CRITICAL: Always generate pairs when n > 1, even without sources
  // -----------------------------
  const SMALL_N = 50;
  const useANN = opts.ann?.index !== undefined && opts.ann.index !== "bruteforce" && n > SMALL_N;
  
  const candPairs: Array<{ i: number; j: number }> = [];
  const idToIdx = new Map<string, number>();
  claims.forEach((c, i) => idToIdx.set(c.id, i));

  // Step A: Generate pairs - brute force for small n, ANN for large n
  if (n <= SMALL_N || !useANN) {
    // Brute force: generate all directed pairs (i, j) where i != j
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          candPairs.push({ i, j });
          if (candPairs.length >= maxPairs) break;
        }
      }
      if (candPairs.length >= maxPairs) break;
    }
  } else {
    // ANN path for large n
    const { index, vectors } = await buildIndexForClaims(claims, opts.ann);
    const K = Math.min(neighborK, n - 1); // Clamp K to n-1
    
    for (let i = 0; i < n; i++) {
      const neighIds = await index.query(vectors[i], K);
      for (const nid of neighIds) {
        const j = idToIdx.get(nid);
        if (j === undefined || j === i) continue; // Remove self AFTER getting candidates
        candPairs.push({ i, j });
        if (candPairs.length >= maxPairs) break;
      }
      if (candPairs.length >= maxPairs) break;
    }
  }

  // Dedupe pairs
  const seen = new Set<string>();
  const dedupedPairs: Array<{ i: number; j: number }> = [];
  for (const { i, j } of candPairs) {
    const k = `${i}->${j}`;
    if (!seen.has(k)) {
      seen.add(k);
      dedupedPairs.push({ i, j });
    }
  }
  const finalPairs = dedupedPairs.slice(0, maxPairs);

  // -----------------------------
  // Step B: Always run claim↔claim NLI scoring (even without sources)
  // -----------------------------
  const supports: SupportEdge[] = [];
  const contradictions: ContradictionEdge[] = [];
  
  // Debug tracking (continued)
  let pairsScored = 0;
  let filteredBelowSupport = 0;
  let filteredBelowContradiction = 0;
  let droppedByMaxEdges = 0;

  // Batch score contradictions + entailments with cache
  const pairsToScore: BatchPair[] = [];
  for (const { i, j } of finalPairs) {
    const A = claims[i].text;
    const B = claims[j].text;

    const kCon = cache.makeKey("con", A, B);
    if (!cache.get(kCon)) pairsToScore.push({ task: "contradiction", a: A, b: B, key: kCon });

    const kEnt = cache.makeKey("ent", A, B);
    if (!cache.get(kEnt)) pairsToScore.push({ task: "entailment", a: A, b: B, key: kEnt });
  }

  // Check if scorer has scoreBatch method
  if (scorer && 'scoreBatch' in scorer && typeof (scorer as any).scoreBatch === 'function' && pairsToScore.length) {
    const scoreBatchFn = (scorer as any).scoreBatch as (pairs: BatchPair[]) => Promise<BatchScore[]>;
    await runBatches(pairsToScore, batchSize, async (batch) => {
      const out = await scoreBatchFn(batch);
      for (const r of out) cache.set(r.key, r.score, r.quote);
    });
  }

  // Score all pairs and build edges
  for (const { i, j } of finalPairs) {
    const A = claims[i];
    const B = claims[j];

    // Score contradiction
    const kCon = cache.makeKey("con", A.text, B.text);
    const conHit = cache.get(kCon);
    const con = conHit ? conHit.v : await scorer.contradiction(A.text, B.text);
    if (!conHit) cache.set(kCon, con);
    
    pairsScored++;
    if (con >= tCon) {
      contradictions.push({ claimA: A.id, claimB: B.id, weight: clamp01(con) });
    } else {
      filteredBelowContradiction++;
    }

    // Score entailment (support)
    const kEnt = cache.makeKey("ent", A.text, B.text);
    const entHit = cache.get(kEnt);
    const ent = entHit ? entHit.v : await scorer.entailment(A.text, B.text);
    if (!entHit) cache.set(kEnt, ent);
    
    if (ent >= tSup) {
      supports.push({ claimA: A.id, claimB: B.id, weight: clamp01(ent) });
    } else {
      filteredBelowSupport++;
    }
  }
  
  // Track dropped edges: potential pairs minus actual pairs generated
  // For brute force: potentialPairs = n*(n-1)
  // For ANN: potentialPairs = n*K (where K is neighborK)
  const annPotentialPairs = useANN ? n * Math.min(neighborK, n - 1) : potentialPairs;
  const actualPotentialPairs = useANN ? annPotentialPairs : potentialPairs;
  droppedByMaxEdges = Math.max(0, actualPotentialPairs - finalPairs.length);

  // dedupe contradictions (ordered)
  const conMap = new Map<string, number>();
  for (const e of contradictions) conMap.set(`${e.claimA}::${e.claimB}`, Math.max(conMap.get(`${e.claimA}::${e.claimB}`) ?? 0, e.weight));
  const contradictionsDedup = [...conMap.entries()].map(([k, w]) => {
    const [claimA, claimB] = k.split("::");
    return { claimA, claimB, weight: w };
  });

  if (cacheEnabled) {
    await cache.flush();
  }
  const cacheStats = cacheEnabled ? cache.getStats() : undefined;
  
  // Determine reason if empty graph
  let reasonIfEmptyGraph: string | null = null;
  if (supports.length === 0 && contradictions.length === 0 && grounding.length === 0) {
    if (finalPairs.length === 0) {
      reasonIfEmptyGraph = n <= 1 ? "only_one_claim" : "no_candidates_generated";
    } else if (pairsScored === 0) {
      reasonIfEmptyGraph = "pairwise_scoring_disabled";
    } else if (filteredBelowSupport + filteredBelowContradiction === pairsScored * 2) {
      reasonIfEmptyGraph = "all_probs_below_threshold";
    } else if (droppedByMaxEdges > 0) {
      reasonIfEmptyGraph = "edges_dropped_by_cap";
    } else {
      reasonIfEmptyGraph = "unknown_reason";
    }
  }
  
  // Get label map from scorer if available
  const labelMap = (scorer as any).labelMap as Record<string, string> | undefined;
  
  const debug = {
    numClaims: n,
    numSources: sources?.length || 0, // Renamed from numSourceClaims
    annEnabled: useANN,
    cacheEnabled: cacheEnabled,
    spectralEnabled: false, // Will be set by orchestrator
    neighborK: neighborK,
    supportThreshold: tSup,
    contradictionThreshold: tCon,
    groundingThreshold: tGnd,
    pairsGenerated: finalPairs.length,
    pairsScored: pairsScored,
    edges: {
      supportsAdded: supports.length,
      contradictionsAdded: contradictionsDedup.length,
      groundingAdded: grounding.length
    },
    filtered: {
      belowSupportThreshold: filteredBelowSupport,
      belowContradictionThreshold: filteredBelowContradiction,
      belowGroundingThreshold: filteredBelowGrounding,
      droppedByMaxEdges: droppedByMaxEdges
    },
    model: {
      scorerId: scorer.id,
      labelMap: labelMap
    },
    reasonIfEmptyGraph: reasonIfEmptyGraph
  };
  
  return { 
    supports, 
    contradictions: contradictionsDedup, 
    grounding, 
    groundedClaimIds,
    cacheStats,
    debug
  };
}
