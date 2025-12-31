# Free Mode - No OpenAI Costs

## ✅ 100% Free Features (No API Keys Needed)

### Audio Transcription
- **Uses:** Local Whisper model (via @xenova/transformers)
- **Cost:** FREE
- **No API keys required**
- **Works offline** (after first model download)
- **Endpoint:** `POST /transcribe`

### Text/File Ingestion
- **Uses:** Local parsing (TXT, CSV, JSON)
- **Cost:** FREE
- **No API keys required**
- **Endpoint:** `POST /conversations`

### Evaluation/Validation
- **Uses:** Local NLI models (via @xenova/transformers)
- **Cost:** FREE
- **No API keys required**
- **Works offline** (after first model download)
- **Endpoint:** `POST /validate`

## ⚠️ Optional: OpenAI (Only If You Set API Key)

OpenAIAdapter is **completely optional** and only used if:
1. `OPENAI_API_KEY` environment variable is set
2. You're using the `/validate` endpoint for claim extraction

### When OpenAIAdapter is Used

**Only for:** `/validate` endpoint claim extraction (alternative to local extraction)

**Not used for:**
- ❌ Audio transcription (uses free local Whisper)
- ❌ File ingestion (uses free local parsing)
- ❌ Evaluation scoring (uses free local NLI models)

### How to Stay 100% Free

**Don't set `OPENAI_API_KEY` environment variable**

```bash
# ✅ FREE MODE (default)
# Don't set OPENAI_API_KEY
# Everything uses free local models

# ❌ PAID MODE (optional)
export OPENAI_API_KEY=sk-...
# Only /validate endpoint will use OpenAI for claim extraction
```

## Cost Breakdown

| Feature | Default (Free) | With OpenAI Key |
|---------|---------------|-----------------|
| **Audio Transcription** | ✅ Free (Local Whisper) | ✅ Free (Local Whisper) |
| **File Ingestion** | ✅ Free (Local parsing) | ✅ Free (Local parsing) |
| **Evaluation** | ✅ Free (Local NLI) | ✅ Free (Local NLI) |
| **Claim Extraction** | ✅ Free (Regex-based) | ⚠️ Paid (OpenAI API) |

## Startup Messages

When you see:
```
OpenAIAdapter assigned
```

This just means the adapter was loaded. **It won't be used unless:**
1. `OPENAI_API_KEY` is set
2. You call `/validate` endpoint
3. The request doesn't already have an adapter

**To avoid this message entirely:**
- Don't set `OPENAI_API_KEY` environment variable
- The adapter won't be loaded
- You'll see: "OpenAIAdapter skipped (no OPENAI_API_KEY - using free local models)"

## Verification

Check your logs:
- ✅ **Free mode:** "OpenAIAdapter skipped (no OPENAI_API_KEY - using free local models)"
- ⚠️ **Paid mode:** "OpenAIAdapter assigned (optional - only used if OPENAI_API_KEY is set)"

## Summary

**By default, everything is FREE:**
- ✅ Audio transcription = Free (local Whisper)
- ✅ File ingestion = Free (local parsing)
- ✅ Evaluation = Free (local NLI models)
- ✅ Claim extraction = Free (regex-based)

**OpenAI is only used if you explicitly set the API key** and only for claim extraction in `/validate` endpoint.

