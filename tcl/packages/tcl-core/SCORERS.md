# TCL Scorers Guide

The TCL framework uses **scorers** to determine relationships between claims (support, contradiction, grounding). The scorer you choose significantly impacts the quality of the graph.

## Available Scorers

### 1. TokenHeuristicScorer (Default) ⚠️ Basic

**What it does:**
- Simple token overlap matching
- Detects contradictions by looking for "not" keywords
- Fast but limited accuracy

**When to use:**
- Development/testing
- When you don't have an NLI service
- For simple use cases

**Limitations:**
- Can't detect semantic contradictions (e.g., "should remove" vs "should not censor")
- Misses nuanced relationships
- Low accuracy for complex text

**Current status:** This is what you're using now, which is why graph edges are empty.

---

### 2. HttpNliScorer (Recommended) ✅ Production

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

### Option 1: Use TokenHeuristicScorer (Current - No Config Needed)

This is the default. It's already working, but with limited accuracy.

**To improve it:**
- I've already lowered the thresholds (done in recent changes)
- The graph should now find more relationships

---

### Option 2: Use HttpNliScorer (Recommended for Production)

You need to provide an NLI endpoint. Here are your options:

#### A. Use OpenAI's API (Easiest)

You can create a simple NLI service that wraps OpenAI's API, or use a service like:

**Option: Use Hugging Face Inference API**

1. Get a Hugging Face API key: https://huggingface.co/settings/tokens
2. Use a model like `microsoft/deberta-v3-base` or `roberta-large-mnli`
3. Create a simple proxy service (or use Railway to host it)

**Option: Use a hosted NLI service**

Services like:
- **Inference API** (Hugging Face)
- **Cohere API** (has NLI endpoints)
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

For **production/demos**, you should:

1. **Short term:** Use the improved TokenHeuristicScorer (current setup)
   - Should work better now with lower thresholds
   - Good enough for demos

2. **Long term:** Set up an NLI service
   - Much more accurate
   - Better graph quality
   - Required for production use

---

## Example NLI Service Setup

If you want to set up an NLI service quickly, you could:

1. Use Hugging Face Inference API
2. Create a simple Node.js service that proxies to it
3. Deploy it to Railway
4. Set `TCL_NLI_ENDPOINT` to point to it

Would you like me to create a simple NLI proxy service for you?

