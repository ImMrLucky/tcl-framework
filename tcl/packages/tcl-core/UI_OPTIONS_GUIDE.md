# UI Options Guide: Spectral, ANN, and Cache

## Overview

The TCL UI provides three checkboxes that control validation behavior:
- **Spectral**: Advanced coherence analysis
- **ANN**: Approximate Nearest Neighbor candidate selection
- **Cache**: Semantic caching for NLI scores

---

## 1. Spectral ☑️ ⭐ **CORE VALUE PROPOSITION**

### What It Does
**Spectral Analysis is TCL's core differentiator** - an advanced mathematical technique that analyzes the entire claim graph to detect:
- **Coherence Score** (0-100): Overall structural coherence of all claims
- **Circular Reasoning**: Claims that support each other in cycles
- **Contradiction Energy**: How much the contradictions destabilize the graph
- **Support Energy**: How well claims support each other
- **Spectral Gap**: Measure of graph stability

### How It Works
When enabled, TCL sends the claim graph (claims, support edges, contradiction edges, grounded claims) to a separate Spectral service that performs linear algebra analysis on the graph structure.

### When to Use
- ✅ **ALWAYS ENABLE** - This is TCL's core value proposition. Spectral analysis is what makes TCL unique.
- ❌ **Only disable** if:
  - Spectral service is not deployed/available (temporary)
  - Debugging/testing without Spectral
  - Performance testing (but this should be rare)

### Default
- **ENABLED** (on) - This is TCL's core feature
- Requires `TCL_SPECTRAL_URL` environment variable to be set
- **Recommendation**: Deploy Spectral service and keep this enabled

### Impact on Scores
- **Coherence Score**: Only calculated when Spectral is enabled (defaults to 50 when disabled)
- **Overall Score**: Includes coherence (20% weight), so enabling Spectral can change the overall score

### Example
```typescript
// With Spectral enabled
{
  scores: {
    truth: 75,
    consistency: 80,
    coherence: 65,  // ← Calculated by Spectral service
    overall: 73
  }
}

// With Spectral disabled
{
  scores: {
    truth: 75,
    consistency: 80,
    coherence: 50,  // ← Default value
    overall: 70
  }
}
```

---

## 2. ANN (Approximate Nearest Neighbor) ☑️

### What It Does
Controls **candidate selection** for finding claim relationships. Instead of checking all possible claim pairs (O(n²)), ANN finds the most similar claims first.

### How It Works
1. **With ANN enabled** (default):
   - Creates embeddings for each claim
   - Uses Approximate Nearest Neighbor search to find the top-K most similar claims
   - Only scores those candidate pairs with NLI
   - **Much faster** for large numbers of claims (e.g., 100+ claims)

2. **With ANN disabled**:
   - Would check all possible pairs (brute force)
   - **Slower** but potentially more thorough

### Current Implementation
- **Always uses ANN** - the checkbox controls the index type:
  - **Enabled**: Uses brute-force dot product (fast for <100 claims)
  - **Disabled**: Would use brute-force anyway (HNSW not currently enabled due to dependency issues)

### When to Use
- ✅ **Enable** (default) - recommended for all use cases
- ❌ **Disable** - only if you want to check all pairs (very slow for >50 claims)

### Default
- **Enabled** (on) - uses `neighborK` (default: 10-12) candidates per claim

### Performance Impact
- **With ANN**: O(n × k) where k = neighborK (typically 10-12)
- **Without ANN**: O(n²) - checks all pairs
- **Speedup**: ~10-100x faster for large claim sets

### Example
```
100 claims:
- With ANN: ~1,200 pairs to check (100 × 12)
- Without ANN: ~10,000 pairs to check (100 × 100)
```

---

## 3. Cache ☑️

### What It Does
Enables **caching** for NLI scores. Stores the results of NLI scoring (entailment, contradiction, grounding) so identical claim pairs don't need to be re-scored.

### How It Works
1. When scoring a claim pair, checks cache first
2. Cache key is created from:
   - Normalized text (lowercase, whitespace collapsed)
   - Task type (entailment/contradiction/grounding)
   - Model ID (different models have separate caches)
3. If found (cache hit), uses cached score immediately
4. If not found (cache miss), scores with NLI and stores result
5. Cache is **model-aware** - different NLI models have separate caches
6. Cache persists to disk (JSONL file) by default

### Is It Exact or Semantic Caching?

**It's exact caching** (after text normalization), not semantic similarity caching.

**How it works:**
- Text is normalized: lowercase, whitespace collapsed, trimmed
- Cache key is a hash of: `namespace|version|model|task|normalized_text_a|normalized_text_b`
- **Exact match required** on the normalized text

**What matches (cache hit):**
- ✅ "AI is great" and "ai is great" (case-insensitive)
- ✅ "AI   is   great" and "AI is great" (whitespace normalized)
- ✅ Same exact text validated again

**What doesn't match (cache miss):**
- ❌ "AI is great" and "AI is excellent" (different words)
- ❌ "AI is great" and "AI is great!" (punctuation matters)
- ❌ Paraphrased content (even if semantically similar)

