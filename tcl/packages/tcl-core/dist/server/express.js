import express from "express";
import { validate } from "../orchestrator.js";
import { OpenAIAdapter } from "../adapters/openai_adapter.js";
const app = express();
app.use(express.json({ limit: "4mb" }));
// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "tcl-core" });
});
app.post("/validate", async (req, res) => {
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            res.status(504).json({ error: "Request timeout" });
        }
    }, 300000); // 5 minute timeout
    try {
        console.log("Received validate request");
        const input = req.body;
        if (!input.question || !input.answer) {
            clearTimeout(timeout);
            return res.status(400).json({ error: "question and answer are required" });
        }
        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
        if (apiKey && !input.options?.llmAdapter) {
            input.options = input.options ?? {};
            input.options.llmAdapter = new OpenAIAdapter({ apiKey, model });
        }
        console.log("Starting validation...");
        const out = await validate(input);
        console.log("Validation complete");
        clearTimeout(timeout);
        res.json(out);
    }
    catch (e) {
        clearTimeout(timeout);
        console.error("Validation error:", e);
        console.error("Error stack:", e?.stack);
        res.status(500).json({
            error: e?.message ?? "unknown error",
            stack: process.env.NODE_ENV === "development" ? e?.stack : undefined
        });
    }
});
const port = Number(process.env.PORT || 8787);
app.listen(port, '0.0.0.0', () => console.log(`TCL-Core listening on ${port}`));
