# Cost Management for TCL Demo

How to showcase your app with good NLI quality without worrying about costs.

## The Problem

- Hugging Face free tier: 1,000 requests/month
- If your demo gets popular, you could hit limits
- Paid tiers cost money

## Solutions

### Solution 1: Rate Limiting + Fallback (Recommended) ⭐

**Strategy:** Use Hugging Face for demos, but fallback to heuristic if limits hit.

**Implementation:**
1. Add rate limiting to your NLI service
2. Fallback to TokenHeuristicScorer if Hugging Face fails
3. Track usage to monitor costs

**Benefits:**
- ✅ Free tier covers most demos (1,000/month = ~33/day)
- ✅ Graceful degradation if limits hit
- ✅ No surprise bills

### Solution 2: Use Mistral API (Pay-as-you-go)

**Strategy:** Use Mistral API with built-in support, pay only for what you use.

**Cost:** ~$0.60 per 1M tokens (very cheap for demos)

**Example costs:**
- 1,000 requests = ~$0.10-0.50 (depending on text length)
- Much cheaper than you might think!

**Setup:**
```bash
# In Railway (TCL Core)
MISTRAL_API_KEY=your-key
```

**Benefits:**
- ✅ Very cheap for demos
- ✅ No setup needed (built-in)
- ✅ Excellent quality
- ✅ Pay only for what you use

### Solution 3: Hybrid Approach (Best of Both)

**Strategy:** 
- Use Hugging Face free tier for initial demos
- Add rate limiting
- Fallback to Mistral API if Hugging Face limits hit
- Or fallback to TokenHeuristicScorer

**Implementation:**
1. Try Hugging Face first (free)
2. If rate limited, try Mistral API (cheap)
3. If both fail, use TokenHeuristicScorer (free, but lower quality)

### Solution 4: Local Ollama for Production

**Strategy:** For high-traffic scenarios, use local Ollama.

**When to use:**
- App gets popular
- You want zero ongoing costs
- You have infrastructure to run Ollama

**Setup:**
- Deploy Ollama on your own server
- Or use Railway with Ollama (more complex)
- Point `TCL_NLI_ENDPOINT` to it

## Recommended Strategy for Your Demo

### Phase 1: Initial Demo (Now)
**Use Hugging Face free tier:**
- 1,000 requests/month is plenty for initial demos
- Add simple rate limiting
- Monitor usage

### Phase 2: If It Gets Popular
**Add Mistral API as backup:**
- Set `MISTRAL_API_KEY` in Railway
- Framework will use it if Hugging Face fails
- Very cheap ($0.60 per 1M tokens)

### Phase 3: Production Scale
**Use local Ollama:**
- Deploy Ollama on your infrastructure
- Zero ongoing costs
- Full control

## Cost Comparison

| Solution | Cost | Requests/Month | Best For |
|----------|------|----------------|----------|
| **Hugging Face Free** | $0 | 1,000 | Initial demos |
| **Mistral API** | ~$0.60/1M tokens | Unlimited | Popular demos |
| **Local Ollama** | $0 (infrastructure) | Unlimited | Production |
| **TokenHeuristic** | $0 | Unlimited | Fallback |

## Implementation: Add Fallback

You can modify the orchestrator to try multiple scorers:

```typescript
// Try Hugging Face first (free)
// If fails, try Mistral API (cheap)
// If both fail, use TokenHeuristicScorer (free)
```

This gives you:
- ✅ Free tier for most demos
- ✅ Cheap backup if popular
- ✅ Always works (heuristic fallback)

## Monitoring Usage

Track your usage:
- Hugging Face dashboard shows requests
- Mistral API shows token usage
- Set up alerts if approaching limits

## My Recommendation

**For your demo right now:**

1. **Start with Hugging Face free tier**
   - Deploy `tcl-nli-hf` to Railway
   - 1,000 requests/month is plenty for demos
   - Monitor usage

2. **Add Mistral API as backup**
   - Set `MISTRAL_API_KEY` in Railway
   - Framework auto-uses it if Hugging Face fails
   - Very cheap insurance

3. **Add rate limiting** (optional)
   - Limit requests per IP
   - Prevent abuse

**Result:**
- ✅ Free for initial demos
- ✅ Cheap if it gets popular (~$0.10-0.50 per 1,000 requests)
- ✅ Always works (fallback to heuristic)

## Quick Setup

```bash
# 1. Deploy Hugging Face service (free tier)
# Root: packages/tcl-nli-hf
# TCL_NLI_ENDPOINT=https://tcl-nli-hf.up.railway.app

# 2. Add Mistral API as backup (optional)
# MISTRAL_API_KEY=your-key
# (Framework will use it if Hugging Face fails)

# 3. Monitor usage
# Check Hugging Face dashboard
# Check Mistral API usage
```

This gives you the best of both worlds: free tier for demos, cheap backup if popular!

