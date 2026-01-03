import { Claim, Source, SupportEdge, ContradictionEdge, GroundingEdge } from "../types.js";
import { EmbeddingProvider, SparseHashEmbeddingProvider, CandidateIndex, BruteForceIndex, HnswIndex } from "./ann.js";
import { SemanticCache, NoopCache, type CacheLike } from "./cache.js";
import { createHash } from "crypto";
import { shouldConsiderContradiction } from "../claim_classifier.js";
import { getScoringConfig } from "../config/scoring.js";

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
  
  // OPTIMIZATION: Limit grounding pairs per claim (candidate generation)
  maxGroundingPairsPerClaim?: number; // Default: 10 (only check top 10 sources per claim)

  // pruning
  maxPairwiseEdges?: number; // hard cap on scored claim-claim pairs

  // batching
  batchSize?: number;

  // ANN
  ann?: AnnConfig;

  // cache
  cache?: EdgeBuilderCacheConfig;
  
  // Performance tracking
  timer?: any; // PipelineTimer instance for metrics
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
  // Grounding (source -> claim: does source ENTAIL claim?)
  // -----------------------------
  // CRITICAL FIX: Use a local Map for batch results when cache is disabled (NoopCache)
  const groundingResultsMap = new Map<string, { score: number; quote?: string }>();
  
  // OPTIMIZATION: Fast token overlap for candidate generation
  const quickOverlap = (a: string, b: string): number => {
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 3));
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 3));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let overlap = 0;
    for (const t of tokensA) if (tokensB.has(t)) overlap++;
    return overlap / Math.min(tokensA.size, tokensB.size);
  };
  
  // Minimum overlap threshold for NLI scoring
  const MIN_OVERLAP_FOR_NLI = 0.05;
  
  // OPTIMIZATION: Limit grounding pairs per claim (candidate generation)
  // Instead of all-vs-all (N*M pairs), only check top K sources per claim
  const maxGroundingPerClaim = opts.maxGroundingPairsPerClaim ?? 10;
  const timer = opts.timer;
  
  if (sources?.length) {
    if (scorer && 'scoreBatch' in scorer && typeof (scorer as any).scoreBatch === 'function') {
      const pairs: BatchPair[] = [];
      let skippedByCandidate = 0;
      
      // For each claim, find top-K sources by overlap and only score those
      for (const c of claims) {
        // Score all sources by overlap
        const sourcesWithOverlap = sources.map(s => ({
          source: s,
          overlap: quickOverlap(s.text, c.text),
          key: cache.makeKey("gnd", c.text, s.text)
        }));
        
        // Sort by overlap, take top K
        sourcesWithOverlap.sort((a, b) => b.overlap - a.overlap);
        const topSources = sourcesWithOverlap.slice(0, maxGroundingPerClaim);
        const skipped = sourcesWithOverlap.slice(maxGroundingPerClaim);
        
        // Add top sources to pairs for NLI scoring, or mark as 0 if no overlap
        for (const { source, key, overlap } of topSources) {
          if (!cache.get(key) && !groundingResultsMap.has(key)) {
            if (overlap > 0) {
              pairs.push({ task: "grounding", a: source.text, b: c.text, key });
            } else {
              // No overlap - store 0 score without calling NLI
              groundingResultsMap.set(key, { score: 0, quote: undefined });
            }
          }
        }
        
        // Mark skipped sources (beyond top K) as 0 score
        for (const { key } of skipped) {
          if (!groundingResultsMap.has(key)) {
            groundingResultsMap.set(key, { score: 0, quote: undefined });
            skippedByCandidate++;
          }
        }
      }
      
      const totalPossible = claims.length * sources.length;
      console.log(`🔍 Grounding: ${claims.length} claims × ${sources.length} sources = ${totalPossible} possible`);
      console.log(`   Candidate generation: top ${maxGroundingPerClaim}/claim → ${pairs.length} to score (${skippedByCandidate} skipped)`);
      
      // Log first 2 pairs to verify format
      if (pairs.length > 0) {
        console.log(`📋 Sample grounding pairs:`);
        for (let i = 0; i < Math.min(2, pairs.length); i++) {
          console.log(`   [${i}] premise (source): "${pairs[i].a.substring(0, 50)}..."`);
          console.log(`       hypothesis (claim): "${pairs[i].b.substring(0, 50)}..."`);
        }
      }
      
      // CRITICAL: Call scoreBatch as a method on scorer to preserve 'this' context
      const scorerWithBatch = scorer as SemanticScorerWithBatch;
      let batchScoresReceived = 0;
      
      // Track score distribution for diagnostics
      const scoreDistribution = { high: 0, medium: 0, low: 0 };
      let highestScore = 0;
      let lowestScore = 1;
      
      let nliCallCount = 0;
      await runBatches(pairs, batchSize, async (batch) => {
        try {
          nliCallCount++;
          timer?.count('num_nli_calls');
          timer?.count('num_nli_pairs', batch.length);
          
          const batchStart = Date.now();
          const out = await scorerWithBatch.scoreBatch(batch);
          const batchTime = Date.now() - batchStart;
          console.log(`  📤 NLI batch ${nliCallCount}: ${batch.length} pairs → ${out.length} scores (${batchTime}ms, ${(batchTime/batch.length).toFixed(0)}ms/pair)`);
          
          for (const r of out) {
            // Store in BOTH cache AND local map to ensure we don't lose results
            cache.set(r.key, r.score, r.quote);
            groundingResultsMap.set(r.key, { score: r.score, quote: r.quote });
            batchScoresReceived++;
            
            // Track distribution
            if (r.score >= 0.5) scoreDistribution.high++;
            else if (r.score >= 0.25) scoreDistribution.medium++;
            else scoreDistribution.low++;
            
            if (r.score > highestScore) highestScore = r.score;
            if (r.score < lowestScore) lowestScore = r.score;
            
            // Log first 3 scores
            if (batchScoresReceived <= 3) {
              console.log(`    Score ${batchScoresReceived}: ${r.score.toFixed(3)}`);
            }
          }
        } catch (batchErr: any) {
          console.error(`❌ Grounding batch scoring error: ${batchErr.message}`);
          console.error(`   Stack: ${batchErr.stack}`);
        }
      });
      
      console.log(`✅ Grounding batch scoring complete: ${batchScoresReceived}/${pairs.length} scores received`);
      console.log(`   Score distribution: high(≥0.5)=${scoreDistribution.high}, medium(≥0.25)=${scoreDistribution.medium}, low(<0.25)=${scoreDistribution.low}`);
      console.log(`   Range: ${lowestScore.toFixed(3)} - ${highestScore.toFixed(3)}`);
      
      if (batchScoresReceived === 0 && pairs.length > 0) {
        console.error(`❌ CRITICAL: No grounding scores received! NLI service may be failing.`);
      }
    }

    // Diagnostic: track max scores per claim
    const groundingDiagnostic: Array<{ claimText: string; maxScore: number; passed: boolean }> = [];
    
    for (const c of claims) {
      const scored: Array<{ sid: string; sc: number; quote?: string }> = [];
      for (const s of sources) {
        const key = cache.makeKey("gnd", c.text, s.text);
        
        // Check local map FIRST (has batch results even when cache is NoopCache)
        const localHit = groundingResultsMap.get(key);
        if (localHit) {
          scored.push({ sid: s.id, sc: localHit.score, quote: localHit.quote });
          continue;
        }
        
        // Then check cache
        const cacheHit = cache.get(key);
        if (cacheHit) {
          scored.push({ sid: s.id, sc: cacheHit.v, quote: cacheHit.quote });
          continue;
        }
        
        // Fallback to individual scoring (should rarely happen now)
        console.warn(`⚠️ Cache miss for grounding ${c.id} - scoring individually`);
        const r = await scorer.grounding(c.text, s.text);
        cache.set(key, r.score, r.quote);
        groundingResultsMap.set(key, { score: r.score, quote: r.quote });
        scored.push({ sid: s.id, sc: r.score, quote: r.quote });
      }
      scored.sort((a, b) => b.sc - a.sc);
      const top = scored.slice(0, Math.max(1, topGroundingK));
      
      const maxScore = top[0]?.sc || 0;
      let passed = false;
      
      for (const t of top) {
        if (t.sc >= tGnd) {
          grounding.push({ claimId: c.id, sourceId: t.sid, weight: clamp01(t.sc), quote: t.quote });
          groundedClaimIds.push(c.id);
          passed = true;
        } else {
          filteredBelowGrounding++;
        }
      }
      
      groundingDiagnostic.push({
        claimText: c.text.substring(0, 50),
        maxScore: maxScore,
        passed
      });
    }
    
    // Log grounding diagnostic (first 5 and summary)
    console.log(`📊 GROUNDING DIAGNOSTIC (threshold=${tGnd}):`);
    console.log(`   Sample scores:`, groundingDiagnostic.slice(0, 5).map(d => 
      `"${d.claimText}..." → ${d.maxScore.toFixed(3)} ${d.passed ? '✓' : '✗'}`
    ));
    const passedCount = groundingDiagnostic.filter(d => d.passed).length;
    const avgMaxScore = groundingDiagnostic.reduce((a, d) => a + d.maxScore, 0) / groundingDiagnostic.length;
    console.log(`   Total: ${passedCount}/${groundingDiagnostic.length} passed, avg max score: ${avgMaxScore.toFixed(3)}`);
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
  
  console.log(`📊 Pair generation: ${candPairs.length} candidates → ${dedupedPairs.length} deduped → ${finalPairs.length} final pairs (maxPairs=${maxPairs})`);
  
  if (finalPairs.length === 0 && n > 1) {
    console.error(`❌ ERROR: No pairs generated for ${n} claims! This will result in an empty graph.`);
    console.error(`   - candPairs.length: ${candPairs.length}`);
    console.error(`   - dedupedPairs.length: ${dedupedPairs.length}`);
    console.error(`   - maxPairs: ${maxPairs}`);
    console.error(`   - useANN: ${useANN}`);
  }

  // -----------------------------
  // Step B: Always run claim↔claim NLI scoring (even without sources)
  // -----------------------------
  const supports: SupportEdge[] = [];
  const contradictions: ContradictionEdge[] = [];
  
  // CRITICAL FIX: Use local Map for batch results when cache is disabled (NoopCache)
  const pairResultsMap = new Map<string, number>();
  
  // Debug tracking (continued)
  let pairsScored = 0;
  let filteredBelowSupport = 0;
  let filteredBelowContradiction = 0;
  let filteredByGating = 0; // Track contradictions filtered by eligibility gating
  let droppedByMaxEdges = 0;
  let supportsAdded = 0;
  let contradictionsAdded = 0;

  // Batch score contradictions + entailments with cache
  // Apply same pre-filtering as grounding to reduce NLI calls
  const pairsToScore: BatchPair[] = [];
  let cacheHits = 0;
  let claimPairsSkipped = 0;
  
  for (const { i, j } of finalPairs) {
    const A = claims[i].text;
    const B = claims[j].text;
    
    // OPTIMIZATION: Pre-filter claim pairs with no overlap
    // Claims need SOME overlap to potentially support/contradict each other
    const overlap = quickOverlap(A, B);
    if (overlap < MIN_OVERLAP_FOR_NLI) {
      // No overlap - store 0 scores and skip NLI
      const kCon = cache.makeKey("con", A, B);
      const kEnt = cache.makeKey("ent", A, B);
      pairResultsMap.set(kCon, 0);
      pairResultsMap.set(kEnt, 0);
      claimPairsSkipped++;
      continue;
    }

    const kCon = cache.makeKey("con", A, B);
    if (!cache.get(kCon) && !pairResultsMap.has(kCon)) {
      pairsToScore.push({ task: "contradiction", a: A, b: B, key: kCon });
    } else {
      cacheHits++;
    }

    const kEnt = cache.makeKey("ent", A, B);
    if (!cache.get(kEnt) && !pairResultsMap.has(kEnt)) {
      pairsToScore.push({ task: "entailment", a: A, b: B, key: kEnt });
    } else {
      cacheHits++;
    }
  }
  
  console.log(`🎯 Claim pairs: ${finalPairs.length} total → ${claimPairsSkipped} skipped → ${pairsToScore.length} to score, ${cacheHits} cache hits`);

  // Check if scorer has scoreBatch method
  if (scorer && 'scoreBatch' in scorer && typeof (scorer as any).scoreBatch === 'function' && pairsToScore.length) {
    console.log(`  Claim-pair batch scoring: ${pairsToScore.length} pairs, batch size: ${batchSize}`);
    const scorerWithBatch = scorer as SemanticScorerWithBatch;
    const startTime = Date.now();
    let batchScoresStored = 0;
    let batchErrors = 0;
    let claimNliCalls = 0;
    try {
      await runBatches(pairsToScore, batchSize, async (batch) => {
        try {
          claimNliCalls++;
          timer?.count('num_nli_calls');
          timer?.count('num_nli_pairs', batch.length);
          
          const batchStart = Date.now();
          const out = await scorerWithBatch.scoreBatch(batch);
          const batchTime = Date.now() - batchStart;
          console.log(`  📤 Claim NLI batch ${claimNliCalls}: ${batch.length} pairs → ${out.length} scores (${batchTime}ms)`);
          if (!out || out.length === 0) {
            console.error(`  ❌ Batch scoring returned empty results for batch of ${batch.length} pairs`);
            return;
          }
          for (const r of out) {
            if (!r || r.key === undefined || r.score === undefined) {
              console.error(`  ❌ Invalid batch score result:`, r);
              batchErrors++;
              continue;
            }
            // Store in BOTH cache AND local map to ensure we don't lose results
            cache.set(r.key, r.score, r.quote);
            pairResultsMap.set(r.key, r.score);
            batchScoresStored++;
            // Log first few scores to verify they're different
            if (batchScoresStored <= 5) {
              const pair = pairsToScore.find(p => p.key === r.key);
              console.log(`    Batch scored [${pair?.task}]: score=${r.score.toFixed(3)}, key=${r.key.substring(0, 20)}...`);
            }
          }
        } catch (batchError: any) {
          console.error(`  ❌ Error in batch scoring:`, batchError);
          batchErrors++;
        }
      });
      const elapsed = Date.now() - startTime;
      console.log(`  ✅ Batch scoring complete: ${batchScoresStored} scores stored, ${batchErrors} errors, ${elapsed}ms`);
      if (batchScoresStored === 0 && pairsToScore.length > 0) {
        console.error(`  ❌ CRITICAL: Batch scoring stored 0 scores but ${pairsToScore.length} pairs were sent!`);
      }
    } catch (error: any) {
      console.error(`  ❌ Fatal error in batch scoring:`, error);
      throw error;
    }
  } else if (pairsToScore.length === 0) {
    console.log(`  ℹ️ All pairs already in cache (no new scoring needed)`);
  } else {
    console.warn(`  ⚠️ Scorer does not support batch scoring, will score individually (slow)`);
  }

  // Score all pairs and build edges
  for (const { i, j } of finalPairs) {
    const A = claims[i];
    const B = claims[j];

    // Score contradiction - check local map FIRST (has batch results even when cache is NoopCache)
    const kCon = cache.makeKey("con", A.text, B.text);
    const conFromMap = pairResultsMap.get(kCon);
    const conHit = cache.get(kCon);
    let con: number;
    try {
      if (conFromMap !== undefined) {
        con = conFromMap;
      } else if (conHit) {
        con = conHit.v;
      } else {
        // Cache miss - should have been scored in batch, but fallback to individual
        console.warn(`  ⚠️ Cache miss for contradiction ${A.id} vs ${B.id} - scoring individually`);
        con = await scorer.contradiction(A.text, B.text);
        if (cacheEnabled) cache.set(kCon, con);
        pairResultsMap.set(kCon, con);
      }
    } catch (error: any) {
      console.error(`❌ Error scoring contradiction for ${A.id} vs ${B.id}:`, error);
      con = 0.0;
    }
    
    pairsScored++;
    
    // Apply contradiction eligibility gating BEFORE checking threshold
    const config = getScoringConfig();
    const gateResult = shouldConsiderContradiction(A, B, config);
    
    // Only create contradiction edge if gating passes AND score is above threshold
    if (gateResult.shouldCreate && con >= tCon) {
      contradictions.push({ 
        claimA: A.id, 
        claimB: B.id, 
        weight: clamp01(con),
        contradictionType: gateResult.contradictionType,
        reasonCodes: gateResult.reasonCodes,
        overlapScore: gateResult.overlapScore
      });
      contradictionsAdded++;
      if (contradictionsAdded <= 5) {
        console.log(`  ✅ Contradiction: ${A.id} → ${B.id} (${con.toFixed(3)} >= ${tCon.toFixed(3)}, type=${gateResult.contradictionType})`);
        console.log(`     "${A.text.substring(0, 60)}..." vs "${B.text.substring(0, 60)}..."`);
      }
    } else {
      if (!gateResult.shouldCreate) {
        filteredByGating = (filteredByGating || 0) + 1;
        if (pairsScored <= 3) {
          console.log(`  🚫 Gated out: ${A.id} vs ${B.id} (${gateResult.reasonCodes.join(', ')})`);
        }
      } else {
        filteredBelowContradiction++;
        if (pairsScored <= 3) {
          console.log(`  ❌ Below threshold: ${A.id} vs ${B.id} contradiction = ${con.toFixed(3)} < ${tCon.toFixed(3)}`);
        }
      }
    }

    // Score entailment (support) - check local map FIRST
    const kEnt = cache.makeKey("ent", A.text, B.text);
    const entFromMap = pairResultsMap.get(kEnt);
    const entHit = cache.get(kEnt);
    let ent: number;
    try {
      if (entFromMap !== undefined) {
        ent = entFromMap;
      } else if (entHit) {
        ent = entHit.v;
      } else {
        // Cache miss - should have been scored in batch, but fallback to individual
        console.warn(`  ⚠️ Cache miss for entailment ${A.id} → ${B.id} - scoring individually`);
        ent = await scorer.entailment(A.text, B.text);
        if (cacheEnabled) cache.set(kEnt, ent);
        pairResultsMap.set(kEnt, ent);
      }
    } catch (error: any) {
      console.error(`❌ Error scoring entailment for ${A.id} → ${B.id}:`, error);
      ent = 0.0;
    }
    
    if (ent >= tSup) {
      supports.push({ claimA: A.id, claimB: B.id, weight: clamp01(ent) });
      supportsAdded++;
      if (supportsAdded <= 5) {
        console.log(`  ✅ Support: ${A.id} → ${B.id} (${ent.toFixed(3)} >= ${tSup.toFixed(3)})`);
      }
    } else {
      filteredBelowSupport++;
      if (pairsScored <= 3) {
        console.log(`  ❌ Below threshold: ${A.id} → ${B.id} entailment = ${ent.toFixed(3)} < ${tSup.toFixed(3)}`);
      }
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
      filteredByContradictionGating: filteredByGating,
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
