# TCL NLP Service - spaCy Entity Extraction

A FastAPI service for enhanced entity extraction using spaCy, with coreference resolution and domain-specific patterns.

## Features

- **Named Entity Recognition (NER)** - Built-in spaCy NER for standard entities
- **Domain-Specific Patterns** - Custom patterns for fees, amounts, plans, time periods
- **Coreference Resolution** - Links pronouns ("it", "that") to their antecedents
- **Caching** - LRU cache for performance (10,000 entries)
- **Batch Processing** - Optimized batch extraction endpoint

## Setup

### 1. Install Dependencies

```bash
cd packages/tcl-nlp
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Download spaCy Model

```bash
python -m spacy download en_core_web_sm
```

For better accuracy (but slower), use:
```bash
python -m spacy download en_core_web_md  # Medium model
# or
python -m spacy download en_core_web_lg  # Large model (best accuracy)
```

### 3. Run Service

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8081
```

Or with custom model:
```bash
SPACY_MODEL=en_core_web_md uvicorn app.main:app --host 0.0.0.0 --port 8081
```

## Environment Variables

- `SPACY_MODEL` - spaCy model to use (default: `en_core_web_sm`)
- `ENABLE_CACHE` - Enable caching (default: `true`)
- `BATCH_SIZE` - Batch size for processing (default: `10`)

## API Endpoints

### POST `/extract`

Extract entities from one or more texts.

**Request:**
```json
{
  "texts": [
    "There may be an early termination fee of $50.",
    "The fee is $50 if you cancel."
  ],
  "enable_coreference": true,
  "custom_entities": null
}
```

**Response:**
```json
{
  "results": [
    [
      {
        "type": "FEE",
        "value": "early termination fee",
        "normalized": "early_termination_fee",
        "span": {"start": 15, "end": 37},
        "confidence": 0.9,
        "coreference_id": "ent_15_37"
      },
      {
        "type": "MONEY",
        "value": "$50",
        "normalized": "amount_50",
        "span": {"start": 41, "end": 44},
        "confidence": 0.9,
        "coreference_id": "ent_41_44"
      }
    ]
  ],
  "coreference_chains": [
    ["ent_15_37", "ent_5_8"]  // "early termination fee" and "it" refer to same thing
  ]
}
```

### POST `/extract/batch`

Batch extraction (optimized for multiple texts).

### GET `/health`

Health check endpoint.

### GET `/test`

Test endpoint with sample extractions.

## Integration with TCL Core

The TypeScript backend can call this service via HTTP. See `tcl-core/src/nlp/spacy-client.ts` for the integration.

## Performance

- **Small model (en_core_web_sm)**: ~50ms per claim
- **Medium model (en_core_web_md)**: ~100ms per claim
- **Large model (en_core_web_lg)**: ~200ms per claim

With caching enabled, repeated texts are instant.

## Docker

```bash
docker build -t tcl-nlp .
docker run -p 8081:8081 tcl-nlp
```

## Railway Deployment

1. Create new Railway service
2. Set Root Directory: `packages/tcl-nlp`
3. Set environment variables:
   - `SPACY_MODEL=en_core_web_sm` (or md/lg)
   - `ENABLE_CACHE=true`
4. Deploy

