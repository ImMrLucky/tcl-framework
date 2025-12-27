import express from "express";
import { Mistral } from "@mistralai/mistralai";

const app = express();
app.use(express.json({ limit: "10mb" }));

const apiKey = process.env.MISTRAL_API_KEY;
if (!apiKey) {
  console.error("ERROR: MISTRAL_API_KEY environment variable is required");
  process.exit(1);
}

const client = new Mistral({ apiKey });
const model = process.env.MISTRAL_MODEL || "mistral-small-latest";

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "tcl-nli-service", model });
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
          const response = await client.chat.complete({
            model,
            messages: [
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.1, // Low temperature for consistent scoring
            maxTokens: 10 // We only need a number
          });

          const content = response.choices[0]?.message?.content?.trim() || "0.0";
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

const port = Number(process.env.PORT || 8081);
app.listen(port, "0.0.0.0", () => {
  console.log(`TCL NLI Service listening on ${port}`);
  console.log(`Using model: ${model}`);
});

