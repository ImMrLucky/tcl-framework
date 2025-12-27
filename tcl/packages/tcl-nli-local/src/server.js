import express from "express";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.MODEL || "mistral:7b";
const PORT = Number(process.env.PORT || 8081);

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    service: "tcl-nli-local",
    ollamaUrl: OLLAMA_URL,
    model: MODEL
  });
});

// NLI scoring endpoint
app.post("/score", async (req, res) => {
  try {
    const { pairs } = req.body;
    if (!Array.isArray(pairs)) {
      return res.status(400).json({ error: "pairs must be an array" });
    }

    const scores = await Promise.all(
      pairs.map(async (pair) => {
        const { task, a, b, key } = pair;
        
        // Create prompt based on task type
        let prompt;
        if (task === "entailment") {
          prompt = `Given the premise: "${a}"\n\nDoes this hypothesis follow from the premise: "${b}"?\n\nRespond with ONLY a number between 0.0 and 1.0, where 1.0 means the hypothesis definitely follows from the premise, and 0.0 means it does not follow at all.`;
        } else if (task === "contradiction") {
          prompt = `Do these two statements contradict each other?\n\nStatement A: "${a}"\nStatement B: "${b}"\n\nRespond with ONLY a number between 0.0 and 1.0, where 1.0 means they strongly contradict, and 0.0 means they do not contradict.`;
        } else if (task === "grounding") {
          prompt = `Does this source text support this claim?\n\nClaim: "${a}"\nSource: "${b}"\n\nRespond with ONLY a number between 0.0 and 1.0, where 1.0 means the source strongly supports the claim, and 0.0 means it does not support it.`;
        } else {
          return { key, score: 0.0 };
        }

        try {
          // Call Ollama API
          const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: MODEL,
              prompt: prompt,
              stream: false,
              options: {
                temperature: 0.1, // Low temperature for consistent scoring
                num_predict: 10  // We only need a number
              }
            })
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama API error ${response.status}: ${error}`);
          }

          const data = await response.json();
          const content = data.response?.trim() || "0.0";
          
          // Extract number from response (handle cases like "0.85" or "The score is 0.85")
          const match = content.match(/(\d+\.?\d*)/);
          const score = match ? Math.max(0, Math.min(1, parseFloat(match[1]))) : 0.0;

          return { key, score };
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TCL NLI Local Service listening on ${PORT}`);
  console.log(`Using Ollama at: ${OLLAMA_URL}`);
  console.log(`Using model: ${MODEL}`);
  console.log(`\nMake sure Ollama is running: ollama serve`);
  console.log(`And the model is available: ollama pull ${MODEL}`);
});

