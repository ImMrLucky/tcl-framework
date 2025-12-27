# TCL Scorers Guide

The TCL framework uses **scorers** to determine relationships between claims (support, contradiction, grounding). The scorer you choose significantly impacts the quality of the graph.

## Available Scorers

### 1. TokenHeuristicScorer (Default - Free) ⚠️ Basic

**What it does:**
- Simple token overlap matching
- Detects contradictions by looking for "not" keywords
- Fast but limited accuracy

**When to use:**
- Development/testing
- When you don't have an NLI service
- For simple use cases
- **Default** - Works immediately, no setup needed

**Limitations:**
- Can't detect semantic contradictions (e.g., "should remove" vs "should not censor")
- Misses nuanced relationships
- Low accuracy for complex text

**Status:** This is the default. Works out of the box, but with limited accuracy.

---

### 2. MistralNliScorer (Easy Upgrade) ✅ Recommended

**What it does:**
- Built-in Mistral 7B API integration
- Auto-enabled if `MISTRAL_API_KEY` is set
- No separate service deployment needed
- Much better accuracy than heuristic

**When to use:**
- Production deployments
- When you want better accuracy without deploying a service
- Quick upgrade path (just set API key)

**How to enable:**
```bash
# Set in Railway environment variables
MISTRAL_API_KEY=your-mistral-api-key
MISTRAL_MODEL=mistral-small-latest  # optional, defaults to mistral-small-latest
```

**Cost:** ~$0.60 per 1M input tokens (mistral-small)

**Status:** Auto-enabled when `MISTRAL_API_KEY` is set. No code changes needed!

---

### 3. HttpNliScorer (Custom Service) ✅ Advanced

**What it does:**
- Calls an external NLI (Natural Language Inference) service
- Uses ML models to understand semantic relationships
- Much more accurate than token-based scoring

**When to use:**
- Production deployments
- When you need accurate relationship detection
- For complex or nuanced text

**Requirements:**
- An NLI service that implements the `/score` endpoint
- The service must accept batch requests

---

## How to Configure Scorers

### Option 1: Use TokenHeuristicScorer (Default - No Config Needed)

This is the default. It's already working, but with limited accuracy.

**To improve it:**
- Lowered thresholds (already done)
- The graph should now find more relationships

---

### Option 2: Use MistralNliScorer (Recommended - Easy Upgrade)

**Option A: Mistral API (Cloud)**

Just set one environment variable:

```bash
MISTRAL_API_KEY=your-api-key-here
```

That's it! The framework will automatically use Mistral for better accuracy.

**Optional:**
```bash
MISTRAL_MODEL=mistral-tiny-latest  # Cheaper, still good
# or
MISTRAL_MODEL=mistral-medium-latest  # Best accuracy, more expensive
```

**Get Mistral API Key:**
1. Sign up at https://mistral.ai
2. Get your API key from the dashboard
3. Set it in Railway environment variables

**Option B: Local Mistral Model (No API Key Needed!)**

If you have Mistral 7B running locally (via Ollama, llama.cpp, etc.):

1. **Run the local NLI service:**
   ```bash
   cd packages/tcl-nli-local
   npm install
   export OLLAMA_URL=http://localhost:11434  # or your local inference server
   npm start
   ```

2. **Point TCL Core to it:**
   ```bash
   export TCL_NLI_ENDPOINT=http://localhost:8081
   ```

No API key needed! See `packages/tcl-nli-local/README.md` for details.

---

### Option 3: Use HttpNliScorer (Custom Service - Advanced)

You need to provide an NLI endpoint. Here are your options:

#### A. Use Hugging Face (FREE - Recommended for Testing!)

**Easiest free option!**

1. **Get a free API key** (optional but recommended):
   - Sign up at https://huggingface.co (free)
   - Get token at https://huggingface.co/settings/tokens

2. **Run the Hugging Face NLI service:**
   ```bash
   cd packages/tcl-nli-hf
   npm install
   export HUGGINGFACE_API_KEY=your-token-here  # optional
   npm start
   ```

