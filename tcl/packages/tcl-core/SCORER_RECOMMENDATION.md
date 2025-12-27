# Scorer Recommendation: Default Strategy

## Should Mistral 7B be the default?

### Recommendation: **No, but make it easy to enable**

Here's why and how:

---

## Current Strategy (Recommended)

### Default: TokenHeuristicScorer
- ✅ **Free** - No API costs
- ✅ **No setup** - Works immediately
- ✅ **Fast** - No network calls
- ✅ **Good for demos** - Shows the framework works
- ⚠️ **Limited accuracy** - But acceptable for many use cases

### Optional: HttpNliScorer (Mistral or any NLI)
- ✅ **High accuracy** - Much better results
- ✅ **Easy to enable** - Just set environment variable
- ⚠️ **Requires API key** - Mistral API key needed
- ⚠️ **Costs money** - API calls cost per request
- ⚠️ **Slower** - Network latency

---

## Why Not Make Mistral Default?

1. **Cost barrier**: Users would need to pay for API calls immediately
2. **Setup friction**: Requires API key before trying the framework
3. **Vendor lock-in**: Forces users into Mistral ecosystem
4. **Free tier concerns**: Mistral may have rate limits

---

## Better Approach: Smart Defaults with Easy Upgrade

### Strategy:
1. **Default**: TokenHeuristicScorer (free, works out of box)
2. **Auto-upgrade**: If `TCL_NLI_ENDPOINT` or `MISTRAL_API_KEY` is set, use NLI
3. **Clear documentation**: Show users how to upgrade

### Implementation:
```typescript
// Auto-detect best available scorer
const scorer = 
  // Priority 1: Custom NLI endpoint
  options?.nliEndpoint || process.env.TCL_NLI_ENDPOINT
    ? new HttpNliScorer({ endpoint: ..., apiKey: ..., modelId: ... })
  // Priority 2: Mistral API (if key provided)
  : process.env.MISTRAL_API_KEY
    ? new MistralNliScorer({ apiKey: process.env.MISTRAL_API_KEY })
  // Priority 3: Default heuristic
  : new TokenHeuristicScorer();
```

---

## Recommended User Experience

### For New Users (Default):
- Framework works immediately with TokenHeuristicScorer
- Good enough to see how it works
- No setup required

### For Production Users:
- Set `TCL_NLI_ENDPOINT` or `MISTRAL_API_KEY`
- Automatically upgrades to better scorer
- Much better accuracy

### For Advanced Users:
- Provide their own NLI endpoint
- Full control over scoring

---

## Mistral Integration Options

### Option A: Built-in Mistral Support (Recommended)
Add a `MistralNliScorer` class that:
- Uses Mistral API directly (no separate service needed)
- Auto-enabled if `MISTRAL_API_KEY` is set
- Falls back to heuristic if not set

### Option B: Separate Service (Current)
- Deploy `tcl-nli-service` separately
- Set `TCL_NLI_ENDPOINT` to point to it
- More flexible but requires deployment

---

## My Recommendation

**Keep TokenHeuristicScorer as default**, but:

1. **Add built-in Mistral support** (Option A above)
   - If `MISTRAL_API_KEY` is set, automatically use Mistral
   - No separate service deployment needed
   - Best of both worlds

2. **Make it obvious in logs**:
   ```
   Using scorer: token-heuristic-v1 (free, basic accuracy)
   To upgrade: Set MISTRAL_API_KEY for better accuracy
   ```

3. **Document the upgrade path clearly**

This gives users:
- ✅ Immediate value (works out of box)
- ✅ Easy upgrade path (just set API key)
- ✅ No vendor lock-in (can use any NLI service)

---

## Implementation Plan

Would you like me to:
1. Add built-in Mistral support (direct API integration)?
2. Keep current approach (separate service)?
3. Add auto-detection that upgrades when API key is available?

