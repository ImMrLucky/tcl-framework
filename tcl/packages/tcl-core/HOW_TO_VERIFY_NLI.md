# How to Verify NLI is Working

## Quick Check: Look at Logs

### 1. Check Railway/Server Logs

When you make a validation request, look for this log message:

**If NLI is working:**
```
Using scorer: transformers-deberta-v3-base (local model - downloads ~200MB on first run)
```

**If it's NOT working (fallback to heuristic):**
```
Using scorer: token-heuristic-v1 (free, basic accuracy)
```

**If using custom endpoint:**
```
Using scorer: nli-default (custom NLI endpoint: https://...)
```

**If using Mistral API:**
```
Using scorer: mistral-mistral-small-latest (Mistral API - auto-enabled)
```

### 2. First Run Behavior

On **first run** with transformers.js, you should see:
```
Loading NLI model: Xenova/deberta-v3-base (this may take a minute on first run)...
✅ NLI model loaded: Xenova/deberta-v3-base
```

**If you see errors:**
```
Failed to load local NLI model, falling back to heuristic: [error message]
Using scorer: token-heuristic-v1 (fallback - basic accuracy)
```

## How to Tell NLI is Actually Working

### Test 1: Contradiction Detection

**Question:** "Should companies use AI to replace employees?"

**Answer with contradictions:**
```
AI should replace employees to improve efficiency. 
AI cannot replace employees because they provide unique value.
```

**What to expect:**
- **With NLI:** Should detect the contradiction and show red edges in graph
- **With heuristic:** Might miss it (only looks for "not" keywords)

### Test 2: Graph Quality

**With NLI working:**
- ✅ More edges in the graph (support, contradiction, grounding)
- ✅ Better accuracy in detecting semantic relationships
- ✅ Graph shows meaningful connections

**With heuristic only:**
- ⚠️ Fewer edges
- ⚠️ Misses semantic contradictions
- ⚠️ Only finds token overlap

### Test 3: Check Scorer ID in Response

The scorer ID is logged, but you can also check it programmatically. The framework uses the scorer ID for caching.

## Troubleshooting

### Issue: Still using heuristic scorer

**Check:**
1. Is `TCL_USE_LOCAL_NLI` set to `false`?
   ```bash
   # In Railway, check environment variables
   # Should be unset or set to "true" (default is true)
   ```

2. Is `TCL_NLI_ENDPOINT` set?
   ```bash
   # If set, it will use custom endpoint instead of local model
   # Unset it to use local transformers model
   ```

3. Is `MISTRAL_API_KEY` set?
   ```bash
   # If set, it will use Mistral API instead of local model
   # Unset it to use local transformers model
   ```

### Issue: Model download failing

**Check:**
1. **Disk space:** Railway needs enough space for ~200MB model
2. **Network:** Model downloads from Hugging Face
3. **Logs:** Look for download errors in Railway logs

### Issue: Model loading slowly

**Normal behavior:**
- First request: 30-60 seconds (downloading model)
- Subsequent requests: Fast (model cached)

**If always slow:**
- Check if model is being cached properly
- Check Railway disk space

## Force Use Local NLI

To ensure local NLI is used:

```bash
# In Railway environment variables:
TCL_USE_LOCAL_NLI=true  # or leave unset (default is true)
# Make sure these are NOT set:
# TCL_NLI_ENDPOINT (unset)
# MISTRAL_API_KEY (unset)
```

## Verify in Code

You can add logging to see which scorer is actually being used:

```typescript
// In orchestrator.ts, the scorer.id is logged
console.log(`Using scorer: ${scorer.id}`);
```

Check your Railway logs for this message after making a validation request.

## Quick Test

1. **Make a validation request** with a question that has contradictions
2. **Check Railway logs** for "Using scorer: transformers-..."
3. **Check the graph** - should have more edges with NLI
4. **Compare** - try with `TCL_USE_LOCAL_NLI=false` to see the difference

## Expected Log Output

**Working NLI:**
```
Using scorer: transformers-deberta-v3-base (local model - downloads ~200MB on first run)
Loading NLI model: Xenova/deberta-v3-base (this may take a minute on first run)...
✅ NLI model loaded: Xenova/deberta-v3-base
Building claim graph...
Using scorer: transformers-deberta-v3-base, Claims: 8, Sources: 0
Claim graph built successfully
Graph stats: 12 supports, 3 contradictions, 5 grounding edges
```

**Not working (heuristic):**
```
Using scorer: token-heuristic-v1 (free, basic accuracy)
💡 Tip: Set TCL_USE_LOCAL_NLI=true to use local NLI model (downloads on first run)
Building claim graph...
Using scorer: token-heuristic-v1, Claims: 8, Sources: 0
Claim graph built successfully
Graph stats: 2 supports, 1 contradictions, 0 grounding edges
```

Notice the difference in graph stats - NLI should find more relationships!

