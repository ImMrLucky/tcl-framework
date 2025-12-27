import { Claim, Source } from "../types";

/**
 * PRODUCTION GRAPH BUILDER
 *
 * Key upgrades:
 * 1) Candidate pruning: avoid O(n^2) by generating top-K semantic neighbor candidates per claim.
 *    - Uses a light-weight token/char hashing embedding (no dependencies) by default.
 *    - You can swap in a real embedding provider later (OpenAI embeddings, local SBERT, etc.)
 *
 * 2) True batching: HttpNliScorer supports scoreBatch() so you can send many pairs per request.
 *
 * The premium moat is the combination:
 *   high-fidelity edge construction (grounding + entailment + contradiction) + spectral operator.
 */

export type SupportEdge = { claimA: string; claimB: string; weight: number };         // A supports B (directed)
export type ContradictionEdge = { claimA: string; claimB: string; weight: number };   // A contradicts B
export type GroundingEdge = { claimId: string; sourceId: string; weight: number; quote?: string };

export type ClaimGraph = {
  supports: SupportEdge[];
  contradictions: ContradictionEdge[];
  grounding: GroundingEdge[];
  groundedClaimIds: string[];
};

export type ScoreTask = "entailment" | "contradiction" | "grounding";

export type BatchPair = {
  task: ScoreTask;
  a: string;
  b: string;
  // opaque identifier to map results back
  key: string;
};

export type BatchScore = {
  key: string;
  score: number;
  quote?: string;
};

export interface SemanticScorer {
  entailment(premise: string, hypothesis: string): Promise<number>;     // P(premise entails hypothesis)
  contradiction(a: string, b: string): Promise<number>;                // P(a contradicts b)
  grounding(claim: string, sourceText: string): Promise<{ score: number; quote?: string }>;

  // Optional optimized batch API (strongly recommended for production)
  scoreBatch?(pairs: BatchPair[]): Promise<BatchScore[]>;
}

export type EdgeBuilderOptions = {
  // --- pruning ---
  enablePruning?: boolean;         // default true
  neighborK?: number;              // candidates per node (default 12)
  maxPairwiseEdges?: number;       // hard cap on evaluated claim-claim pairs (default 5000)

  // --- thresholds ---
  supportThreshold?: number;       // keep support edge if >=
  contradictionThreshold?: number; // keep contradiction if >=
  groundingThreshold?: number;     // consider claim grounded if best source >=

  // --- scorer ---
  scorer?: SemanticScorer;

  // --- caching ---
  cache?: Map<string, number>;

  // --- batching ---
  batchSize?: number;              // number of pairs per batch request (default 200)

  // --- grounding ---
  topGroundingK?: number;          // store top-K grounding edges (default 1)
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function cacheKey(kind: string, a: string, b: string) {
  return `${kind}::${a}::${b}`;
}

/**
 * Default lightweight vectorizer for pruning (no deps).
 * Uses hashed token counts + char 3-grams to approximate similarity.
 * This is only for candidate selection, not final scoring.
 */
function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function hash32(str: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function sparseEmbed(text: string, dims = 256): Float32Array {
  const v = new Float32Array(dims);
  const normed = normalize(text);
  const toks = normed.split(" ").filter((w) => w.length >= 3);

  // token hashes
  for (const t of toks) {
    const idx = hash32("t:" + t) % dims;
    v[idx] += 1;
  }

  // char 3-grams
  const s = normed.replace(/\s+/g, " ");
  for (let i = 0; i < s.length - 2; i++) {
    const g = s.slice(i, i + 3);
    if (g.includes(" ")) continue;
    const idx = hash32("g:" + g) % dims;
    v[idx] += 0.25;
  }

  // l2 normalize
  let ss = 0;
  for (let i = 0; i < dims; i++) ss += v[i] * v[i];
  const inv = ss > 0 ? 1 / Math.sqrt(ss) : 1;
  for (let i = 0; i < dims; i++) v[i] *= inv;
  return v;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function topKNeighbors(embs: Float32Array[], k: number): number[][] {
  const n = embs.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const scores: Array<{ j: number; s: number }> = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      scores.push({ j, s: dot(embs[i], embs[j]) });
    }
    scores.sort((a, b) => b.s - a.s);
    out[i] = scores.slice(0, Math.max(0, k)).map((x) => x.j);
  }
  return out;
}

/**
 * Fallback scorer (zero deps).
 * Use only as baseline; for production use HttpNliScorer or an on-prem NLI model.
 */
export class TokenHeuristicScorer implements SemanticScorer {
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
 * HTTP NLI scorer with TRUE batching.
 * Endpoint contract:
 *   POST {endpoint}/score
 *   { "pairs":[{"task":"entailment"|"contradiction"|"grounding","a":"...","b":"...","key":"..."}] }
 * -> { "scores":[{"key":"...","score":0.0,"quote":"...?"}] }
 */
export class HttpNliScorer implements SemanticScorer {
  constructor(private cfg: { endpoint: string; apiKey?: string; timeoutMs?: number }) {}

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

async function runBatches<T>(items: T[], batchSize: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize));
  }
}

/**
 * Build a semantic claim graph with:
 * - grounding edges (topGroundingK per claim)
 * - support edges from entailment among pruned candidate neighbors
 * - contradiction edges among pruned candidate neighbors
 *
 * Production notes:
 * - Replace sparseEmbed/topKNeighbors with ANN embedding search when you add a real embedding model.
 * - Use HttpNliScorer.scoreBatch for throughput (one HTTP call per ~batchSize pairs).
 */
