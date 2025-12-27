import { Claim, Source } from "../types.js";
import { EmbeddingProvider, SparseHashEmbeddingProvider, CandidateIndex, BruteForceIndex, HnswIndex } from "./ann.js";
import { SemanticCache } from "./cache.js";

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

export type SupportEdge = { claimA: string; claimB: string; weight: number };
export type ContradictionEdge = { claimA: string; claimB: string; weight: number };
export type GroundingEdge = { claimId: string; sourceId: string; weight: number; quote?: string };

export type ClaimGraph = {
  supports: SupportEdge[];
  contradictions: ContradictionEdge[];
  grounding: GroundingEdge[];
  groundedClaimIds: string[];
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
  const scorer: SemanticScorer = opts.scorer ?? new TokenHeuristicScorer();
  const tSup = opts.supportThreshold ?? 0.58;
  const tCon = opts.contradictionThreshold ?? 0.70;
  const tGnd = opts.groundingThreshold ?? 0.60;
  const topGroundingK = opts.topGroundingK ?? 1;

  const neighborK = opts.ann?.neighborK ?? 12;
  const maxPairs = opts.maxPairwiseEdges ?? 6000;
  const batchSize = opts.batchSize ?? 256;

  // Cache: versioned, model-aware
  const cacheEnabled = opts.cache?.enabled ?? true;
  const cache = new SemanticCache({
    namespace: "tcl",
    version: "v1",
    model: scorer.id,
    ttlSeconds: opts.cache?.ttlSeconds ?? 60 * 60 * 24 * 7, // 7 days default
    persistPath: opts.cache?.persistPath,
    maxEntries: opts.cache?.maxEntries ?? 250000
  });
  await cache.loadIfNeeded();

  const grounding: GroundingEdge[] = [];
  const groundedClaimIds: string[] = [];

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
      for (const t of top) grounding.push({ claimId: c.id, sourceId: t.sid, weight: clamp01(t.sc), quote: t.quote });
      if (top[0] && top[0].sc >= tGnd) groundedClaimIds.push(c.id);
    }
  }

  // -----------------------------
  // ANN candidate retrieval for claim-claim edges
  // -----------------------------
  const { index, vectors } = await buildIndexForClaims(claims, opts.ann);
  const idToIdx = new Map<string, number>();
  claims.forEach((c, i) => idToIdx.set(c.id, i));

  // collect candidate directed pairs from ANN neighbors
  const candPairs: Array<{ i: number; j: number }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < claims.length; i++) {
    const neighIds = await index.query(vectors[i], neighborK + 2); // +2 buffer
    for (const nid of neighIds) {
      if (nid === claims[i].id) continue;
      const j = idToIdx.get(nid);
      if (j === undefined || j === i) continue;
      const k = `${i}->${j}`;
      if (seen.has(k)) continue;
      seen.add(k);
      candPairs.push({ i, j });
      if (candPairs.length >= maxPairs) break;
    }
    if (candPairs.length >= maxPairs) break;
  }

  // -----------------------------
  // Batch score contradictions + entailments with cache
  // -----------------------------
  const supports: SupportEdge[] = [];
  const contradictions: ContradictionEdge[] = [];

  const pairsToScore: BatchPair[] = [];
  for (const { i, j } of candPairs) {
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

  for (const { i, j } of candPairs) {
    const A = claims[i];
    const B = claims[j];

    const kCon = cache.makeKey("con", A.text, B.text);
    const conHit = cache.get(kCon);
    const con = conHit ? conHit.v : await scorer.contradiction(A.text, B.text);
    if (!conHit) cache.set(kCon, con);

    if (con >= tCon) {
      contradictions.push({ claimA: A.id, claimB: B.id, weight: clamp01(con) });
      continue;
    }

    const kEnt = cache.makeKey("ent", A.text, B.text);
    const entHit = cache.get(kEnt);
    const ent = entHit ? entHit.v : await scorer.entailment(A.text, B.text);
    if (!entHit) cache.set(kEnt, ent);

    if (ent >= tSup) supports.push({ claimA: A.id, claimB: B.id, weight: clamp01(ent) });
  }

  // dedupe contradictions (ordered)
  const conMap = new Map<string, number>();
  for (const e of contradictions) conMap.set(`${e.claimA}::${e.claimB}`, Math.max(conMap.get(`${e.claimA}::${e.claimB}`) ?? 0, e.weight));
  const contradictionsDedup = [...conMap.entries()].map(([k, w]) => {
    const [claimA, claimB] = k.split("::");
    return { claimA, claimB, weight: w };
  });

  await cache.flush();
  return { supports, contradictions: contradictionsDedup, grounding, groundedClaimIds };
}
