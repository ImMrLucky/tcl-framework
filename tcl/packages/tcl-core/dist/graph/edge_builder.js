import { SparseHashEmbeddingProvider, BruteForceIndex, HnswIndex } from "./ann.js";
import { SemanticCache } from "./cache.js";
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
async function runBatches(items, batchSize, fn) {
    for (let i = 0; i < items.length; i += batchSize) {
        await fn(items.slice(i, i + batchSize));
    }
}
/**
 * Baseline heuristic scorer (dev only).
 */
function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
export class TokenHeuristicScorer {
    id = "token-heuristic-v1";
    overlap(a, b) {
        const A = new Set(normalize(a).split(" ").filter((w) => w.length >= 4));
        const B = new Set(normalize(b).split(" ").filter((w) => w.length >= 4));
        if (A.size === 0)
            return 0;
        let hit = 0;
        for (const w of A)
            if (B.has(w))
                hit++;
        return hit / Math.max(1, A.size);
    }
    async entailment(premise, hypothesis) {
        return this.overlap(hypothesis, premise);
    }
    async contradiction(a, b) {
        const na = normalize(a);
        const nb = normalize(b);
        const aHasNot = /\bnot\b|\bis not\b/.test(na);
        const bHasNot = /\bnot\b|\bis not\b/.test(nb);
        const coreA = na.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");
        const coreB = nb.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");
        if (this.overlap(coreA, coreB) >= 0.75 && aHasNot !== bHasNot)
            return 0.95;
        return 0.05;
    }
    async grounding(claim, sourceText) {
        const sentences = sourceText.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
        let best = { score: 0, quote: undefined };
        for (const s of sentences) {
            const sc = this.overlap(claim, s);
            if (sc > best.score)
                best = { score: sc, quote: s.slice(0, 240) };
        }
        return best;
    }
}
/**
 * HTTP scorer with batching. You operate this service.
 */
