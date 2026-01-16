# spaCy Integration Guide

This guide explains how to integrate the spaCy NLP service with TCL Core.

## Quick Start

### 1. Start the spaCy Service

```bash
cd packages/tcl-nlp
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn app.main:app --host 0.0.0.0 --port 8081
```

### 2. Configure TCL Core

Set environment variable:
```bash
export TCL_NLP_URL=http://localhost:8081
# or
export SPACY_SERVICE_URL=http://localhost:8081
```

Or disable spaCy if not available:
```bash
export ENABLE_SPACY=false
```

### 3. Use in Code

**Synchronous (regex-based, default):**
```typescript
import { extractEntities } from './nlp/entity-extractor.js';

const entities = extractEntities("There may be an early termination fee of $50.");
```

**Asynchronous (spaCy-enhanced):**
```typescript
import { extractEntitiesAsync } from './nlp/entity-extractor.js';

const entities = await extractEntitiesAsync("There may be an early termination fee of $50.");
```

## Benefits

### Better Entity Extraction
- **NER**: Recognizes PERSON, ORG, MONEY, DATE, etc.
- **Domain patterns**: Fees, plans, amounts, time periods
- **Noun chunks**: Better compound entity detection

### Coreference Resolution
- Links pronouns ("it", "that") to their antecedents
- Example: "There may be an early termination fee. It is $50."
  - Both "early termination fee" and "it" resolve to the same entity
  - Better slot matching → better edge creation

### Performance
- **Caching**: LRU cache (10,000 entries) for repeated texts
- **Batch processing**: Optimized `/extract/batch` endpoint
- **Fallback**: Automatically falls back to regex if service unavailable

## Configuration

### Environment Variables

- `TCL_NLP_URL` or `SPACY_SERVICE_URL`: spaCy service URL (default: `http://localhost:8081`)
- `ENABLE_SPACY`: Enable/disable spaCy (default: `true`)
- `SPACY_MODEL`: spaCy model to use (default: `en_core_web_sm`)

### Programmatic Configuration

```typescript
import { configureEntityExtraction } from './nlp/entity-extractor.js';

configureEntityExtraction({
  useSpacy: true,
  spacyConfig: {
    endpoint: 'http://localhost:8081',
    timeout: 5000,
    enableCoreference: true,
  }
});
```

## Model Selection

### Small Model (`en_core_web_sm`) - Recommended
- **Speed**: ~50ms per claim
- **Size**: ~20MB
- **Accuracy**: Good for most use cases
- **Best for**: Production, large volumes

### Medium Model (`en_core_web_md`)
- **Speed**: ~100ms per claim
- **Size**: ~40MB
- **Accuracy**: Better word vectors
- **Best for**: Better accuracy needed

### Large Model (`en_core_web_lg`)
- **Speed**: ~200ms per claim
- **Size**: ~500MB
- **Accuracy**: Best
- **Best for**: Maximum accuracy, smaller volumes

## Integration with Graph Builder

The graph builder uses entities for:
1. **Slot matching**: Only claims about the same entity can contradict
2. **Candidate generation**: Entity overlap improves retrieval
3. **Edge weights**: Better entities → higher slot match scores

To use spaCy in graph building, update the graph builder to use `extractEntitiesAsync`:

```typescript
// In graph builder
const entities = await extractEntitiesAsync(claim.text);
```

## Testing

### Test spaCy Service

```bash
curl http://localhost:8081/test
```

### Test from TCL Core

```bash
curl http://localhost:8787/api/nlp/test
```

## Deployment

### Railway

1. Create new Railway service
2. Set Root Directory: `packages/tcl-nlp`
3. Set environment variables:
   - `SPACY_MODEL=en_core_web_sm`
   - `ENABLE_CACHE=true`
4. Deploy

### Docker

```bash
docker build -t tcl-nlp packages/tcl-nlp
docker run -p 8081:8081 tcl-nlp
```

## Troubleshooting

### Service Not Available

If spaCy service is unavailable, the system automatically falls back to regex extraction. Check logs for warnings.

### Slow Performance

1. Enable caching: `ENABLE_CACHE=true`
2. Use smaller model: `SPACY_MODEL=en_core_web_sm`
3. Use batch endpoint for multiple texts

### Memory Issues

1. Use smaller model: `en_core_web_sm`
2. Reduce cache size in code
3. Increase container memory limit

