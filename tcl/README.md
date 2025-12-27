# TCL (Truth & Consistency Layer) — Production-leaning Starter Repo

- `packages/tcl-core` (TypeScript): truth/consistency middleware + graph builder (edge_builder) + model adapters.
- `packages/tcl-spectral` (Python/FastAPI): spectral coherence engine (signed Laplacian + directed-cycle penalties + grounding-aware circularity).

## Local quick start

### Spectral service
```bash
cd packages/tcl-spectral
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

### Core service
```bash
cd packages/tcl-core
npm i
export OPENAI_API_KEY="..."
export TCL_SPECTRAL_URL="http://localhost:8080"
npm run dev
```

POST `http://localhost:8787/validate`


## Production NLI scorer (for pruning+batching)


`tcl-core` can call a separate NLI scoring service (recommended for production).
Configure in request `options`:

- `nliEndpoint`: base URL of your scorer service (must implement POST /score)
- `nliApiKey`: optional bearer token
- `maxPairwiseEdges`, `neighborK`, `batchSize`

### Endpoint contract
POST `/score`

```json
{
  "pairs": [
    { "task": "entailment", "a": "premise", "b": "hypothesis", "key": "..." },
    { "task": "contradiction", "a": "textA", "b": "textB", "key": "..." },
    { "task": "grounding", "a": "claim", "b": "source text", "key": "..." }
  ]
}
```

Response:
```json
{
  "scores": [
    { "key": "...", "score": 0.83, "quote": "optional short supporting span" }
  ]
}
```


## ANN + Cache (production)


TCL uses ANN candidate retrieval to avoid O(n^2) claim pairing.

- Default embedding provider: `SparseHashEmbeddingProvider` (no deps, ok for dev).
- Default index: `HnswIndex` if `hnswlib-node` is installed; otherwise falls back to brute-force.

### Enable HNSW (recommended)
```bash
cd packages/tcl-core
npm i hnswlib-node
```

### Cache
Semantic scoring results are cached using a versioned, model-aware SHA-256 key.
You can persist the cache as JSONL (portable):

- Set `cache.persistPath` to something like `.tcl_cache/semantic.jsonl`
- Default TTL is 7 days

Example options in a `/validate` request:
```json
{
  "spectral": true,
  "maxPairwiseEdges": 6000,
  "neighborK": 12,
  "batchSize": 256,
  "cachePersistPath": ".tcl_cache/semantic.jsonl"
}
```