**Why it's called "SemanticCache":**
- It caches **semantic scores** (NLI results), not semantic similarity
- The name refers to what it caches (semantic NLI scores), not how it matches (which is exact)

**For semantic similarity caching** (fuzzy matching), you would need embedding-based similarity search, which is not currently implemented.

### When to Use
- ✅ **Enable** (default) - recommended for:
  - Repeated validations (same or similar content)
  - Batch processing (many similar calls/answers)
  - Cost savings (fewer NLI API calls)
- ❌ **Disable** - only if you need fresh scores every time (rare)

### Default
- **Enabled** (on) - 7-day TTL, persists to disk

### Performance Impact
- **Cache Hit**: ~0ms (instant)
- **Cache Miss**: Full NLI scoring time (~50-200ms per pair)
- **Speedup**: Can be 10-100x faster for repeated content

### Cost Impact
- **Reduces API costs** by avoiding duplicate NLI calls
- **Important for cloud NLI services** (Mistral, Hugging Face API)

### Cache Statistics
The response includes `cacheHitRate` showing cache effectiveness:
```typescript
{
  cacheHitRate: 75,  // 75% of NLI calls were cache hits
  latency: 120       // Total validation time
}
```

### Example
```
First validation: 100 NLI calls, 0 cache hits, 5 seconds
Second validation (identical content): 100 NLI calls, 80 cache hits, 1 second
```

### Important: Exact Matching Only
The cache uses **exact string matching** after normalization:
- ✅ **Will cache hit**: "AI is great" and "ai is great" (case-insensitive)
- ✅ **Will cache hit**: "AI   is   great" and "AI is great" (whitespace normalized)
- ❌ **Will cache miss**: "AI is great" and "AI is excellent" (different words)
- ❌ **Will cache miss**: "AI is great" and "AI is great!" (punctuation matters)
- ❌ **Will cache miss**: Paraphrased content (even if semantically similar)

**Note**: Despite being called "SemanticCache", it caches **semantic scores** (NLI results), not semantic similarity. It's exact matching after normalization, not fuzzy/semantic matching.

---

## Recommended Settings

### For Call Center QA
```
✅ Spectral: ON ⭐ (CORE FEATURE - enables coherence analysis and circular reasoning detection)
✅ ANN: ON (required for performance)
✅ Cache: ON (saves time and money on repeated validations)
```

### For General QA
```
✅ Spectral: ON ⭐ (CORE FEATURE - this is what makes TCL valuable)
✅ ANN: ON (required for performance)
✅ Cache: ON (saves time and money)
```

### For Batch Processing
```
✅ Spectral: ON ⭐ (CORE FEATURE - even in batch, coherence matters)
✅ ANN: ON (required for performance)
✅ Cache: ON (critical for batch - huge time/cost savings)
```

**Note**: Spectral adds ~100-500ms per validation. For batch processing, this is typically acceptable given the value it provides. If you need faster batch processing, consider:
- Processing batches in parallel
- Using Spectral's batch endpoint (if available)
- Only disabling Spectral as a last resort for extreme performance requirements

---

## Technical Details

### Spectral Service Requirements
- Separate Python/FastAPI service
- Must be deployed and accessible
- Set `TCL_SPECTRAL_URL` environment variable
- If enabled but URL not set, validation continues without Spectral (coherence = 50)

### ANN Implementation
- Currently uses **brute-force dot product** (fast enough for <200 claims)
- Future: HNSW index for larger scale (requires `hnswlib-node` dependency)
- `neighborK` controls how many candidates per claim (default: 10-12)

### Cache Implementation
- **In-memory** cache with optional disk persistence
- **Model-aware**: Different caches for different NLI models
- **Versioned**: Cache keys include model version
- **TTL**: 7 days default (configurable)
- **Max entries**: 250,000 default (configurable)

---

## Troubleshooting

### Spectral Always Shows 50
- Check if `TCL_SPECTRAL_URL` is set
- Check if Spectral service is running
- Check browser console for Spectral service errors

### Slow Validation
- Ensure **ANN is enabled**
- Ensure **Cache is enabled**
- Check `cacheHitRate` - if low, cache may not be helping

### High API Costs
- Ensure **Cache is enabled**
- Check `cacheHitRate` - should be >50% for repeated content
- Consider using local NLI model instead of cloud API

---

## Summary

| Option | Default | Purpose | Impact |
|--------|---------|---------|--------|
| **Spectral** ⭐ | **ON** | **CORE VALUE** - Advanced coherence analysis | +100-500ms, **essential for TCL's value proposition** |
| **ANN** | ON | Fast candidate selection | 10-100x faster for large claim sets |
| **Cache** | ON | Reuse NLI scores | 10-100x faster for repeated content, saves costs |

**Key Takeaway**: Spectral is TCL's core differentiator. Keep it enabled unless you have a specific reason to disable it (e.g., service unavailable during deployment).

