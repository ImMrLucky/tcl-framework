import express from "express";
import { validate } from "../orchestrator.js";
import { OpenAIAdapter } from "../adapters/openai_adapter.js";
import type { ValidateInput } from "../types.js";

const app = express();
app.use(express.json({ limit: "4mb" }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "tcl-core" });
});

app.post("/validate", async (req, res) => {
  try {
    const input = req.body as ValidateInput;

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    if (apiKey && !input.options?.llmAdapter) {
      input.options = input.options ?? {};
      input.options.llmAdapter = new OpenAIAdapter({ apiKey, model });
    }

    const out = await validate(input);
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, '0.0.0.0', () => console.log(`TCL-Core listening on ${port}`));
