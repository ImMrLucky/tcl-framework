# Default NLI Model (No API Keys Needed!)

## The Solution: Local Transformers Model

Instead of bundling Mistral 7B (too large), we use a **smaller NLI model** that:
- ✅ **Downloads on first run** (~200MB, not 4GB)
- ✅ **Caches locally** (fast subsequent runs)
- ✅ **No API keys needed** (works out of box)
- ✅ **Good NLI quality** (designed for this task)
- ✅ **Users can override** with their own NLI endpoint

## How It Works

### Default Behavior (No Config)

1. **First run:** Downloads `Xenova/deberta-v3-base` (~200MB)
2. **Caches locally:** Stores in `.tcl_models/` directory
3. **Uses for NLI:** Provides good quality NLI scoring
4. **No API keys:** Works completely offline

### User Override

Users can override with their own NLI:

```bash
# Use their own NLI endpoint
export TCL_NLI_ENDPOINT=https://their-nli-service.com

# Or use Mistral API
export MISTRAL_API_KEY=their-key

# Or disable local model
export TCL_USE_LOCAL_NLI=false
```

## Why Not Bundle Mistral 7B?

| Issue | Mistral 7B | Small NLI Model |
|-------|------------|-----------------|
| **Size** | 4-7 GB | 200 MB |
| **RAM** | 8-16 GB | 1-2 GB |
| **Speed** | Slow (CPU) | Fast (optimized) |
| **Purpose** | General LLM | NLI-specific |
| **Bundle?** | ❌ Too large | ✅ Can download |

## Model Details

**Default Model:** `Xenova/deberta-v3-base`
- **Size:** ~200 MB (quantized)
- **Quality:** Excellent for NLI
- **Speed:** Fast (CPU-optimized)
- **Purpose:** Specifically designed for NLI tasks

**Alternative Models:**
```bash
# Use different model
export TCL_LOCAL_NLI_MODEL=Xenova/roberta-large-mnli
```

## Implementation

The framework automatically:
1. ✅ Tries custom NLI endpoint first (if set)
2. ✅ Falls back to Mistral API (if key provided)
3. ✅ Uses local transformers model (default, downloads on first run)
4. ✅ Falls back to heuristic (if all else fails)

**No configuration needed** - it just works!

## Benefits

- ✅ **Works out of box** - No API keys, no setup
- ✅ **Good quality** - Real NLI, not just heuristics
- ✅ **Small download** - 200MB vs 4GB
- ✅ **User flexibility** - Can override with better models
- ✅ **No ongoing costs** - Free to run

This gives you the best of both worlds: a default that works, but users can upgrade!

