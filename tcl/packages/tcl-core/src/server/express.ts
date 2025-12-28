import express from "express";
import type { ValidateInput, BatchValidateInput, BatchValidateOutput } from "../types.js";

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
    console.log("Request body:", JSON.stringify(req.body, null, 2));
    const input = req.body as ValidateInput;

    // Validate question (required)
    if (!input.question || typeof input.question !== 'string' || input.question.trim().length === 0) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "question is required and must be a non-empty string" });
    }
    
    // Validate answer - allow empty string for call center QA, but ensure it's a string
    if (input.answer === undefined || input.answer === null) {
      input.answer = "";
    }
    
    // Ensure answer is a string
    if (typeof input.answer !== 'string') {
      input.answer = String(input.answer);
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

// Batch validation endpoint
app.post("/validate/batch", async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: "Request timeout" });
    }
  }, 600000); // 10 minute timeout for batch

  try {
    // Ensure modules are loaded
    if (!validate) {
      await loadModules();
      if (!validate) {
        clearTimeout(timeout);
        return res.status(503).json({ error: "Service initializing, please try again" });
      }
    }

    console.log("Received batch validate request");
    const input = req.body as BatchValidateInput;

    // Validate input
    if (!input.items || !Array.isArray(input.items) || input.items.length === 0) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "items is required and must be a non-empty array" });
    }

    if (input.items.length > 100) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "Maximum 100 items per batch request" });
    }

    // Validate each item
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (!item.question || typeof item.question !== 'string' || item.question.trim().length === 0) {
        clearTimeout(timeout);
        return res.status(400).json({ error: `Item ${i + 1}: question is required and must be a non-empty string` });
      }
      if (item.answer === undefined || item.answer === null) {
        item.answer = "";
      }
      if (typeof item.answer !== 'string') {
        item.answer = String(item.answer);
      }
    }

    // Merge shared options with item-specific options
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const sharedOptions = input.options || {};

    // Process all items in parallel (with concurrency limit)
    const concurrency = 10; // Process 10 at a time
    const results: any[] = [];
    const latencies: number[] = [];

    for (let i = 0; i < input.items.length; i += concurrency) {
      const batch = input.items.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          const startTime = Date.now();
          try {
            // Merge shared options with item options
            const itemOptions = {
              ...sharedOptions,
              ...item.options
            };

            // Add adapter if available
            if (apiKey && !itemOptions.llmAdapter && OpenAIAdapter) {
              itemOptions.llmAdapter = new OpenAIAdapter({ apiKey, model });
            }

            const result = await validate({
              ...item,
              options: itemOptions
            });
            const latency = Date.now() - startTime;
            latencies.push(latency);
            return result;
          } catch (error: any) {
            console.error(`Error validating item ${i + batch.indexOf(item) + 1}:`, error);
            const latency = Date.now() - startTime;
            latencies.push(latency);
            // Return error result instead of failing entire batch
            return {
              answer: item.answer || "",
              refusal: true,
              scores: { truth: 0, consistency: 0, coherence: 0, overall: 0 },
              error: error?.message || "Validation failed",
              report: {
                claims: [],
                violations: [],
                missingEvidence: [],
                contradictions: []
              }
            };
          }
        })
      );
      results.push(...batchResults);
    }

    // Calculate summary
    const passed = results.filter(r => !r.refusal && !r.error).length;
    const failed = results.length - passed;
    const averageScore = results
      .filter(r => r.scores && !r.error)
      .reduce((sum, r) => sum + (r.scores?.overall || 0), 0) / Math.max(1, results.filter(r => !r.error).length);
    const averageLatency = latencies.length > 0
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
      : 0;

    const output: BatchValidateOutput = {
      results,
      summary: {
        total: results.length,
        passed,
        failed,
        averageScore: Math.round(averageScore),
        averageLatency: Math.round(averageLatency)
      }
    };

    clearTimeout(timeout);
    res.json(output);
  } catch (e: any) {
    clearTimeout(timeout);
    console.error("Batch validation error:", e);
    console.error("Error stack:", e?.stack);
    res.status(500).json({ 
      error: e?.message ?? "unknown error",
      stack: process.env.NODE_ENV === "development" ? e?.stack : undefined
    });
  }
});

// Railway sets PORT automatically, but we default to 8787
const port = Number(process.env.PORT || 8787);

console.log(`Starting server...`);
console.log(`PORT environment variable: ${process.env.PORT || 'not set'}`);
console.log(`Using port: ${port}`);

// Start server with error handling
try {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ TCL-Core listening on ${port}`);
    console.log(`Health check available at http://0.0.0.0:${port}/health`);
    console.log(`Environment: PORT=${process.env.PORT || 'default (8787)'}, NODE_ENV=${process.env.NODE_ENV || 'not set'}`);
    
    // Verify server is actually listening
    const address = server.address();
    if (address && typeof address === 'object') {
      console.log(`Server bound to ${address.address}:${address.port}`);
    }
    
    // Try to load modules after server starts
    loadModules().catch((err) => {
      console.error("Module loading failed (non-critical for health check):", err?.message);
    });
  });
  
  server.on('error', (error: any) => {
    console.error('Server error:', error);
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use`);
    }
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
