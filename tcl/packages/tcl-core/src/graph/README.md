# Graph layer (production)

## Candidate retrieval options

### 1) Embedded ANN (recommended for scale)
- EmbeddingProvider: `ann.ts`
- Index: HNSW via `hnswlib-node` (optional dependency)
- Fallback: brute-force dot product (works for small n)

### 2) Database ANN (enterprise)
- Postgres + pgvector (HNSW/IVFFlat)
- Store claim embeddings per request/session in a temp table
- Query top-k neighbors per claim with indexed ANN
- Pros: persistence, scalability, observability, multi-worker

## Cache layer
- `cache.ts` provides model-aware, versioned keys with TTL
- file-backed JSONL is portable; swap to Redis for multi-instance production
