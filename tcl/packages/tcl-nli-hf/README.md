# TCL NLI Service (Hugging Face - FREE!)

Use **Hugging Face's free Inference API** for NLI scoring. Perfect for testing and demos!

## Why Hugging Face?

- ✅ **FREE tier** - 1,000 requests/month (no credit card needed!)
- ✅ **No setup** - Just get an API key
- ✅ **Good models** - Pre-trained NLI models available
- ✅ **Easy upgrade** - Can use paid tier for more requests

## Quick Setup

### 1. Get Free API Key (Optional but Recommended)

1. Sign up at https://huggingface.co (free)
2. Go to https://huggingface.co/settings/tokens
3. Create a new token (read access is enough)
4. Copy the token

**Note:** You can use the service WITHOUT an API key, but you'll have lower rate limits.

### 2. Run the Service

```bash
cd packages/tcl-nli-hf
npm install

# With API key (recommended)
export HUGGINGFACE_API_KEY=your-token-here
npm start

# Without API key (free tier, rate limited)
npm start
```

### 3. Point TCL Core to It

```bash
# In Railway or local env
export TCL_NLI_ENDPOINT=http://localhost:8081
```

Or if deployed:
```bash
export TCL_NLI_ENDPOINT=https://your-service.up.railway.app
```

## Recommended Models

The service uses `microsoft/deberta-v3-base` by default, which is excellent for NLI.

You can change it:

```bash
export HF_MODEL=roberta-large-mnli  # Specifically trained for NLI
# or
export HF_MODEL=facebook/bart-large-mnli  # Also great for NLI
```

### Model Comparison

| Model | Speed | Accuracy | Best For |
|-------|-------|----------|----------|
| `microsoft/deberta-v3-base` | Fast | Excellent | General NLI |
| `roberta-large-mnli` | Medium | Excellent | NLI tasks |
| `facebook/bart-large-mnli` | Medium | Excellent | NLI tasks |

## Free Tier Limits & Cost Management

- **Without API key:** ~30 requests/minute (shared rate limit)
- **With free API key:** 1,000 requests/month (personal limit)
- **Paid tier:** Higher limits available

### Rate Limiting (Built-in Protection)

The service includes rate limiting to prevent abuse:
- **Default:** 10 requests/minute per IP
- **Configurable:** Set `RATE_LIMIT_PER_MINUTE` environment variable
- **Protection:** Prevents one user from consuming all free tier requests

### Cost Management Strategy

**For demos:**
1. ✅ Use free tier (1,000 requests/month = ~33/day)
2. ✅ Built-in rate limiting prevents abuse
3. ✅ Monitor usage in Hugging Face dashboard

**If it gets popular:**
1. ✅ Add Mistral API as backup (very cheap: ~$0.60 per 1M tokens)
2. ✅ Or upgrade to Hugging Face paid tier
3. ✅ Or use local Ollama (zero ongoing costs)

**See `packages/tcl-core/COST_MANAGEMENT.md` for detailed cost strategies.**

## Deploy to Railway (For Demo)

**Perfect for showcasing your app with real NLI quality!**

1. **Create new Railway service:**
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repo
   - Set **Root Directory:** `packages/tcl-nli-hf`

2. **Set environment variables:**
   - `HUGGINGFACE_API_KEY` = your HF token (optional but recommended for higher limits)
   - `HF_MODEL` = `microsoft/deberta-v3-base` (optional, this is the default)
   - `PORT` = Railway will auto-assign (don't set this)

3. **Deploy and get URL:**
   - Railway will build and deploy automatically
   - Copy the service URL (e.g., `https://tcl-nli-hf.up.railway.app`)

4. **Point TCL Core to it:**
   - In your **TCL Core Railway service**, add environment variable:
   - `TCL_NLI_ENDPOINT` = `https://tcl-nli-hf.up.railway.app`

5. **That's it!** Your demo now uses real NLI quality!

**Note:** The first request might take 10-20 seconds (model loading), then it's fast.

## Testing

```bash
# Health check
curl http://localhost:8081/health

# Test scoring
curl -X POST http://localhost:8081/score \
  -H "Content-Type: application/json" \
  -d '{
    "pairs": [
      {
        "task": "contradiction",
        "a": "The sky is blue",
        "b": "The sky is red",
        "key": "test-1"
      }
    ]
  }'
```

## Troubleshooting

### Model Loading (503 Error)

If you see "Model is loading", the service will automatically:
1. Wait 10 seconds
2. Retry the request

This happens on first use or after inactivity.

### Rate Limiting

If you hit rate limits:
1. Get a free API key (increases limits)
2. Wait a few minutes
3. Consider upgrading to paid tier

## Cost Comparison

| Service | Cost | Requests/Month |
|---------|------|---------------|
| **Hugging Face (Free)** | $0 | 1,000 |
| **Hugging Face (Paid)** | ~$0.10/1K | Unlimited |
| **Mistral API** | ~$0.60/1M tokens | Unlimited |
| **Local Model** | $0 | Unlimited |

## Recommendation

For **testing and demos**: Use Hugging Face free tier!
- Easy setup
- Good accuracy
- No credit card needed

For **production**: Consider:
- Hugging Face paid tier (if you like it)
- Local model (zero ongoing costs)
- Mistral API (if you prefer cloud)