export class HttpNliScorer {
    cfg;
    id;
    constructor(cfg) {
        this.cfg = cfg;
        this.id = cfg.modelId;
    }
    async post(payload) {
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
            if (!res.ok)
                throw new Error(`NLI endpoint error ${res.status}`);
            return await res.json();
        }
        finally {
            clearTimeout(t);
        }
    }
    async scoreBatch(pairs) {
        const data = await this.post({ pairs });
        const scores = (data.scores ?? []);
        return scores.map((s) => ({ key: String(s.key), score: Number(s.score ?? 0), quote: s.quote }));
    }
    async entailment(premise, hypothesis) {
        const out = await this.scoreBatch([{ task: "entailment", a: premise, b: hypothesis, key: "0" }]);
        return Number(out[0]?.score ?? 0);
    }
    async contradiction(a, b) {
        const out = await this.scoreBatch([{ task: "contradiction", a, b, key: "0" }]);
        return Number(out[0]?.score ?? 0);
    }
    async grounding(claim, sourceText) {
        const out = await this.scoreBatch([{ task: "grounding", a: claim, b: sourceText, key: "0" }]);
        return { score: Number(out[0]?.score ?? 0), quote: out[0]?.quote };
    }
}
async function buildIndexForClaims(claims, ann) {
    const provider = ann?.provider ?? new SparseHashEmbeddingProvider();
    const vectors = await provider.embed(claims.map(c => c.text));
    const kind = ann?.index ?? "hnsw";
    let index;
    if (kind === "hnsw") {
        try {
            index = new HnswIndex(provider.dim, ann?.hnsw);
        }
        catch {
            index = new BruteForceIndex();
        }
    }
    else {
        index = new BruteForceIndex();
    }
    await index.add(claims.map(c => c.id), vectors);
    return { provider, index, vectors };
}
// Type guard to check if scorer has scoreBatch method
function hasScoreBatch(scorer) {
    return 'scoreBatch' in scorer && typeof scorer.scoreBatch === 'function';
}
export async function buildClaimGraph(claims, sources, opts = {}) {
    const scorer = opts.scorer ?? new TokenHeuristicScorer();
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
    const grounding = [];
    const groundedClaimIds = [];
    // -----------------------------
    // Grounding (claim -> sources)
    // -----------------------------
    if (sources?.length) {
        // batch score grounding where possible
        // Check if scorer has scoreBatch method (optional property)
        if (scorer && 'scoreBatch' in scorer && typeof scorer.scoreBatch === 'function') {
            const pairs = [];
            for (const c of claims) {
                for (const s of sources) {
                    const key = cache.makeKey("gnd", c.text, s.text);
                    if (!cache.get(key))
                        pairs.push({ task: "grounding", a: c.text, b: s.text, key });
                }
            }
            const scoreBatchFn = scorer.scoreBatch;
            await runBatches(pairs, batchSize, async (batch) => {
                const out = await scoreBatchFn(batch);
                for (const r of out)
                    cache.set(r.key, r.score, r.quote);
            });
        }
        for (const c of claims) {
            const scored = [];
            for (const s of sources) {
                const key = cache.makeKey("gnd", c.text, s.text);
                const hit = cache.get(key);
                if (hit) {
                    scored.push({ sid: s.id, sc: hit.v, quote: hit.quote });
                }
                else {
                    const r = await scorer.grounding(c.text, s.text);
                    cache.set(key, r.score, r.quote);
                    scored.push({ sid: s.id, sc: r.score, quote: r.quote });
                }
            }
            scored.sort((a, b) => b.sc - a.sc);
            const top = scored.slice(0, Math.max(1, topGroundingK));
            for (const t of top)
                grounding.push({ claimId: c.id, sourceId: t.sid, weight: clamp01(t.sc), quote: t.quote });
            if (top[0] && top[0].sc >= tGnd)
                groundedClaimIds.push(c.id);
        }
    }
    // -----------------------------
    // ANN candidate retrieval for claim-claim edges
    // -----------------------------
    const { index, vectors } = await buildIndexForClaims(claims, opts.ann);
    const idToIdx = new Map();
    claims.forEach((c, i) => idToIdx.set(c.id, i));
    // collect candidate directed pairs from ANN neighbors
    const candPairs = [];
    const seen = new Set();
    for (let i = 0; i < claims.length; i++) {
        const neighIds = await index.query(vectors[i], neighborK + 2); // +2 buffer
        for (const nid of neighIds) {
            if (nid === claims[i].id)
                continue;
            const j = idToIdx.get(nid);
            if (j === undefined || j === i)
                continue;
            const k = `${i}->${j}`;
            if (seen.has(k))
                continue;
            seen.add(k);
            candPairs.push({ i, j });
            if (candPairs.length >= maxPairs)
                break;
        }
        if (candPairs.length >= maxPairs)
            break;
    }
    // -----------------------------
    // Batch score contradictions + entailments with cache
    // -----------------------------
    const supports = [];
    const contradictions = [];
    const pairsToScore = [];
    for (const { i, j } of candPairs) {
        const A = claims[i].text;
        const B = claims[j].text;
        const kCon = cache.makeKey("con", A, B);
        if (!cache.get(kCon))
            pairsToScore.push({ task: "contradiction", a: A, b: B, key: kCon });
        const kEnt = cache.makeKey("ent", A, B);
        if (!cache.get(kEnt))
            pairsToScore.push({ task: "entailment", a: A, b: B, key: kEnt });
    }
    // Check if scorer has scoreBatch method
    if (scorer && 'scoreBatch' in scorer && typeof scorer.scoreBatch === 'function' && pairsToScore.length) {
        const scoreBatchFn = scorer.scoreBatch;
        await runBatches(pairsToScore, batchSize, async (batch) => {
            const out = await scoreBatchFn(batch);
            for (const r of out)
                cache.set(r.key, r.score, r.quote);
        });
    }
    for (const { i, j } of candPairs) {
        const A = claims[i];
        const B = claims[j];
        const kCon = cache.makeKey("con", A.text, B.text);
        const conHit = cache.get(kCon);
        const con = conHit ? conHit.v : await scorer.contradiction(A.text, B.text);
        if (!conHit)
            cache.set(kCon, con);
        if (con >= tCon) {
            contradictions.push({ claimA: A.id, claimB: B.id, weight: clamp01(con) });
            continue;
        }
        const kEnt = cache.makeKey("ent", A.text, B.text);
        const entHit = cache.get(kEnt);
        const ent = entHit ? entHit.v : await scorer.entailment(A.text, B.text);
        if (!entHit)
            cache.set(kEnt, ent);
        if (ent >= tSup)
            supports.push({ claimA: A.id, claimB: B.id, weight: clamp01(ent) });
    }
    // dedupe contradictions (ordered)
    const conMap = new Map();
    for (const e of contradictions)
        conMap.set(`${e.claimA}::${e.claimB}`, Math.max(conMap.get(`${e.claimA}::${e.claimB}`) ?? 0, e.weight));
    const contradictionsDedup = [...conMap.entries()].map(([k, w]) => {
        const [claimA, claimB] = k.split("::");
        return { claimA, claimB, weight: w };
    });
    await cache.flush();
    return { supports, contradictions: contradictionsDedup, grounding, groundedClaimIds };
}