export async function buildClaimGraph(
  claims: Claim[],
  sources: Source[] | undefined,
  opts: EdgeBuilderOptions = {}
): Promise<ClaimGraph> {
  const scorer = opts.scorer ?? new TokenHeuristicScorer();
  const cache = opts.cache ?? new Map<string, number>();

  const enablePruning = opts.enablePruning ?? true;
  const neighborK = opts.neighborK ?? 12;
  const maxPairs = opts.maxPairwiseEdges ?? 5000;

  const tSup = opts.supportThreshold ?? 0.55;
  const tCon = opts.contradictionThreshold ?? 0.70;
  const tGnd = opts.groundingThreshold ?? 0.55;

  const batchSize = opts.batchSize ?? 200;
  const topGroundingK = opts.topGroundingK ?? 1;

  const grounding: GroundingEdge[] = [];
  const groundedClaimIds: string[] = [];

  // -----------------------------
  // 1) Grounding edges (claim -> best sources)
  // -----------------------------
  if (sources?.length) {
    // batch grounding if supported
    if (scorer.scoreBatch) {
      const pairs: BatchPair[] = [];
      for (const c of claims) {
        for (const s of sources) {
          const k = cacheKey("gnd", c.text, s.text);
          if (!cache.has(k)) {
            pairs.push({ task: "grounding", a: c.text, b: s.text, key: k });
          }
        }
      }

      await runBatches(pairs, batchSize, async (batch) => {
        const out = await scorer.scoreBatch!(batch);
        for (const r of out) cache.set(r.key, r.score);
        // quotes are returned but we store them separately by recomputing "best quote" in a second pass below,
        // or you can extend cache to store quote strings. We'll do second pass using scorer.grounding for top few.
      });
    }

    // choose top-K sources per claim
    for (const c of claims) {
      const scores: Array<{ sid: string; sc: number }> = [];
      for (const s of sources) {
        const k = cacheKey("gnd", c.text, s.text);
        let sc = cache.get(k);
        if (sc === undefined) {
          const r = await scorer.grounding(c.text, s.text);
          sc = r.score;
          cache.set(k, sc);
        }
        scores.push({ sid: s.id, sc });
      }
      scores.sort((a, b) => b.sc - a.sc);
      const top = scores.slice(0, Math.max(1, topGroundingK));

      for (const t of top) {
        // fetch quote only for stored edges (cheap)
        const src = sources.find((x) => x.id === t.sid)!;
        const r = await scorer.grounding(c.text, src.text);
        grounding.push({ claimId: c.id, sourceId: t.sid, weight: clamp01(t.sc), quote: r.quote });
      }

      if (top[0] && top[0].sc >= tGnd) groundedClaimIds.push(c.id);
    }
  }

  // -----------------------------
  // 2) Candidate pruning for claim-claim edges
  // -----------------------------
  const n = claims.length;
  let neighbors: number[][];

  if (enablePruning && n > 2) {
    const embs = claims.map((c) => sparseEmbed(c.text));
    neighbors = topKNeighbors(embs, neighborK);
  } else {
    // no pruning => full neighbor list (still capped by maxPairs below)
    neighbors = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => j).filter((j) => j !== i)
    );
  }

  // Build unique directed candidate pairs (i->j) from neighbors
  const candPairs: Array<{ i: number; j: number }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    for (const j of neighbors[i]) {
      const key = `${i}->${j}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candPairs.push({ i, j });
      if (candPairs.length >= maxPairs) break;
    }
    if (candPairs.length >= maxPairs) break;
  }

  // -----------------------------
  // 3) Batch score contradictions + entailments
  // -----------------------------
  const supports: SupportEdge[] = [];
  const contradictions: ContradictionEdge[] = [];

  const toScore: BatchPair[] = [];
  for (const { i, j } of candPairs) {
    const A = claims[i].text;
    const B = claims[j].text;

    const kc = cacheKey("con", A, B);
    if (!cache.has(kc)) toScore.push({ task: "contradiction", a: A, b: B, key: kc });

    const ke = cacheKey("ent", A, B);
    if (!cache.has(ke)) toScore.push({ task: "entailment", a: A, b: B, key: ke });
  }

  if (scorer.scoreBatch && toScore.length) {
    await runBatches(toScore, batchSize, async (batch) => {
      const out = await scorer.scoreBatch!(batch);
      for (const r of out) cache.set(r.key, r.score);
    });
  }

  // Materialize edges from cache / fallback scoring
  for (const { i, j } of candPairs) {
    const A = claims[i];
    const B = claims[j];

    // contradiction
    const kc = cacheKey("con", A.text, B.text);
    let con = cache.get(kc);
    if (con === undefined) {
      con = await scorer.contradiction(A.text, B.text);
      cache.set(kc, con);
    }
    if (con >= tCon) {
      contradictions.push({ claimA: A.id, claimB: B.id, weight: clamp01(con) });
      continue;
    }

    // entailment A -> B
    const ke = cacheKey("ent", A.text, B.text);
    let ent = cache.get(ke);
    if (ent === undefined) {
      ent = await scorer.entailment(A.text, B.text);
      cache.set(ke, ent);
    }
    if (ent >= tSup) {
      supports.push({ claimA: A.id, claimB: B.id, weight: clamp01(ent) });
    }
  }

  // De-duplicate contradictions (ordered pairs)
  const conMap = new Map<string, number>();
  for (const e of contradictions) {
    const k = `${e.claimA}::${e.claimB}`;
    conMap.set(k, Math.max(conMap.get(k) ?? 0, e.weight));
  }
  const contradictionsDedup = [...conMap.entries()].map(([k, w]) => {
    const [claimA, claimB] = k.split("::");
    return { claimA, claimB, weight: w };
  });

  return { supports, contradictions: contradictionsDedup, grounding, groundedClaimIds };
}
