# TCL NLI Service (Local Model)

Run NLI scoring using a **local Mistral 7B model** (or any local LLM) instead of API calls.

## Why Use Local Models?

- ✅ **No API costs** - Free to run
- ✅ **No rate limits** - Process as many requests as you want
- ✅ **Privacy** - Data never leaves your server
- ✅ **Full control** - Use any model you want

## Setup Options

### Option 1: Using Ollama (Easiest) ⭐ Recommended

Ollama makes it easy to run Mistral locally - **no API keys, no cloud costs!**

1. **Install Ollama:**
   ```bash
   # macOS
   brew install ollama
   
   # Or download from https://ollama.ai
   ```

2. **Pull Mistral model** (downloads ~4GB, one-time):
   ```bash
   ollama pull mistral:7b
   
   # Or use quantized version (smaller, faster):
   ollama pull mistral:7b-instruct-q4_0
   ```

3. **Start Ollama** (runs in background):
   ```bash
   ollama serve
   # Or just run: ollama (starts server automatically)
   ```

4. **Run the local NLI service:**
   ```bash
   cd packages/tcl-nli-local
   npm install
   export OLLAMA_URL=http://localhost:11434  # default Ollama URL
   export MODEL=mistral:7b  # or mistral:7b-instruct-q4_0
   npm start
   ```

5. **Point TCL Core to it:**
   ```bash
   # In Railway or local env
   export TCL_NLI_ENDPOINT=http://localhost:8081
   ```

**That's it!** You now have:
- ✅ **No API keys needed**
- ✅ **Zero ongoing costs**
- ✅ **Excellent NLI quality** (same as Mistral API)
- ✅ **Full privacy** (data never leaves your machine)

### Option 2: Using llama.cpp

If you have Mistral running via llama.cpp:

1. **Run your llama.cpp server** (e.g., on port 8080)
2. **Update the service** to use your llama.cpp endpoint
3. **Set TCL_NLI_ENDPOINT** to point to it

### Option 3: Using Transformers (Python)

If you're using Python with transformers:

1. **Create a FastAPI service** (see `server_python.py` example)
2. **Load Mistral 7B** using transformers
3. **Expose the `/score` endpoint**
4. **Point TCL_NLI_ENDPOINT** to it

## API Contract

The service must implement:

**POST /score**

Request:
```json
{
  "pairs": [
    {
      "task": "contradiction",
      "a": "text A",
      "b": "text B",
      "key": "unique-key"
    }
  ]
}
```

Response:
```json
{
  "scores": [
    {
      "key": "unique-key",
      "score": 0.85
    }
  ]
}
```

## Comparison

| Approach | Cost | Speed | Setup | Best For |
|----------|------|-------|-------|----------|
| **Local Model** | Free | Medium | Medium | Production, privacy |
| **Mistral API** | ~$0.60/1M tokens | Fast | Easy | Quick setup |
| **TokenHeuristic** | Free | Very Fast | None | Development |

## Recommendation

**For production with local models:**
1. ✅ Use Ollama (easiest local setup)
2. ✅ Use `mistral:7b-instruct-q4_0` (quantized, faster, still excellent quality)
3. ✅ Point `TCL_NLI_ENDPOINT` to your local service
4. ✅ No API keys needed!

**Quality:** Local Mistral 7B gives you **excellent NLI quality** - the same as using Mistral's API, but with:
- Zero ongoing costs
- No rate limits  
- Full privacy
- Works offline

**Performance tips:**
- Use quantized model (`q4_0`) for faster inference and less RAM
- GPU acceleration works automatically if available
- Model loads once, then serves requests quickly

