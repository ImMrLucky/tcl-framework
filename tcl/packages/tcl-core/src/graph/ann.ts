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

export type EmbeddingProvider = {
  id: string;  // model/version identifier for cache keys
  dim: number;
  embed(texts: string[]): Promise<Float32Array[]>; // batch embed
};

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class SparseHashEmbeddingProvider implements EmbeddingProvider {
  id = "sparsehash-v1";
  dim = 384;
  async embed(texts: string[]): Promise<Float32Array[]> {
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
        if (g.includes(" ")) continue;
        const idx = hash32("g:" + g) % this.dim;
        v[idx] += 0.25;
      }

      // l2 normalize
      let ss = 0;
      for (let i = 0; i < this.dim; i++) ss += v[i] * v[i];
      const inv = ss > 0 ? 1 / Math.sqrt(ss) : 1;
      for (let i = 0; i < this.dim; i++) v[i] *= inv;
      return v;
    });
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export type CandidateIndex = {
  name: string;
  add(ids: string[], vectors: Float32Array[]): Promise<void>;
  query(vector: Float32Array, k: number): Promise<string[]>;
};

export class BruteForceIndex implements CandidateIndex {
  name = "bruteforce";
  private ids: string[] = [];
  private vecs: Float32Array[] = [];
  async add(ids: string[], vectors: Float32Array[]) {
    this.ids.push(...ids);
    this.vecs.push(...vectors);
  }
  async query(vector: Float32Array, k: number): Promise<string[]> {
    const scores: Array<{ id: string; s: number }> = [];
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
export class HnswIndex implements CandidateIndex {
  name = "hnsw";
  private idx: any;
  private dim: number;
  private idList: string[] = [];
  private ready = false;

  constructor(dim: number, private cfg: { M?: number; efConstruction?: number; efSearch?: number } = {}) {
    this.dim = dim;
  }

  private async ensure() {
    if (this.ready) return;
    let hnsw: any;
    try {
      // dynamic import so repo runs without dependency
      hnsw = await import("hnswlib-node");
    } catch {
      throw new Error("HnswIndex requires 'hnswlib-node' dependency installed.");
    }
    this.idx = new hnsw.HierarchicalNSW("cosine", this.dim);
    this.ready = true;
  }

  async add(ids: string[], vectors: Float32Array[]) {
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

  async query(vector: Float32Array, k: number): Promise<string[]> {
    await this.ensure();
    const r = this.idx.searchKnn(Array.from(vector), k);
    const labels: number[] = r.neighbors ?? [];
    return labels.map(l => this.idList[l]).filter(Boolean);
  }
}
