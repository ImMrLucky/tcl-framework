# TCL NLI Service (Mistral 7B)

A simple NLI (Natural Language Inference) service using Mistral 7B for TCL framework.

## Setup

1. **Get Mistral API Key:**
   - Sign up at https://mistral.ai
   - Get your API key from the dashboard

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set environment variables:**
   ```bash
   export MISTRAL_API_KEY="your-api-key"
   export MISTRAL_MODEL="mistral-small-latest"  # or mistral-tiny, mistral-medium
   export PORT=8081
   ```

4. **Run:**
   ```bash
   npm start
   ```

## Deploy to Railway

1. Create new Railway service
2. Set Root Directory: `packages/tcl-nli-service`
3. Set environment variables:
   - `MISTRAL_API_KEY` = your Mistral API key
   - `MISTRAL_MODEL` = `mistral-small-latest` (optional)
   - `PORT` = Railway will auto-assign
4. Get the Railway URL and set in TCL Core:
   - `TCL_NLI_ENDPOINT` = `https://your-nli-service.up.railway.app`

## API Contract

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

## Cost Considerations

Mistral 7B pricing (approximate):
- **mistral-tiny**: ~$0.14 per 1M input tokens
- **mistral-small**: ~$0.60 per 1M input tokens
- **mistral-medium**: ~$2.70 per 1M input tokens

For NLI tasks, `mistral-tiny` or `mistral-small` should be sufficient and cost-effective.

## Comparison

| Model | Speed | Cost | Accuracy | Best For |
|-------|-------|------|----------|----------|
| **Mistral 7B** | Slower | Higher | Good | Complex reasoning |
| **Dedicated NLI** | Fast | Lower | Excellent | Production NLI |

## Recommendation

For production, consider:
1. **Short term:** Use Mistral 7B (this service)
2. **Long term:** Use dedicated NLI models (Hugging Face, Cohere, etc.) for better cost/performance

