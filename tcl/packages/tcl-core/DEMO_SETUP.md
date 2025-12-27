# Demo Setup Guide

How to showcase your TCL app with real NLI quality (not just token-based heuristics).

## Option 1: Hugging Face (Easiest for Demo) ⭐ Recommended

**Best for:** Quick demo setup, no local dependencies

### Setup:
1. **Deploy Hugging Face NLI service to Railway:**
   ```bash
   # In Railway, create new service
   # Root Directory: packages/tcl-nli-hf
   # Environment variables:
   # - HUGGINGFACE_API_KEY (optional, but recommended)
   # - HF_MODEL=microsoft/deberta-v3-base
   # - PORT (auto-assigned)
   ```

2. **Point TCL Core to it:**
   ```bash
   # In Railway (TCL Core service)
   TCL_NLI_ENDPOINT=https://your-nli-hf-service.up.railway.app
   ```

3. **That's it!** Your demo now uses real NLI.

**Pros:**
- ✅ No local setup needed
- ✅ Works immediately
- ✅ Free tier (1,000 requests/month)
- ✅ Good quality

**Cons:**
- ⚠️ Rate limits on free tier
- ⚠️ Requires internet

---

## Option 2: Ollama + ngrok (For Local Demo)

**Best for:** Showing off local model capabilities

### Setup:
1. **Install Ollama locally:**
   ```bash
   brew install ollama
   ollama pull mistral:7b
   ollama serve  # Runs on localhost:11434
   ```

2. **Run local NLI service:**
   ```bash
   cd packages/tcl-nli-local
   npm install
   npm start  # Runs on localhost:8081
   ```

3. **Expose with ngrok:**
   ```bash
   # Install ngrok: https://ngrok.com/download
   ngrok http 8081
   # Copy the https URL (e.g., https://abc123.ngrok.io)
   ```

4. **Point TCL Core to ngrok URL:**
   ```bash
   # In Railway (TCL Core service)
   TCL_NLI_ENDPOINT=https://abc123.ngrok.io
   ```

**Pros:**
- ✅ Shows local model capability
- ✅ Zero API costs
- ✅ Good for demos

**Cons:**
- ⚠️ Requires your machine to be running
- ⚠️ ngrok free tier has limitations
- ⚠️ URL changes each time (unless paid ngrok)

---

## Option 3: Deploy Ollama to Railway (Advanced)

**Best for:** Permanent demo setup

This is more complex because Ollama needs to run on Railway. You'd need to:
1. Create a Railway service that runs Ollama
2. Download model on startup
3. Run the NLI service wrapper

**Not recommended** for quick demo - use Hugging Face instead.

---

## Option 4: Use Mistral API (Quick Cloud Option)

**Best for:** Quick demo with good quality

```bash
# In Railway (TCL Core service)
MISTRAL_API_KEY=your-mistral-api-key
```

The framework will automatically use Mistral API (built-in support).

**Pros:**
- ✅ Easiest setup (just API key)
- ✅ Excellent quality
- ✅ No deployment needed

**Cons:**
- ⚠️ Costs money (but cheap for demos)
- ⚠️ Requires API key

---

## Recommendation for Your Demo

### For Quick Demo (Today):
**Use Hugging Face:**
1. Deploy `packages/tcl-nli-hf` to Railway
2. Set `TCL_NLI_ENDPOINT` in TCL Core
3. Done! Real NLI quality, free tier.

### For Impressive Demo (This Week):
**Use Mistral API:**
1. Get Mistral API key (free tier available)
2. Set `MISTRAL_API_KEY` in TCL Core
3. Framework auto-uses it
4. Excellent quality, minimal setup.

### For "Local Model" Demo (Future):
**Use Ollama + ngrok:**
1. Run Ollama locally
2. Expose with ngrok
3. Show users they can run locally too

---

## Quick Start: Hugging Face Demo

```bash
# 1. Deploy NLI service to Railway
cd packages/tcl-nli-hf
# Create Railway service, set root to packages/tcl-nli-hf
# Add env var: HUGGINGFACE_API_KEY (optional)

# 2. Get Railway URL
# e.g., https://tcl-nli-hf.up.railway.app

# 3. Update TCL Core Railway service
# Add env var: TCL_NLI_ENDPOINT=https://tcl-nli-hf.up.railway.app

# 4. Test!
# Your demo now uses real NLI!
```

---

## Testing Your Demo

After setting up, test with a question that has contradictions:

**Question:** "What are the pros and cons of social media?"

**Answer with contradictions:**
```
Social media platforms have a responsibility to remove harmful content. 
Content moderation violates free speech principles. 
Platforms should be neutral and not censor any content.
```

**You should see:**
- ✅ Graph with contradiction edges (red)
- ✅ Better coherence scores
- ✅ More accurate relationship detection

vs. TokenHeuristicScorer which would miss most of these.

