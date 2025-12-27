import express from "express";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Configuration
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || "";
const MODEL = process.env.HF_MODEL || "microsoft/deberta-v3-base"; // Good NLI model
const PORT = Number(process.env.PORT || 8081);

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    service: "tcl-nli-hf",
    model: MODEL,
    hasApiKey: !!HF_API_KEY
  });
});

// NLI scoring endpoint
app.post("/score", async (req, res) => {
  try {
    // Simple rate limiting
    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ 
        error: "Rate limit exceeded", 
        message: `Maximum ${RATE_LIMIT_PER_MINUTE} requests per minute. Please try again later.` 
      });
    }

    const { pairs } = req.body;
    if (!Array.isArray(pairs)) {
      return res.status(400).json({ error: "pairs must be an array" });
    }

    const scores = await Promise.all(
      pairs.map(async (pair) => {
        const { task, a, b, key } = pair;
        
        try {
          // Hugging Face Inference API endpoint
          const url = `https://api-inference.huggingface.co/models/${MODEL}`;
          
          // For NLI models, we use the premise-hypothesis format
          // Most NLI models expect: { "inputs": "premise [SEP] hypothesis" }
          // Or for some models: { "inputs": { "premise": "...", "hypothesis": "..." } }
          
          let payload;
          if (task === "entailment") {
            // For entailment: premise -> hypothesis
            payload = { inputs: `${a} [SEP] ${b}` };
          } else if (task === "contradiction") {
            // For contradiction: check if statements contradict
            // We'll use the NLI model and look for contradiction label
            payload = { inputs: `${a} [SEP] ${b}` };
          } else if (task === "grounding") {
            // For grounding: claim -> source (treat as entailment)
            payload = { inputs: `${a} [SEP] ${b}` };
          } else {
            return { key, score: 0.0 };
          }

          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(HF_API_KEY ? { Authorization: `Bearer ${HF_API_KEY}` } : {})
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            // Handle rate limiting or model loading
            if (response.status === 503) {
              const error = await response.json();
              if (error.error?.includes("loading")) {
                console.warn(`Model ${MODEL} is loading, waiting 10s...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                // Retry once
                const retryResponse = await fetch(url, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(HF_API_KEY ? { Authorization: `Bearer ${HF_API_KEY}` } : {})
                  },
                  body: JSON.stringify({ inputs })
                });
                if (!retryResponse.ok) {
                  throw new Error(`HF API error ${retryResponse.status}`);
                }
                const retryData = await retryResponse.json();
                return parseHfResponse(retryData, task, key);
              }
            }
            const error = await response.text();
            throw new Error(`HF API error ${response.status}: ${error}`);
          }

          const data = await response.json();
          return parseHfResponse(data, task, key);
        } catch (error) {
          console.error(`Error scoring pair ${key}:`, error);
          return { key, score: 0.0 };
        }
      })
    );

    res.json({ scores });
  } catch (error) {
    console.error("Error in /score endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

function parseHfResponse(data, task, key) {
  // HF API returns different formats depending on the model
  // For NLI models, it typically returns: [{label: "ENTAILMENT", score: 0.95}, ...]
  
  if (Array.isArray(data) && data.length > 0) {
    // Standard NLI model response
    const result = data[0];
    
    if (task === "entailment") {
      // Look for ENTAILMENT label
      const entailment = result.find(r => 
        r.label?.toUpperCase().includes("ENTAIL") || 
        r.label?.toUpperCase().includes("SUPPORT")
      );
      return { key, score: entailment?.score || 0.0 };
    } else if (task === "contradiction") {
      // Look for CONTRADICTION label
      const contradiction = result.find(r => 
        r.label?.toUpperCase().includes("CONTRADICT") || 
        r.label?.toUpperCase().includes("CONFLICT")
      );
      return { key, score: contradiction?.score || 0.0 };
    } else if (task === "grounding") {
      // For grounding, use entailment score
      const entailment = result.find(r => 
        r.label?.toUpperCase().includes("ENTAIL") || 
        r.label?.toUpperCase().includes("SUPPORT")
      );
      return { key, score: entailment?.score || 0.0 };
    }
  } else if (data.label && typeof data.score === "number") {
    // Single result format
    if (task === "entailment" && data.label.toUpperCase().includes("ENTAIL")) {
      return { key, score: data.score };
    } else if (task === "contradiction" && data.label.toUpperCase().includes("CONTRADICT")) {
      return { key, score: data.score };
    } else if (task === "grounding") {
      return { key, score: data.score };
    }
  }
  
  // Fallback: use first score if available
  if (Array.isArray(data) && data[0]?.score) {
    return { key, score: data[0].score };
  }
  
  return { key, score: 0.0 };
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TCL NLI Hugging Face Service listening on ${PORT}`);
  console.log(`Using model: ${MODEL}`);
  if (!HF_API_KEY) {
    console.warn(`⚠️  No HUGGINGFACE_API_KEY set. Using free tier (rate limited).`);
    console.warn(`   Get a free key at: https://huggingface.co/settings/tokens`);
  } else {
    console.log(`✅ Using Hugging Face API key (higher rate limits)`);
  }
});

