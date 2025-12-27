/**
 * ANN + Embeddings design for production candidate pruning.
 *
 * This file provides a plug-in interface:
 * - EmbeddingProvider: getVector(text) => Float32Array
 * - CandidateIndex: add(id, vector), query(vector, k) => neighbor ids
 *
 * Included:
 * - SparseHashEmbeddingProvider (no deps): for dev / bootstrap
 * - BruteForceIndex (no deps): for small n
 * - Optional HnswIndex: uses hnswlib-node if installed (graceful fallback)
 *
 * For scale (thousands+ claims), use:
 * - OpenAI embeddings + HNSW, or
 * - local SBERT + FAISS, or
 * - pgvector (Postgres) + ivfflat/hnsw indexes.
 */
function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
export class SparseHashEmbeddingProvider {
    id = "sparsehash-v1";
    dim = 384;
    async embed(texts) {
        return texts.map(t => {
            const v = new Float32Array(this.dim);
            const normed = normalize(t);
            const toks = normed.split(" ").filter(w => w.length >= 3);
            for (const tok of toks) {
                const idx = hash32("t:" + tok) % this.dim;
                v[idx] += 1;
            }
            const s = normed.replace(/\s+/g, " ");
            for (let i = 0; i < s.length - 2; i++) {
                const g = s.slice(i, i + 3);
                if (g.includes(" "))
                    continue;
                const idx = hash32("g:" + g) % this.dim;
                v[idx] += 0.25;
            }
            // l2 normalize
            let ss = 0;
            for (let i = 0; i < this.dim; i++)
                ss += v[i] * v[i];
            const inv = ss > 0 ? 1 / Math.sqrt(ss) : 1;
            for (let i = 0; i < this.dim; i++)
                v[i] *= inv;
            return v;
        });
    }
}
function dot(a, b) {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++)
        s += a[i] * b[i];
    return s;
}
export class BruteForceIndex {
    name = "bruteforce";
    ids = [];
    vecs = [];
    async add(ids, vectors) {
        this.ids.push(...ids);
        this.vecs.push(...vectors);
    }
    async query(vector, k) {
        const scores = [];
        for (let i = 0; i < this.vecs.length; i++) {
            scores.push({ id: this.ids[i], s: dot(vector, this.vecs[i]) });
        }
        scores.sort((a, b) => b.s - a.s);
        return scores.slice(0, Math.max(0, k)).map(x => x.id);
    }
}
/**
 * Optional HNSW index wrapper.
 * Install: npm i hnswlib-node
 */
export class HnswIndex {
    cfg;
    name = "hnsw";
    idx;
    dim;
    idList = [];
    ready = false;
    constructor(dim, cfg = {}) {
        this.cfg = cfg;
        this.dim = dim;
    }
    async ensure() {
        if (this.ready)
            return;
        let hnsw;
        try {
            // dynamic import so repo runs without dependency
            // @ts-ignore - optional dependency, checked at runtime
            hnsw = await import("hnswlib-node");
        }
        catch {
            throw new Error("HnswIndex requires 'hnswlib-node' dependency installed.");
        }
        this.idx = new hnsw.HierarchicalNSW("cosine", this.dim);
        this.ready = true;
    }
    async add(ids, vectors) {
        await this.ensure();
        // create index on first add
        if (this.idList.length === 0) {
            const maxElements = Math.max(1000, ids.length * 3);
            this.idx.initIndex(maxElements, this.cfg.M ?? 16, this.cfg.efConstruction ?? 200, 1234);
        }
        const base = this.idList.length;
        this.idList.push(...ids);
        // hnswlib-node expects array<number>
        const labels = ids.map((_, i) => base + i);
        const data = vectors.map(v => Array.from(v));
        this.idx.addPoints(data, labels);
        this.idx.setEf(this.cfg.efSearch ?? 50);
    }
    async query(vector, k) {
        await this.ensure();
        const r = this.idx.searchKnn(Array.from(vector), k);
        const labels = r.neighbors ?? [];
        return labels.map(l => this.idList[l]).filter(Boolean);
    }
}
