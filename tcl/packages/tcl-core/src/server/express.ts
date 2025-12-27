import express from "express";
import type { ValidateInput } from "../types.js";

const app = express();
app.use(express.json({ limit: "4mb" }));

// Health check endpoint - must work even if other imports fail
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "tcl-core" });
});

// Lazy load these to avoid startup crashes
let validate: any;
let OpenAIAdapter: any;

async function loadModules() {
  try {
    console.log("Starting to load modules...");
    const orchestrator = await import("../orchestrator.js");
    console.log("Orchestrator imported");
    validate = orchestrator.validate;
    console.log("Validate function assigned");
    
    const adapter = await import("../adapters/openai_adapter.js");
    console.log("Adapter imported");
    OpenAIAdapter = adapter.OpenAIAdapter;
    console.log("OpenAIAdapter assigned");
    
    console.log("✅ Modules loaded successfully");
  } catch (error: any) {
    console.error("❌ Failed to load modules:", error);
    console.error("Error message:", error?.message);
    console.error("Error stack:", error?.stack);
    throw error;
  }
}

// Don't load modules on startup - let server start first, then load modules
// This ensures health check works even if modules fail to load

app.post("/validate", async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: "Request timeout" });
    }
  }, 300000); // 5 minute timeout

  try {
    // Ensure modules are loaded
    if (!validate) {
      await loadModules();
      if (!validate) {
        clearTimeout(timeout);
        return res.status(503).json({ error: "Service initializing, please try again" });
      }
    }

    console.log("Received validate request");
    const input = req.body as ValidateInput;

    if (!input.question || !input.answer) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "question and answer are required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    if (apiKey && !input.options?.llmAdapter && OpenAIAdapter) {
      input.options = input.options ?? {};
      input.options.llmAdapter = new OpenAIAdapter({ apiKey, model });
    }

    console.log("Starting validation...");
    const out = await validate(input);
    console.log("Validation complete");
    clearTimeout(timeout);
    res.json(out);
  } catch (e: any) {
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

// Start server with error handling
try {
  app.listen(port, '0.0.0.0', () => {
    console.log(`✅ TCL-Core listening on ${port}`);
    console.log(`Health check available at http://0.0.0.0:${port}/health`);
    console.log(`Environment: PORT=${process.env.PORT}, NODE_ENV=${process.env.NODE_ENV}`);
    // Try to load modules after server starts
    loadModules().catch((err) => {
      console.error("Module loading failed (non-critical for health check):", err?.message);
    });
  });
} catch (error: any) {
  console.error("Failed to start server:", error);
  process.exit(1);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