3. **Point TCL Core to it:**
   ```bash
   export TCL_NLI_ENDPOINT=http://localhost:8081
   ```

**Free tier:** 1,000 requests/month (no credit card needed!)

See `packages/tcl-nli-hf/README.md` for full setup.

#### B. Use Other Services

**Option: Use a hosted NLI service**

Services like:
- **Hugging Face Inference API** (free tier available)
- **Cohere API** (has NLI endpoints, free tier)
- **Custom service** you build

#### B. Build Your Own NLI Service

Create a service that implements this contract:

**Endpoint:** `POST /score`

**Request:**
```json
{
  "pairs": [
    {
      "task": "entailment",
      "a": "premise text",
      "b": "hypothesis text",
      "key": "unique-key-123"
    },
    {
      "task": "contradiction",
      "a": "text A",
      "b": "text B",
      "key": "unique-key-456"
    },
    {
      "task": "grounding",
      "a": "claim text",
      "b": "source text",
      "key": "unique-key-789"
    }
  ]
}
```

**Response:**
```json
{
  "scores": [
    {
      "key": "unique-key-123",
      "score": 0.85,
      "quote": "optional supporting text"
    },
    {
      "key": "unique-key-456",
      "score": 0.92,
      "quote": null
    }
  ]
}
```

**Scores:**
- `entailment`: 0.0-1.0 (how much does premise support hypothesis)
- `contradiction`: 0.0-1.0 (how contradictory are the texts)
- `grounding`: 0.0-1.0 (how well does source support claim)

---

## How to Enable HttpNliScorer

### In the UI (via options):

The UI would need to send `nliEndpoint` in the options. Currently, the UI doesn't have this configured.

### Via Environment Variables (Recommended):

Add to Railway environment variables:
- `TCL_NLI_ENDPOINT` = `https://your-nli-service.com`
- `TCL_NLI_API_KEY` = `your-api-key` (optional)
- `TCL_NLI_MODEL_ID` = `model-name` (optional)

Then modify the code to read from environment variables.

---

## Quick Fix: Improve Current Setup

Since you're using `TokenHeuristicScorer`, the recent changes I made should help:

1. ✅ Lowered thresholds (already done)
2. ✅ Increased maxPairwiseEdges (already done)
3. ✅ Improved contradiction detection (already done)

**Try validating again** - you should see more graph edges now.

---

## Recommendation

### For Testing/Quick Start (FREE!):
- ✅ **Use Hugging Face NLI** (1,000 free requests/month)
  - Run: `cd packages/tcl-nli-hf && npm install && npm start`
  - Set: `TCL_NLI_ENDPOINT=http://localhost:8081`
  - No credit card needed!

### For New Users:
- ✅ **Start with TokenHeuristicScorer** (default, free, works immediately)
- ✅ **Try Hugging Face NLI** for free to see real NLI quality

### For Production:
- ✅ **Use MistralNliScorer** (easiest, built-in, good accuracy)
- ✅ **Or use Hugging Face** (free tier or paid for more requests)
- ✅ **Or use local model** (best for high volume, zero ongoing costs)

### Scorer Priority (Auto-detected):
1. **Custom NLI endpoint** (`TCL_NLI_ENDPOINT`) - Most flexible (can be local model or Hugging Face!)
2. **Mistral API** (`MISTRAL_API_KEY`) - Easiest cloud upgrade
3. **TokenHeuristicScorer** (default) - Free, works out of box

**💡 Pro Tip:** Start with Hugging Face free tier to test real NLI quality, then upgrade to local model or paid service for production!

---

## Example NLI Service Setup

If you want to set up an NLI service quickly, you could:

1. Use Hugging Face Inference API
2. Create a simple Node.js service that proxies to it
3. Deploy it to Railway
4. Set `TCL_NLI_ENDPOINT` to point to it

Would you like me to create a simple NLI proxy service for you?

