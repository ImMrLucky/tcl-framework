# Using Local Models (No API Key Needed!)

You can use Mistral 7B (or any LLM) locally without any API keys. Here's how:

## Why Not Bundle the Model?

**Don't bundle the model file into your app:**
- ❌ Mistral 7B is ~4-7 GB (huge!)
- ❌ Slow app startup (loading model)
- ❌ High memory usage
- ❌ Hard to update model

**Instead, use a local inference server:**
- ✅ Model runs separately (better performance)
- ✅ Can share model across apps
- ✅ Easy to update/swap models
- ✅ Better resource management

## Best Options for Local Models

### Option 1: Ollama (Easiest) ⭐ Recommended

**Why Ollama?**
- ✅ Super easy setup
- ✅ Handles model downloads automatically
- ✅ Optimized for local inference
- ✅ Supports many models (Mistral, Llama, etc.)

**Setup:**
```bash
# 1. Install Ollama
brew install ollama  # macOS
# or download from https://ollama.ai

# 2. Pull Mistral model (downloads ~4GB)
ollama pull mistral:7b

# 3. Start Ollama (runs in background)
ollama serve

# 4. Run the local NLI service
cd packages/tcl-nli-local
npm install
npm start

# 5. Point TCL Core to it
export TCL_NLI_ENDPOINT=http://localhost:8081
```

**That's it!** No API keys, no cloud costs, works offline.

### Option 2: llama.cpp (More Control)

If you want more control or have specific requirements:

```bash
# 1. Download Mistral GGUF file
# (from Hugging Face or Mistral's website)

# 2. Run llama.cpp server
./llama-server -m mistral-7b.gguf --port 8080

# 3. Update tcl-nli-local to use your llama.cpp endpoint
# (modify the server.js to point to your endpoint)
```

### Option 3: Transformers (Python)

If you prefer Python:

```bash
# 1. Install transformers
pip install transformers torch

# 2. Create a FastAPI service (see example below)
# 3. Load model once, serve requests
```

## Quality Comparison

| Approach | Accuracy | Speed | Setup | Best For |
|---------|----------|-------|-------|----------|
| **Local Mistral 7B** | Excellent | Medium | Easy (Ollama) | Production, privacy |
| **Hugging Face API** | Excellent | Fast | Very Easy | Testing, demos |
| **Mistral API** | Excellent | Fast | Easy | Quick setup |
| **TokenHeuristic** | Poor | Very Fast | None | Development |

**Local Mistral 7B gives you:**
- ✅ Same quality as Mistral API
- ✅ Zero API costs
- ✅ No rate limits
- ✅ Full privacy (data never leaves your machine)

## Performance Tips

1. **Use quantized models** (smaller, faster):
   ```bash
   ollama pull mistral:7b-instruct-q4_0  # Quantized, faster
   ```

2. **GPU acceleration** (if available):
   - Ollama automatically uses GPU if available
   - Much faster inference

3. **Model size trade-offs**:
   - `mistral:7b` - Best quality, ~4GB
   - `mistral:7b-instruct-q4_0` - Good quality, ~2GB, faster
   - `mistral-tiny` - Smaller, faster, slightly lower quality

## Example: Python Service (Alternative)

If you want to use Python instead of Node.js:

```python
# server.py
from fastapi import FastAPI
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

app = FastAPI()

# Load model once at startup
model_name = "mistralai/Mistral-7B-Instruct-v0.2"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSequenceClassification.from_pretrained(model_name)

@app.post("/score")
async def score(pairs: list):
    scores = []
    for pair in pairs:
        # Format for NLI task
        inputs = tokenizer(pair["a"], pair["b"], return_tensors="pt")
        outputs = model(**inputs)
        score = torch.softmax(outputs.logits, dim=-1)[0]
        scores.append({"key": pair["key"], "score": float(score[1])})
    return {"scores": scores}
```

## Recommendation

**For your use case:**
1. ✅ **Use Ollama** - Easiest, works great
2. ✅ **Use `tcl-nli-local`** - Already set up for you
3. ✅ **Point `TCL_NLI_ENDPOINT`** to it

**Result:**
- No API keys needed
- Excellent NLI quality (same as Mistral API)
- Zero ongoing costs
- Full privacy

## Troubleshooting

### Model not loading?
```bash
# Check if Ollama is running
ollama list  # Should show mistral:7b

# If not, pull it again
ollama pull mistral:7b
```

### Slow inference?
- Use quantized model: `ollama pull mistral:7b-instruct-q4_0`
- Check if GPU is being used: `ollama ps`
- Consider smaller model: `ollama pull mistral-tiny`

### Memory issues?
- Use quantized model (less RAM)
- Close other apps
- Consider smaller model

