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
