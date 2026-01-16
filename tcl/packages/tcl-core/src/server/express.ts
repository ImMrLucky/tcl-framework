// Note: Audio transcription now uses whisper.cpp + VAD (no longer uses @xenova/transformers)
// Environment variables for whisper.cpp are set in asr/whispercpp.ts and asr/vad.ts

import express from "express";
import { URL } from "url";
import multer from "multer";
import type { ValidateInput, BatchValidateInput, BatchValidateOutput } from "../types.js";
import { transcribeAudio, isValidAudioFormat } from "./transcription.js";
import { 
  supabaseAdmin, 
  verifyApiKey,
  verifyApiKeyExtended,
  provisionUser, 
  getUserOrgs,
  getUserRole,
  checkUserPermission,
  getOrgProjects,
  getProjectEnvs,
  generateApiKey,
  hashApiKey,
  logAudit,
  trackUsage
} from "./supabase.js";
import {
  inviteMember,
  updateMemberRole,
  removeMember,
  listMembers
} from "./member-management.js";
import { setupIntegrationRoutes } from "./integrations/routes.js";
import { setupAuditRoutes } from "./audit/routes.js";
import { setupIssueWorkflowRoutes } from "./issues/routes.js";
import { setupIssueDecisionsRoutes } from "./issues/decisions-routes.js";
import { setupIssueSignoffsRoutes } from "./issues/signoffs-routes.js";
import { setupIssueSnapshotsRoutes } from "./issues/snapshots-routes.js";
import { setupCasesRoutes } from "./cases/routes.js";
import { setupWebhooksRoutes } from "./integrations/webhooks-routes.js";
import { setupJiraRoutes } from "./integrations/jira-routes.js";
import { setupBatchIngestionRoutes } from "./batch-ingestion/routes.js";
import { setupConnectorRoutes } from "./connectors/routes.js";
import { setupAnalyticsRoutes } from "./analytics/routes.js";
import { setupExportRoutes } from "./exports/routes.js";
import { setupEvaluationSearchRoutes } from "./evaluations/search.js";
import { setupPolicyRoutes } from "./policies/routes.js";
import { setupEvidenceRoutes } from "./evidence/routes.js";
import { setupOrgRoutes } from "./orgs/routes.js";
import { setupProjectRoutes } from "./projects/routes.js";
import { setupTemplateRoutes } from "./templates/routes.js";
import { setupConversationRoutes } from "./conversations/routes.js";
import { resolveEvidenceSet } from "./evidence/service.js";
import type { EvidenceSet, EvidenceDiagnostics } from "../types/evidence.types.js";
import { startIndexingWorker } from "./evidence/indexing-worker.js";
import { setupScoringProfilesRoutes } from "./admin/scoring-profiles.js";
import { setupApiKeyRoutes } from "./api-keys/routes.js";
import { setupAnalyzeEndpoint } from "./api-keys/analyze-endpoint.js";
import { setupWebhookRoutes } from "./webhooks/routes.js";
import { deliverAnalysisCompletedWebhook } from "./webhooks/delivery.js";
import { setupIntegrationConnectionsRoutes } from "./integrations/connections.js";
import { setupBillingRoutes } from "./billing/routes.js";
import { handleStripeWebhook } from "./billing/webhook.js";
import { setupDowngradeJobRoute } from "./billing/downgrade-job.js";
import { setupAdminRoutes } from "./admin/routes.js";
import { loadPlanConfig, validatePlanConfig } from "../config/plan-config.js";
import { buildIssuesList } from "./audit/reproducibility.js";
import { analyzeForIssues, exportAsJSON, exportAsCSV, exportAsHTML, type IssueAnalysisOutput } from "../issues/index.js";
import { buildIssueNarratives } from "../analysis/issue-narratives.js";
// computeHeadlineCounts removed - unused import (see CLEANUP_NOTES.md)
import { exportNarrativesAsCSV, exportNarrativesAsJSON, exportNarrativesAsHTML } from "../analysis/exports.js";
import { getOrgContext } from "./auth-context.js";
import { registerIngestEndpoints } from "./ingestion/ingest-endpoint.js";
import { registerIngestionJobRoutes } from "./ingest/jobs.js";
import { planService } from "./plans/plan-service.js";
import { requireCapability } from "./plans/capability-middleware.js";
import { Capability } from "./plans/capabilities.js";
import { entitlementsService } from "./entitlements/entitlements-service.js";
import { requireEntitlement } from "./entitlements/middleware.js";

const app = express();

// CORS middleware - allows frontend to call Railway directly
// This is necessary when the frontend calls Railway directly for /validate
// to bypass Netlify's function timeout
app.use((req, res, next) => {
  // Allow requests from any origin in production
  // In production, you might want to restrict this to specific domains
  const allowedOrigins = [
    'https://protectqa.com',
    'https://www.protectqa.com',
    'http://localhost:4200',
    'http://localhost:3000'
  ];
  
  const origin = req.headers.origin;
  if (origin && allowedOrigins.some(allowed => origin.startsWith(allowed.replace('www.', '')))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    // For development, allow any origin
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Configure multer for file uploads FIRST (before JSON parsing)
// This prevents JSON parser from trying to parse multipart/form-data
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow audio files and text files
    const isAudio = isValidAudioFormat(file.originalname);
    const isText = /\.(txt|csv|json)$/i.test(file.originalname);
    
    if (isAudio || isText) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: .wav, .mp3, .flac, .m4a, .txt, .csv, .json'));
    }
  },
});

// JSON parsing middleware (skip for file upload routes)
app.use((req, res, next) => {
  // Skip JSON parsing for routes that use multer (file uploads)
  // Multer will handle multipart/form-data
  if (req.path === '/api/transcribe' || req.path === '/transcribe' || req.path.startsWith('/webhooks/')) {
    return next();
  }
  // Apply JSON parsing for other routes
  express.json({ limit: "10mb" })(req, res, next);
});

app.use(express.raw({ type: 'application/json', limit: '10mb' })); // For HMAC webhook verification
app.use(express.urlencoded({ extended: true })); // Enable query string parsing

// Health check endpoint - must work even if other imports fail
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "tcl-core" });
});

// Diagnostic endpoint - test the entire NLI + Spectral pipeline
app.get("/diagnostic", async (req, res) => {
  const diagnostic: any = {
    timestamp: new Date().toISOString(),
    status: "running",
    steps: {}
  };
  
  try {
    // Step 1: Check modules loaded
    diagnostic.steps.modulesLoaded = {
      validate: !!validate,
      orchestrator: "pending"
    };
    
    if (!validate) {
      await loadModules();
    }
    
    diagnostic.steps.modulesLoaded.validate = !!validate;
    diagnostic.steps.modulesLoaded.orchestrator = !!validate ? "ok" : "failed";
    
    // Step 2: Test evidence source generation
    const testTranscript = `Agent: Thank you for calling. How can I help you today?
Customer: Hi, I'm calling about my bill. It's higher than expected.
Agent: I understand. Let me look into that for you.
Customer: I was told my rate wouldn't change.
Agent: Based on what I can see, your plan hasn't changed.`;
    
    const { generateSourcesFromRawTranscript } = await import("../evidence_sources.js");
    const sources = generateSourcesFromRawTranscript(testTranscript, "test");
    diagnostic.steps.evidenceSources = {
      status: sources.length > 0 ? "ok" : "failed",
      count: sources.length,
      sample: sources[0]?.text?.substring(0, 100)
    };
    
    // Step 3: Test claim extraction
    const { extractClaims } = await import("../claim_extractor.js");
    const claims = extractClaims(testTranscript);
    diagnostic.steps.claimExtraction = {
      status: claims.length > 0 ? "ok" : "failed",
      count: claims.length,
      sample: claims[0]?.text?.substring(0, 100)
    };
    
    // Step 4: Test NLI scorer loading (priority: SpectralNli > Transformers > Heuristic)
    let activeScorer: any = null;
    let scorerType = "none";
    
    // Try SpectralNliScorer first (recommended - uses Python service)
    if (process.env.TCL_SPECTRAL_URL) {
      try {
        const { SpectralNliScorer } = await import("../graph/spectral_nli_scorer.js");
        const spectralScorer = new SpectralNliScorer({ endpoint: process.env.TCL_SPECTRAL_URL });
        diagnostic.steps.nliScorer = {
          status: "testing",
          type: "spectral",
          modelId: spectralScorer.id,
          endpoint: process.env.TCL_SPECTRAL_URL + "/nli/score"
        };
        
        // Test if it works - score should be > 0.3 for obvious entailment
        const testScore = await spectralScorer.entailment("The sky is blue.", "The sky has a blue color.");
        diagnostic.steps.nliScorer.testScore = testScore;
        
        if (testScore > 0.3) {
          activeScorer = spectralScorer;
          scorerType = "spectral";
          diagnostic.steps.nliScorer.status = "ok";
        } else {
          diagnostic.steps.nliScorer.status = "low_score";
          diagnostic.steps.nliScorer.warning = `Entailment score ${testScore} is too low for obvious test case (expected > 0.3)`;
        }
      } catch (spectralErr: any) {
        diagnostic.steps.nliScorer = {
          status: "failed",
          type: "spectral",
          error: spectralErr.message,
          willFallback: true
        };
      }
    }
    
    // Try TransformersNliScorer if spectral failed
    if (!activeScorer) {
      try {
        const { TransformersNliScorer } = await import("../graph/transformers_scorer.js");
        const transformersScorer = new TransformersNliScorer({});
        diagnostic.steps.nliScorerLocal = {
          status: "testing",
          type: "transformers",
          modelId: transformersScorer.id
        };
        
        const testScore = await transformersScorer.entailment("Test.", "Test.");
        if (testScore >= 0) {
          activeScorer = transformersScorer;
          scorerType = "transformers";
          diagnostic.steps.nliScorerLocal.status = "ok";
        }
      } catch (transformersErr: any) {
        diagnostic.steps.nliScorerLocal = {
          status: "failed",
          type: "transformers",
          error: transformersErr.message,
          willFallback: true
        };
      }
    }
    
    // Fallback to TokenHeuristicScorer
    if (!activeScorer) {
      try {
        const { TokenHeuristicScorer } = await import("../graph/edge_builder.js");
        activeScorer = new TokenHeuristicScorer();
        scorerType = "heuristic";
        diagnostic.steps.nliScorerFallback = {
          status: "ok",
          type: "heuristic",
          modelId: activeScorer.id,
          note: "Using TokenHeuristicScorer as fallback (basic accuracy - configure TCL_SPECTRAL_URL for better results)"
        };
      } catch (fallbackErr: any) {
        diagnostic.steps.nliScorerFallback = {
          status: "failed",
          error: fallbackErr.message
        };
      }
    }
    
    // Step 5: Test NLI scoring with the active scorer
    if (activeScorer) {
      try {
        const entailScore = await activeScorer.entailment(
          "The sky is blue.",
          "The sky has a blue color."
        );
        const contradictScore = await activeScorer.contradiction(
          "The door is open.",
          "The door is closed."
        );
        
        diagnostic.steps.nliScoring = {
          status: "ok",
          scorerType,
          scorerId: activeScorer.id,
          entailmentScore: entailScore,
          contradictionScore: contradictScore,
          labelMapAfterLoad: activeScorer.labelMap,
          note: scorerType === "heuristic" 
            ? "Using heuristic scorer - results will be basic but functional"
            : null
        };
      } catch (nliErr: any) {
        diagnostic.steps.nliScoring = {
          status: "error",
          scorerType,
          error: nliErr.message
        };
      }
    } else {
      diagnostic.steps.nliScoring = {
        status: "error",
        error: "No NLI scorer available"
      };
    }
    
    // Step 6: Check spectral URL
    diagnostic.steps.spectralConfig = {
      url: process.env.TCL_SPECTRAL_URL || "NOT_SET",
      status: process.env.TCL_SPECTRAL_URL ? "configured" : "missing"
    };
    
    // Step 7: Test spectral connection (try multiple endpoints)
    if (process.env.TCL_SPECTRAL_URL) {
      const spectralUrl = process.env.TCL_SPECTRAL_URL.replace(/\/$/, '');
      diagnostic.steps.spectralConnection = { status: "testing", url: spectralUrl };
      
      // Try health endpoint first, then root, then docs
      const endpointsToTry = ['/health', '/', '/docs', '/spectral/score'];
      let connected = false;
      
      for (const endpoint of endpointsToTry) {
        try {
          const resp = await fetch(`${spectralUrl}${endpoint}`, { 
            method: endpoint === '/spectral/score' ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: endpoint === '/spectral/score' ? JSON.stringify({
              claims: [{ id: "test", text: "Test claim" }],
              supports: [],
              contradictions: [],
              grounded: []
            }) : undefined
          });
          
          if (resp.ok || resp.status < 500) {
            diagnostic.steps.spectralConnection = {
              status: "ok",
              endpoint: endpoint,
              httpStatus: resp.status
            };
            connected = true;
            break;
          }
        } catch (err: any) {
          // Continue trying other endpoints
        }
      }
      
      if (!connected) {
        diagnostic.steps.spectralConnection = {
          status: "error",
          error: "Could not connect to any spectral endpoint",
          triedEndpoints: endpointsToTry
        };
      }
    }
    
    diagnostic.status = "complete";
    diagnostic.summary = {
      evidenceSourcesWorking: diagnostic.steps.evidenceSources?.status === "ok",
      claimExtractionWorking: diagnostic.steps.claimExtraction?.status === "ok",
      nliScoringWorking: diagnostic.steps.nliScoring?.status === "ok",
      nliScorerType: diagnostic.steps.nliScoring?.scorerType || "none",
      spectralConfigured: diagnostic.steps.spectralConfig?.status === "configured",
      spectralConnected: diagnostic.steps.spectralConnection?.status === "ok",
      // Overall readiness
      pipelineReady: (
        diagnostic.steps.evidenceSources?.status === "ok" &&
        diagnostic.steps.claimExtraction?.status === "ok" &&
        diagnostic.steps.nliScoring?.status === "ok" &&
        diagnostic.steps.spectralConnection?.status === "ok"
      )
    };
    
    res.json(diagnostic);
  } catch (err: any) {
    diagnostic.status = "error";
    diagnostic.error = err.message;
    diagnostic.stack = err.stack;
    res.status(500).json(diagnostic);
  }
});

// Edge builder test endpoint - tests batch NLI scoring and edge creation
app.get("/edge-test", async (req, res) => {
  const result: any = {
    timestamp: new Date().toISOString(),
    steps: {}
  };
  
  try {
    // Test transcript with known grounding relationship
    const testTranscript = `Agent: Your plan allows you to cancel at any time without a fee.
Customer: That's great to hear.
Agent: However, there may be an early termination charge if you cancel during the promotional period.
Customer: Wait, that contradicts what you just said about no fees.`;
    
    // Step 1: Generate sources
    const { generateSourcesFromRawTranscript } = await import("../evidence_sources.js");
    const sources = generateSourcesFromRawTranscript(testTranscript, "test-edge");
    result.steps.sources = {
      count: sources.length,
      texts: sources.map(s => s.text.substring(0, 80) + "...")
    };
    
    // Step 2: Extract claims
    const { extractClaims } = await import("../claim_extractor.js");
    const claims = extractClaims(testTranscript);
    result.steps.claims = {
      count: claims.length,
      texts: claims.map(c => c.text.substring(0, 80) + "...")
    };
    
    // Step 3: Create scorer
    const { SpectralNliScorer } = await import("../graph/spectral_nli_scorer.js");
    const spectralUrl = process.env.TCL_SPECTRAL_URL || "";
    const scorer = new SpectralNliScorer({ endpoint: spectralUrl });
    result.steps.scorer = {
      id: scorer.id,
      endpoint: spectralUrl + "/nli/score"
    };
    
    // Step 4: Manually test batch scoring for grounding
    const groundingPairs: Array<{ task: "grounding"; a: string; b: string; key: string }> = [];
    for (const claim of claims) {
      for (const source of sources) {
        groundingPairs.push({
          task: "grounding" as const,
          a: source.text, // source as premise
          b: claim.text,  // claim as hypothesis
          key: `gnd_${claim.id}_${source.id}`
        });
      }
    }
    
    result.steps.groundingPairs = {
      count: groundingPairs.length,
      samplePairs: groundingPairs.slice(0, 3).map(p => ({
        task: p.task,
        premise: p.a.substring(0, 60) + "...",
        hypothesis: p.b.substring(0, 60) + "..."
      }))
    };
    
    // Step 5: Call scoreBatch directly
    const batchScores = await scorer.scoreBatch(groundingPairs);
    result.steps.batchScoring = {
      scoresReturned: batchScores.length,
      sampleScores: batchScores.slice(0, 5).map((s, i) => ({
        key: s.key?.substring(0, 30) + "...",
        score: s.score?.toFixed(4),
        pair: groundingPairs[i] ? {
          premise: groundingPairs[i].a.substring(0, 40),
          hypothesis: groundingPairs[i].b.substring(0, 40)
        } : null
      })),
      distribution: {
        high: batchScores.filter(s => s.score >= 0.5).length,
        medium: batchScores.filter(s => s.score >= 0.25 && s.score < 0.5).length,
        low: batchScores.filter(s => s.score < 0.25).length
      },
      stats: {
        max: Math.max(...batchScores.map(s => s.score)),
        min: Math.min(...batchScores.map(s => s.score)),
        avg: batchScores.reduce((a, b) => a + b.score, 0) / batchScores.length
      }
    };
    
    // Step 6: Count how many would pass threshold
    const threshold = 0.25;
    const passingEdges = batchScores.filter(s => s.score >= threshold);
    result.steps.edgeCreation = {
      threshold,
      passingCount: passingEdges.length,
      failingCount: batchScores.length - passingEdges.length,
      passingScores: passingEdges.slice(0, 5).map(s => s.score.toFixed(4))
    };
    
    // Step 7: Now test full buildClaimGraph
    const { buildClaimGraph } = await import("../graph/edge_builder.js");
    const graph = await buildClaimGraph(claims, sources, {
      scorer,
      supportThreshold: 0.25,
      contradictionThreshold: 0.35,
      groundingThreshold: 0.25,
      maxPairwiseEdges: 200,
      batchSize: 256, // Larger batches = fewer HTTP calls
      cache: { enabled: false } // Disable cache for testing
    });
    
    result.steps.graphBuild = {
      supports: graph.supports.length,
      contradictions: graph.contradictions.length,
      grounding: graph.grounding.length,
      groundedClaimIds: graph.groundedClaimIds,
      debug: graph.debug
    };
    
    result.status = "complete";
    result.summary = {
      claimsExtracted: claims.length,
      sourcesGenerated: sources.length,
      pairsScored: batchScores.length,
      edgesCreated: graph.supports.length + graph.contradictions.length + graph.grounding.length,
      graphHealthy: graph.supports.length + graph.contradictions.length + graph.grounding.length > 0
    };
    
    res.json(result);
  } catch (err: any) {
    result.status = "error";
    result.error = err.message;
    result.stack = err.stack;
    res.status(500).json(result);
  }
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
    
    // Only load OpenAIAdapter if API key is set (optional, not required)
    if (process.env.OPENAI_API_KEY) {
      try {
        const adapter = await import("../adapters/openai_adapter.js");
        console.log("Adapter imported");
        OpenAIAdapter = adapter.OpenAIAdapter;
        console.log("OpenAIAdapter assigned (optional - only used if OPENAI_API_KEY is set)");
      } catch (adapterError: any) {
        console.warn("⚠️ OpenAIAdapter not available (optional):", adapterError.message);
        // Continue without OpenAIAdapter - not required
      }
    } else {
      console.log("OpenAIAdapter skipped (no OPENAI_API_KEY - using free local models)");
    }
    
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

/**
 * Check if user has permission for an org
 * Returns { hasPermission: boolean, role: string | null }
 */
async function checkPermission(userId: string, orgId: string, permission: 'view' | 'review' | 'configure' | 'export' | 'billing' | 'manage_members' | 'manage_integrations'): Promise<{ hasPermission: boolean; role: string | null }> {
  if (!supabaseAdmin) return { hasPermission: false, role: null };
  
  const hasPerm = await checkUserPermission(userId, orgId, permission);
  const role = await getUserRole(userId, orgId);
  
  return {
    hasPermission: hasPerm,
    role
  };
}

app.post("/validate", requireCapability(Capability.ANALYZE_MANUAL_UPLOAD), async (req, res) => {
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

    // Get org context for plan checks and usage tracking
    const context = await getOrgContext(req);
    if (!context || context.error || !context.orgId) {
      clearTimeout(timeout);
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }

    // Get plan context for limits and mode
    const planContext = await planService.getOrgPlanContext(context.orgId);
    
    // Check file limits for manual uploads (if sources are provided)
    if (input.sources && Array.isArray(input.sources)) {
      const fileCount = input.sources.length;
      const maxFiles = planContext.limits.maxFilesPerAnalysis;
      
      if (maxFiles !== -1 && fileCount > maxFiles) {
        clearTimeout(timeout);
        return res.status(400).json({
          error: "FILE_LIMIT_EXCEEDED",
          message: `Maximum ${maxFiles} files per analysis allowed on ${planContext.tier} plan`,
          limit: maxFiles,
          provided: fileCount,
        });
      }

      // Check file size limits
      const maxBytes = planContext.limits.maxBytesPerFile;
      if (maxBytes !== -1) {
        for (const source of input.sources) {
          if (source.text) {
            const textBytes = Buffer.byteLength(source.text, 'utf8');
            if (textBytes > maxBytes) {
              clearTimeout(timeout);
              return res.status(400).json({
                error: "FILE_SIZE_EXCEEDED",
                message: `Maximum ${Math.round(maxBytes / 1024 / 1024)}MB per file allowed on ${planContext.tier} plan`,
                limit: maxBytes,
                provided: textBytes,
                filename: (source as any).title || (source as any).id || 'unknown',
              });
            }
          }
        }
      }
    }

    // Consume usage quota (will throw RateLimitError if exceeded)
    try {
      await planService.consumeUsage(context.orgId, 'analysis_runs', 1);
    } catch (usageError: any) {
      if (usageError.error === 'RATE_LIMIT') {
        clearTimeout(timeout);
        return res.status(429).json(usageError);
      }
      throw usageError; // Re-throw other errors
    }

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
    const startTime = Date.now();
    
    // Get org context early (for scoring profile lookup)
    let orgContextForProfile: { orgId: string } | null = null;
    try {
      const contextForProfile = await getOrgContext(req);
      if (contextForProfile && !contextForProfile.error && contextForProfile.orgId) {
        orgContextForProfile = { orgId: contextForProfile.orgId };
      }
    } catch (contextError) {
      // Non-fatal - will use defaults
      console.debug('Could not get org context for scoring profile:', contextError);
    }
    
    const out = await validate(input);
    const latency = Date.now() - startTime;
    console.log("Validation complete");
    
    // ========================================================================
    // DIAGNOSTIC LOGGING - Trace the full pipeline
    // ========================================================================
    console.log("\n========== PIPELINE DIAGNOSTIC ==========");
    console.log("1️⃣ CLAIMS:", {
      count: out.report?.claims?.length || 0,
      sample: out.report?.claims?.[0]?.text?.substring(0, 60)
    });
    
    console.log("2️⃣ GRAPH:", {
      supports: out.report?.graph?.supports?.length || 0,
      contradictions: out.report?.graph?.contradictions?.length || 0,
      grounding: out.report?.graph?.grounding?.length || 0,
      debug: out.report?.graph?.debug ? {
        pairsGenerated: out.report.graph.debug.pairsGenerated,
        pairsScored: out.report.graph.debug.pairsScored,
        scorerId: out.report.graph.debug.model?.scorerId,
        labelMap: out.report.graph.debug.model?.labelMap,
        reasonIfEmpty: out.report.graph.debug.reasonIfEmptyGraph
      } : "no debug info"
    });
    
    console.log("3️⃣ SPECTRAL:", {
      skipped: out.report?.spectral?.spectralSkipped,
      debugReason: out.report?.spectral?.debugReason,
      coherenceScore: out.report?.spectral?.coherenceScore,
      truthVectorLength: out.report?.spectral?.truthVector?.length || 0,
      truthStatesLength: out.report?.spectral?.truthStates?.length || 0,
      nodeBlameNormLength: out.report?.spectral?.nodeBlameNorm?.length || 0,
      sampleTruthStates: out.report?.spectral?.truthStates?.slice(0, 3),
      sampleNodeBlame: out.report?.spectral?.nodeBlameNorm?.slice(0, 3),
      topBadContradictions: out.report?.spectral?.topBadContradictions?.length || 0,
      topBadSupports: out.report?.spectral?.topBadSupports?.length || 0
    });
    
    console.log("4️⃣ DESTRUCTIVE CLAIMS:", {
      count: out.report?.destructiveClaims?.length || 0,
      sample: out.report?.destructiveClaims?.[0] ? {
        claimId: out.report.destructiveClaims[0].claimId,
        importance: out.report.destructiveClaims[0].importance,
        truthState: out.report.destructiveClaims[0].truthState
      } : "none"
    });
    
    console.log("5️⃣ MANIFEST:", out.report?.manifest ? {
      inputHash: out.report.manifest.inputHash,
      nliModelId: out.report.manifest.nliModelId,
      transcriptSourcesCount: out.report.manifest.transcriptSourcesCount,
      graphHealth: out.report.manifest.graphHealth
    } : "no manifest");
    console.log("==========================================\n");

    // Build issues list from spectral output if available
    // Also build issues from destructive claims even if spectral was skipped
    let issues: any[] = [];
    if (out.report?.claims && out.report.claims.length > 0) {
      try {
        // Map claims to the format expected by buildIssuesList
        // CRITICAL: Use actual confidenceMetrics.groundingScore from NLI, NOT hard-coded 0.75
        const claimsForIssues = out.report.claims.map((c: any) => ({
          id: c.id,
          text: c.text,
          // Use computed grounding score from confidenceMetrics, or 0 if not computed
          confidence: c.confidenceMetrics?.groundingScore ?? c.confidence ?? 0,
          evidence: c.evidence || [],
          meta: {
            speaker: c.meta?.speaker,
            turnIndex: c.meta?.turnIndex
          },
          // Pass through extended claim fields for risk scoring
          claimType: c.claimType,
          isAuditable: c.isAuditable,
          topicTags: c.topicTags || [],
          hasAbsoluteLanguage: c.hasAbsoluteLanguage || false,
          hasMoney: c.hasMoney || false
        }));
        
        // Use spectral if available, otherwise create empty spectral report
        const spectralData = out.report.spectral?.spectralSkipped 
          ? { 
              truthStates: [], 
              nodeBlameNorm: [], 
              topBadContradictions: [],
              topBadSupports: [],
              coherenceScore: null 
            } 
          : (out.report.spectral || { 
              truthStates: [], 
              nodeBlameNorm: [], 
              topBadContradictions: [],
              topBadSupports: [],
              coherenceScore: null 
            });
        
        // Get graph edges for actual score computation (NOT hard-coded)
        // CRITICAL: Verify graph exists - if not, log warning but continue
        if (!out.report?.graph) {
          console.warn("⚠️ WARNING: out.report.graph is missing! Graph may not have been created by orchestrator.");
          console.warn("   Report keys:", Object.keys(out.report || {}));
        }
        
        const graphData = out.report?.graph || {};
        const graphSupports = graphData.supports || [];
        const graphContradictions = graphData.contradictions || out.report?.contradictions?.map((c: any) => ({ 
          claimA: c.claimA, 
          claimB: c.claimB, 
          weight: 1.0 
        })) || [];
        const graphGrounding = graphData.grounding || [];
        
        console.log("6️⃣ BUILDING ISSUES with spectral + graph data:", {
          hasGraph: !!out.report?.graph,
          hasSpectral: !out.report?.spectral?.spectralSkipped,
          truthStatesCount: spectralData.truthStates?.length || 0,
          nodeBlameCount: spectralData.nodeBlameNorm?.length || 0,
          destructiveCount: out.report?.destructiveClaims?.length || 0,
          graphSupports: graphSupports.length,
          graphContradictions: graphContradictions.length,
          graphGrounding: graphGrounding.length
        });
        
        issues = buildIssuesList(
          spectralData,
          claimsForIssues,
          out.report.destructiveClaims,
          undefined, // evaluationId
          {
            hasExternalDocs: false, // transcript-only mode
            contradictions: graphContradictions,
            supports: graphSupports,
            grounding: graphGrounding,
            totalTurns: claimsForIssues.length
          }
        );
        
        console.log("7️⃣ ISSUES BUILT:", {
          count: issues.length,
          sample: issues[0] ? {
            claimId: issues[0].claimId,
            issueType: issues[0].what?.issueType || issues[0].issueType,
            truthState: issues[0].what?.truthState || issues[0].truthState,
            importance: issues[0].confidence?.importance || issues[0].importance,
            nodeBlameNorm: issues[0].confidence?.nodeBlameNorm || issues[0].nodeBlameNorm
          } : "none"
        });
        
        console.log(`Built ${issues.length} issues (spectral available: ${!out.report.spectral?.spectralSkipped})`);
        
        // NEW: Generate CLUSTERED issues using the manager-grade issue analyzer
        // This groups claims into problem statements with proper risk scoring
        // NOTE: This is ADDITIVE only - it does not modify the main validation flow
        try {
          // Only run if we have claims and edges
          if (claimsForIssues.length > 0 && (graphContradictions.length > 0 || graphSupports.length > 0 || graphGrounding.length > 0)) {
            // Construct transcript from input (same logic as orchestrator)
            const transcript = (input.answer && input.answer.trim().length > 0) ? input.answer : input.question;
            
            // Safely map edges with null checks
            const safeContradictions = (graphContradictions || []).map((c: any) => ({
              claimA: c?.claimA || '',
              claimB: c?.claimB || '',
              weight: c?.weight || 1,
              reason: c?.reason || "Contradiction detected"
            })).filter((c: any) => c.claimA && c.claimB);
            
            const safeSupports = (graphSupports || []).map((s: any) => ({
              claimA: s?.claimA || '',
              claimB: s?.claimB || '',
              weight: s?.weight || 1
            })).filter((s: any) => s.claimA && s.claimB);
            
            const safeGrounding = (graphGrounding || []).map((g: any) => ({
              claimId: g?.claimId || '',
              sourceId: g?.sourceId || g?.evidenceId || '',
              weight: g?.weight || 1,
              quote: g?.quote
            })).filter((g: any) => g.claimId && g.sourceId);
            
            // =================================================================
            // FIX A: CANONICAL ISSUE GENERATION (single source of truth)
            // =================================================================
            // Generate ONLY issueNarratives as the canonical issue list.
            // issueAnalysis is kept as an alias for backward compatibility.
            // =================================================================
            
            // Use the transcript variable already declared above
            
            // Determine evidence mode (transcript-only vs external)
            const hasExternalEvidence = (input.sources?.length ?? 0) > 0;
            const evidenceMode = hasExternalEvidence ? 'TRANSCRIPT_PLUS_EXTERNAL' : 'TRANSCRIPT_ONLY';
            
            // Build grounded claim IDs from grounding edges
            const groundedClaimIds = [...new Set(safeGrounding.map((g: any) => g.claimId || g.claimA).filter(Boolean))];
            
            const narrativesResult = buildIssueNarratives({
              claims: claimsForIssues.map((c: any) => ({
                id: c.id,
                text: c.text,
                confidence: c.confidence || 0,
                evidence: c.evidence || [],
                claimKind: c.claimKind,
                grounding: c.grounding,
                verification: c.verification,
                consistency: c.consistency,
                confidenceMetrics: c.confidenceMetrics,
                meta: c.meta,
                truthState: c.truthState,
                // FIX C: Add supportBasis and verificationLevel
                supportBasis: groundedClaimIds.includes(c.id) 
                  ? (hasExternalEvidence ? 'EXTERNAL' : 'TRANSCRIPT') 
                  : 'NONE',
                verificationLevel: evidenceMode === 'TRANSCRIPT_ONLY' ? 'TRANSCRIPT_ONLY' : 'EXTERNALLY_VERIFIED',
              })),
              contradictions: graphContradictions,
              supports: graphSupports,
              grounding: safeGrounding.map((g: any) => ({
                claimId: g.claimId || g.claimA,
                sourceId: g.sourceId || g.evidenceId || g.claimB,
                weight: g.weight || 1,
                quote: g.quote,
              })),
              spectral: out.report?.spectral,
              destructiveClaims: out.report?.destructiveClaims,
              transcript: transcript || "",
              // Pass evidence mode for proper labeling
              evidenceMode,
            });
            
            // FIX B: Ensure ALL narratives are included (no truncation)
            // The narrativesResult.narratives contains the FULL list
            const canonicalNarratives = narrativesResult.narratives;
            const canonicalSummary = {
              ...narrativesResult.summary,
              // Ensure totalIssues matches actual narratives length
              totalIssues: canonicalNarratives.length,
              evidenceMode,
            };
            
            // CANONICAL issue payload - single source of truth
            (out.report as any).issueNarratives = {
              narratives: canonicalNarratives,
              summary: canonicalSummary,
            };
            
            // issueAnalysis is NOW an alias to issueNarratives (same object, same totals)
            // This ensures UI compatibility while maintaining consistency
            (out.report as any).issueAnalysis = {
              narratives: canonicalNarratives,
              summary: canonicalSummary,
            };
            
            // FIX D: Add grounded claim IDs to graph for consistency
            if (out.report?.graph) {
              (out.report.graph as any).grounded = groundedClaimIds;
              (out.report.graph as any).groundedClaimIds = groundedClaimIds;
            }
            
            // Add evidenceMode to manifest
            if (out.report?.manifest) {
              (out.report.manifest as any).evidenceMode = evidenceMode;
            }
            
            console.log("8️⃣ CANONICAL ISSUES (single source of truth):", {
              totalNarratives: canonicalNarratives.length,
              summaryTotal: canonicalSummary.totalIssues,
              bySeverity: canonicalSummary.bySeverity,
              topCategories: canonicalSummary.topCategories,
              evidenceMode,
              groundedClaimsCount: groundedClaimIds.length,
              topNarrative: canonicalNarratives[0] ? {
                title: canonicalNarratives[0].title,
                severity: canonicalNarratives[0].severity,
                category: canonicalNarratives[0].category,
                compositeScore: canonicalNarratives[0].scoring?.compositeScore,
              } : "none"
            });
            
            // =================================================================
            // ISSUE V2 EXPANSION (Enterprise-Grade)
            // =================================================================
            // Expand graph edges into allIssuesV2 (uncapped)
            // Then rank and slice topIssuesV2
            // =================================================================
            try {
              const { expandIssueCandidates } = await import('../analysis/issue-expansion.js');
              const { rankIssuesV2 } = await import('../analysis/risk-ranking.js');
              
              // Get evaluation ID for runId (will be set later, use placeholder for now)
              const evaluationIdPlaceholder = 'pending';
              
              // Expand issues from graph
              const expansionResult = expandIssueCandidates({
                claims: claimsForIssues,
                contradictions: graphContradictions,
                supports: graphSupports,
                grounding: safeGrounding,
                runId: evaluationIdPlaceholder,
                conversationId: (input as any).conversationId || '',
                evidenceMode,
                audit: {
                  engineVersion: out.engineVersion || 'unknown',
                  scorerId: out.scorerId || 'unknown',
                  modelFingerprint: out.report?.manifest?.modelFingerprint,
                  configHash: out.report?.manifest?.configHash,
                  inputHash: out.report?.manifest?.inputHash,
                },
              });
              
              // D: Detect compliance issues (PCI, recording consent, PII)
              const { detectComplianceIssues } = await import('../analysis/compliance-detectors.js');
              const complianceResult = detectComplianceIssues(
                claimsForIssues,
                evaluationIdPlaceholder,
                (input as any).conversationId || '',
                evidenceMode
              );
              
              // Combine graph issues with compliance issues
              const allAtomicIssues = [...expansionResult.allIssues, ...complianceResult.issues];
              
              // Check for active scoring profile (use orgContextForProfile retrieved earlier)
              let rankingConfig: any = undefined;
              let profileConfigHash: string | undefined = undefined;
              if (orgContextForProfile && orgContextForProfile.orgId) {
                try {
                  const { getActiveScoringProfile } = await import('./admin/scoring-profiles.js');
                  const activeProfile = await getActiveScoringProfile(orgContextForProfile.orgId);
                  if (activeProfile) {
                    rankingConfig = activeProfile.riskRankingConfig;
                    profileConfigHash = activeProfile.configHash;
                    // Update manifest configHash to include profile
                    if (out.report?.manifest) {
                      (out.report.manifest as any).configHash = profileConfigHash;
                      (out.report.manifest as any).scoringProfileHash = profileConfigHash;
                    }
                    console.log('Using active scoring profile:', {
                      configHash: profileConfigHash,
                      orgId: orgContextForProfile.orgId
                    });
                  }
                } catch (profileError) {
                  console.warn('Failed to load active scoring profile, using defaults:', profileError);
                }
              }
              
              // Rank issues (deterministic) with scoring context
              const scoringContext = {
                mode: (evidenceMode === 'TRANSCRIPT_ONLY' ? 'transcript_only' : 'with_evidence') as 'transcript_only' | 'with_evidence',
                numSources: (input.sources?.length ?? 0),
                graphStatus: out.report?.graph?.status,
                templateId: (out.report?.manifest as any)?.templateId,
                isRegulatedTemplate: false, // TODO: detect from template
              };
              const rankedResult = rankIssuesV2(allAtomicIssues, rankingConfig, scoringContext);
              
              // C2-C3: Aggregate issues into clusters
              const { aggregateIssues } = await import('../analysis/issue-clustering.js');
              const evalMode: any = {
                verificationLevel: evidenceMode === 'TRANSCRIPT_ONLY' ? 'TRANSCRIPT_ONLY' : 
                                    'DOC_BACKED' as const,
                hasExternalEvidence: evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL',
                evidenceCoverage01: 0, // TODO: compute from actual evidence coverage
                transcriptOnlyReasonCodes: evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
              };
              const clusteringResult = aggregateIssues(rankedResult.allIssues, evalMode);
              
              // E1-E3: Compute executive summary from aggregated issues
              const { computeExecutiveSummary } = await import('../analysis/executive-summary.js');
              const executiveSummary = computeExecutiveSummary({
                aggregatedIssues: clusteringResult.aggregatedIssues,
                truthScore: out.scores?.truth ?? null,
                coherenceScore: out.scores?.coherence ?? null,
                consistencyScore: out.scores?.consistency ?? null,
                evalMode,
              });
              
              // F1: Build issueClustersV2 aggregation output
              const topClusters = clusteringResult.aggregatedIssues.slice(0, 10); // Top 10 clusters
              const issueClustersV2 = {
                clusters: clusteringResult.aggregatedIssues, // All clusters
                topClusters: topClusters, // Top N clusters (for UI)
              };
              
              // Cluster collapsing: Collapse atomic issues into grouped clusters for topIssuesV2
              const { collapseIssuesToClusters } = await import('../analysis/issue-cluster-collapse.js');
              const atomicIssues = rankedResult.allIssues;
              const groupedIssues = collapseIssuesToClusters(atomicIssues);
              
              // A1: Store in canonical structure
              (out.report as any).issues = {
                atomic: atomicIssues,
                grouped: groupedIssues,
              };
              
              // Legacy aliases for backwards compatibility
              (out.report as any).allIssuesV2 = atomicIssues; // Atomic issues (unchanged)
              (out.report as any).topIssuesV2 = groupedIssues; // Grouped/clustered issues (one per clusterId)
              (out.report as any).topAggregatedIssues = topClusters; // Top 10 clusters (backwards compat)
              (out.report as any).aggregatedIssues = clusteringResult.aggregatedIssues; // All aggregated issues (backwards compat)
              (out.report as any).issueClustersV2 = issueClustersV2; // F1: New structured output
              (out.report as any).issueSummaryV2 = rankedResult.summary;
              (out.report as any).executiveSummary = executiveSummary; // E1-E3: Root-cause driven executive summary
              (out.report as any).evalMode = evalMode; // A1: Add EvalMode to report
              (out.report as any).issuesByClaim = expansionResult.issuesByClaim;
              
              console.log("9️⃣ ISSUE V2 EXPANSION:", {
                allIssuesCount: rankedResult.allIssues.length,
                topIssuesCount: rankedResult.topIssues.length,
                byType: rankedResult.summary.byType,
                bySeverity: rankedResult.summary.bySeverity,
                topIssue: rankedResult.topIssues[0] ? {
                  type: rankedResult.topIssues[0].type,
                  severity: rankedResult.topIssues[0].severity,
                  riskScore: rankedResult.topIssues[0].riskScore,
                  issueKey: rankedResult.topIssues[0].issueKey,
                } : "none"
              });
            } catch (expansionErr: any) {
              console.warn('Failed to expand IssueV2:', expansionErr.message);
              console.error('Error stack:', expansionErr.stack);
              // Don't fail the whole request - this is additive
            }
          } else {
            console.log("8️⃣ CANONICAL ISSUES: Skipped (no claims or edges available)");
          }
        } catch (issueErr: any) {
          console.warn('Failed to build canonical issues:', issueErr.message);
          console.error('Error stack:', issueErr.stack);
        }
      } catch (outerErr: any) {
        console.warn('Failed to build issues list:', outerErr.message);
      }
    }

    // Log spectral data for debugging
    const spectralData = out.report?.spectral;
    console.log("📊 Spectral data from orchestrator:", {
      hasSpectral: !!spectralData,
      spectralSkipped: spectralData?.spectralSkipped,
      coherenceScore: spectralData?.coherenceScore,
      truthVectorLength: spectralData?.truthVector?.length || 0,
      truthStatesLength: spectralData?.truthStates?.length || 0,
      nodeBlameNormLength: spectralData?.nodeBlameNorm?.length || 0,
      topBadContradictions: spectralData?.topBadContradictions?.length || 0,
      topBadSupports: spectralData?.topBadSupports?.length || 0
    });
    
    // Add issues to the report and normalize the structure
    // Ensure report has consistent structure for frontend
    // CRITICAL: Explicitly preserve graph, spectral, and all other report data
    const reportWithIssues = {
      ...out.report,
      // Explicitly preserve graph (don't let it get lost)
      graph: out.report?.graph || {
        supports: [],
        contradictions: [],
        grounding: [],
        debug: {}
      },
      // Explicitly preserve spectral (don't let it get lost)
      spectral: out.report?.spectral || {},
      // Explicitly preserve claims
      claims: out.report?.claims || [],
      // Add issues
      issues,
      // Normalize: ensure inputs is available (for simulation modal and evaluation results)
      inputs: {
        claims: (out.report?.claims || []).map((c: any, idx: number) => ({
          id: c.id,
          text: c.text,
          speaker: c.meta?.speaker === 'Agent' ? 'AGENT' : 
                   c.meta?.speaker === 'Customer' ? 'CUSTOMER' : 
                   c.meta?.speaker || 'UNKNOWN',
          turnStartIdx: c.meta?.turnIndex,
          turnEndIdx: c.meta?.turnIndex,
          tags: []
        })),
        supports: out.report?.graph?.supports || [],
        contradictions: out.report?.graph?.contradictions || [],
        grounded: out.report?.graph?.grounding?.map((g: any) => g.claimId) || []
      },
      // Normalize: ensure run metadata is available
      run: {
        engineVersion: process.env.ENGINE_VERSION || '0.2.0',
        scorerId: out.scorerId,
        modelFingerprint: {
          nliModel: out.scorerId || 'unknown',
          claimExtractor: 'v1'
        }
      }
    };
    
    console.log("📦 Report structure being stored:", {
      hasGraph: !!reportWithIssues.graph,
      hasSpectral: !!reportWithIssues.spectral,
      spectralCoherence: reportWithIssues.spectral?.coherenceScore,
      issuesCount: issues.length,
      claimsCount: reportWithIssues.claims?.length || 0,
      inputsClaimsCount: reportWithIssues.inputs?.claims?.length || 0,
      supportsCount: reportWithIssues.graph?.supports?.length || 0,
      contradictionsCount: reportWithIssues.graph?.contradictions?.length || 0,
      groundingCount: reportWithIssues.graph?.grounding?.length || 0,
      // Verify graph structure
      graphKeys: reportWithIssues.graph ? Object.keys(reportWithIssues.graph) : 'MISSING',
      reportKeys: Object.keys(reportWithIssues)
    });

    // Store validation in Supabase if configured
    // Note: context is already defined earlier in the function
    if (context && supabaseAdmin) {
      try {
        // Check if conversation_id is provided in request body
        const conversationId = (req.body as any).conversation_id;
        
        // ============================================================================
        // EVIDENCE SYSTEM: Resolve evidence set for this evaluation
        // ============================================================================
        const evidenceParams = (req.body as any).evidence || {};
        let evidenceSet: EvidenceSet | null = null;
        let evidenceDiagnostics: EvidenceDiagnostics = {};
        
        try {
          evidenceSet = await resolveEvidenceSet(
            context.orgId,
            context.projectId,
            evidenceParams.templateId,
            conversationId,
            evidenceParams.simulationMode || false,
            evidenceParams.includeOrgEvidence !== false, // Default: true
            evidenceParams.includeProjectEvidence !== false, // Default: true
            evidenceParams.includeTemplateEvidence !== false // Default: true
          );
          
          // Add conversation-level evidence IDs if provided
          if (evidenceSet && evidenceParams.conversationEvidenceIds && Array.isArray(evidenceParams.conversationEvidenceIds)) {
            evidenceSet.conversationEvidenceIds = evidenceParams.conversationEvidenceIds;
            // Add to resolvedEvidenceIds
            evidenceSet.resolvedEvidenceIds = [
              ...(evidenceSet.resolvedEvidenceIds || []),
              ...evidenceParams.conversationEvidenceIds,
            ];
          }
          
          // Collect diagnostics
          if (evidenceSet) {
            try {
              const { data: failedIndexing } = await supabaseAdmin
                .from('evidence_items')
                .select('id, title, index_error')
                .eq('org_id', context.orgId)
                .eq('index_status', 'FAILED')
                .in('id', evidenceSet.resolvedEvidenceIds || []);
              
              if (failedIndexing && failedIndexing.length > 0) {
                evidenceDiagnostics.indexingFailures = failedIndexing.map(item => ({
                  evidenceItemId: item.id,
                  error: item.index_error || 'Unknown indexing error',
                }));
              }
            } catch (diagError) {
              console.warn('Failed to collect evidence diagnostics:', diagError);
            }
          }
        } catch (evidenceError: any) {
          console.warn('Failed to resolve evidence set:', evidenceError);
          // Continue without evidence - evaluation can still run
          evidenceDiagnostics = {
            indexingFailures: [],
          };
        }
        
        // Build proper scores structure that frontend expects
        const spectralReport = out.report?.spectral || {};
        const spectralSkipped = spectralReport.spectralSkipped === true;
        
        // Calculate coherence - use spectral if available, fallback to orchestrator score
        const coherenceScore = spectralReport.coherenceScore ?? out.scores?.coherence;
        
        // Use truthDerivationSummary from unified graph builder as SINGLE SOURCE OF TRUTH
        // This ensures counts are consistent with manifest.truthDerivationSummary
        const manifest = out.report?.manifest;
        const truthSummary = manifest?.truthDerivationSummary;
        
        // Get diagnostics info from manifest
        const diagnostics = manifest?.diagnostics;
        const graphStatus = diagnostics?.status || 'OK';
        const isTranscriptOnly = (out.report?.graph?.supports?.length || 0) === 0;
        
        // Build definitions based on mode
        const mode = isTranscriptOnly ? 'transcript_only' : 'verified';
        const definitions = {
          supported: `Claims with external evidence support (policy/document/system_fact). In transcript-only mode, this should be 0.`,
          contradicted: `Claims involved in contradiction edges on the same subject slot.`,
          ungrounded: `Claims with NO evidence at all (no grounding edges, isolated nodes).`,
          unverified: mode === 'transcript_only' 
            ? `Claims grounded in transcript but not externally verified. This is expected in transcript-only mode.`
            : `Claims with transcript evidence but no external policy/document verification.`,
        };
        
        const scoresForDb = {
          // Top-level scores from orchestrator
          truth: out.scores?.truth,
          consistency: out.scores?.consistency,
          coherence: out.scores?.coherence,
          overall: out.scores?.overall,
          // Spectral metrics (from report.spectral)
          spectral: spectralSkipped ? {
            spectralSkipped: true,
            coherenceScore: out.scores?.coherence, // Use orchestrator coherence as fallback
          } : {
            coherenceScore: spectralReport.coherenceScore,
            contradictionEnergy: spectralReport.contradictionEnergy,
            supportEnergy: spectralReport.supportEnergy,
            circularityScore: spectralReport.circularityScore,
            spectralGap: spectralReport.spectralGap,
            cycleMass: spectralReport.cycleMass,
            heatTrace: spectralReport.heatTrace
          },
          // Counts from truthDerivationSummary (SINGLE SOURCE OF TRUTH)
          // These MUST match manifest.truthDerivationSummary exactly
          counts: (() => {
            // Fix contradicted count: compute from unique claim IDs in contradiction edges
            // If contradictions > 0, then contradicted must be the number of unique claim IDs
            const contradictionEdges = out.report?.graph?.contradictions || [];
            const contradictedClaimIds = new Set<string>();
            for (const edge of contradictionEdges) {
              if (edge.claimA) contradictedClaimIds.add(edge.claimA);
              if (edge.claimB) contradictedClaimIds.add(edge.claimB);
            }
            const contradictedCount = contradictionEdges.length > 0 
              ? contradictedClaimIds.size 
              : (truthSummary?.contradicted ?? 0);
            
            return {
            claims: truthSummary?.total ?? out.report?.claims?.length ?? 0,
            contradicted: contradictedCount,
            ungrounded: truthSummary?.ungrounded ?? 0,
            unverified: truthSummary?.unverified ?? 0, // Claims with transcript evidence only
            supported: truthSummary?.supported ?? 0,   // Claims with EXTERNAL evidence
            // Edge counts (for debugging)
            supports: out.report?.graph?.supports?.length || 0,
            contradictions: contradictionEdges.length,
            grounding: out.report?.graph?.grounding?.length || 0,
            // Include definitions for tooltips
            definitions,
            // Mode indicator
            mode,
            graphStatus,
            };
          })()
        };
        
        const { data: insertedEvaluation, error: dbError } = await supabaseAdmin
          .from('evaluations')
          .insert({
            org_id: context.orgId,
            project_id: context.projectId || null,
            conversation_id: conversationId || null,
            env: context.env,
            scores: scoresForDb,
            refusal: out.refusal || false,
            scorer_id: out.scorerId || null,
            engine_version: process.env.ENGINE_VERSION || '0.2.0',
            latency_ms: latency,
            report: reportWithIssues,
            // Evidence system fields
            template_id: evidenceParams.templateId || null,
            simulation_mode: evidenceParams.simulationMode || false,
            evidence_set: evidenceSet || {
              orgEvidenceIds: [],
              projectEvidenceIds: [],
              conversationEvidenceIds: [],
              templateEvidenceIds: [],
              resolvedEvidenceIds: [],
            },
            evidence_diagnostics: evidenceDiagnostics,
          })
          .select('id')
          .single();
        
        if (dbError) {
          console.error('Failed to store evaluation:', dbError);
        } else {
          // Track usage
          await trackUsage(context.orgId, context.projectId, context.env, 'evaluation');
          
          // Log audit event
          await logAudit({
            orgId: context.orgId,
            action: 'evaluation.create',
            targetType: 'evaluation',
            meta: { question: input.question.substring(0, 100), latency, env: context.env }
          });
          
          // Include evaluation ID in response
          (out as any).evaluationId = insertedEvaluation?.id;
          
          // Update runId in allIssuesV2 and topIssuesV2 if they exist
          if (insertedEvaluation?.id && out.report) {
            const { createHash } = await import('crypto');
            const updateRunId = (issue: any) => {
              if (issue && issue.runId === 'pending') {
                issue.runId = insertedEvaluation.id;
                // Regenerate issueId with correct runId
                const hash = createHash('sha256')
                  .update(`${insertedEvaluation.id}:${issue.issueKey}`)
                  .digest('hex')
                  .substring(0, 16);
                issue.issueId = `issue_${hash}`;
              }
              return issue;
            };
            
            if ((out.report as any).allIssuesV2) {
              (out.report as any).allIssuesV2 = (out.report as any).allIssuesV2.map(updateRunId);
            }
            if ((out.report as any).topIssuesV2) {
              (out.report as any).topIssuesV2 = (out.report as any).topIssuesV2.map(updateRunId);
            }
          }
        }
      } catch (dbErr: any) {
        console.error('Database error (non-fatal):', dbErr);
      }
    }

    // Add mode/plan tagging to response
    const limitations: string[] = [];
    if (planContext.tier === 'SANDBOX') {
      limitations.push('NO_LIVE_WEBHOOKS');
      limitations.push('LIMITED_API_CALLS');
      if (planContext.limits.maxFilesPerAnalysis !== -1) {
        limitations.push('LIMITED_FILES_PER_ANALYSIS');
      }
      if (planContext.limits.maxBytesPerFile !== -1) {
        limitations.push('LIMITED_FILE_SIZE');
      }
    }

    clearTimeout(timeout);
    
    // Deliver webhook for analysis.completed (async, non-blocking)
    const issueSummary = reportWithIssues?.issueSummaryV2;
    if (issueSummary) {
      deliverAnalysisCompletedWebhook(
        context.orgId,
        out.evaluationId || 'unknown',
        {
          totalIssues: issueSummary.totalIssues || 0,
          bySeverity: issueSummary.bySeverity || { low: 0, medium: 0, high: 0, critical: 0 },
          byType: issueSummary.byType || {},
          byCategory: issueSummary.byCategory || {},
        },
        out.report?.spectral ? {
          energy: out.report.spectral.energy,
          gap: out.report.spectral.gap,
          cycleMass: out.report.spectral.cycleMass,
        } : undefined
      ).catch((err) => {
        console.error('Webhook delivery error (non-fatal):', err);
      });
    }
    
    // Return output with issues included
    res.json({
      ...out,
      report: reportWithIssues,
      // Add mode/plan tagging
      mode: context.env === 'production' ? 'prod' : 'sandbox',
      planTier: planContext.tier,
      limitations: limitations.length > 0 ? limitations : undefined,
    });
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
// Supports both use cases:
// 1. Batch QA: question + answer pairs (general QA validation)
// 2. Batch Call Transcripts: question only (call center QA - answer can be empty or omitted)
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
    // Note: answer is optional - empty answer means call transcript mode
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (!item.question || typeof item.question !== 'string' || item.question.trim().length === 0) {
        clearTimeout(timeout);
        return res.status(400).json({ error: `Item ${i + 1}: question is required and must be a non-empty string` });
      }
      // answer is optional - if missing/empty, will be treated as call transcript
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

// Check if user exists (for duplicate signup prevention)
app.post("/auth/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // Check if user exists in auth.users
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers();
    
    if (error) {
      console.error('Error checking email:', error);
      return res.status(500).json({ error: "Failed to check email" });
    }
    
    const userExists = users?.users?.some(u => u.email?.toLowerCase() === email.toLowerCase());
    
    res.json({ exists: !!userExists });
  } catch (e: any) {
    console.error("Check email error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Auth provision endpoint (called after user signs up/logs in)
app.post("/auth/provision", async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId || !email) {
      return res.status(400).json({ error: "userId and email are required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // Check if user already has an org (duplicate signup)
    const { data: existingOrgs } = await supabaseAdmin
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    
    if (existingOrgs?.org_id) {
      console.log(`User ${userId} already provisioned, returning existing org`);
      // Get project for this org
      const { data: projects } = await supabaseAdmin
        .from('projects')
        .select('id')
        .eq('org_id', existingOrgs.org_id)
        .limit(1)
        .maybeSingle();
      
      return res.json({ 
        orgId: existingOrgs.org_id, 
        projectId: projects?.id || '',
        message: 'User already has an account'
      });
    }
    
    console.log(`Provision request for user: ${userId} (${email})`);
    const result = await provisionUser(userId, email);
    
    if (!result) {
      console.error(`Provision failed for user: ${userId}`);
      
      // Check if user has an org anyway (partial success)
      if (supabaseAdmin) {
        // First check org_members
        const { data: existingOrgs } = await supabaseAdmin
          .from('org_members')
          .select('org_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();
        
        if (existingOrgs?.org_id) {
          console.log(`Partial success: User has org ${existingOrgs.org_id}, returning it`);
          return res.json({ 
            orgId: existingOrgs.org_id, 
            projectId: '',
            warning: 'Provision partially completed - some steps may have failed'
          });
        }
        
        // If no org_members, check if org was created but member wasn't added
        // Find orgs where user's email matches (since org name = email)
        const { data: orgsByEmail } = await supabaseAdmin
          .from('organizations')
          .select('id, name')
          .eq('name', email)
          .limit(1)
          .maybeSingle();
        
        if (orgsByEmail?.id) {
          console.log(`Found org ${orgsByEmail.id} by email, attempting to add user to org_members...`);
          
          // Try to add the user to org_members
          const { error: fixMemberError } = await supabaseAdmin
            .from('org_members')
            .insert({
              org_id: orgsByEmail.id,
              user_id: userId,
              role: 'owner'
            });
          
          if (fixMemberError) {
            if (fixMemberError.code === '23505') {
              // Already exists - this is fine
              console.log('User already in org_members');
            } else {
              console.error('Failed to fix org_members:', fixMemberError);
            }
          } else {
            console.log('✅ Successfully added user to org_members');
          }
          
          // Get or create project for this org
          let projectId = '';
          const { data: existingProject } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('org_id', orgsByEmail.id)
            .limit(1)
            .maybeSingle();
          
          if (existingProject) {
            projectId = existingProject.id;
          }
          
          return res.json({ 
            orgId: orgsByEmail.id, 
            projectId: projectId,
            fixed: true,
            message: 'User org membership has been fixed'
          });
        }
      }
      
      return res.status(500).json({ 
        error: "Failed to provision user",
        details: "Check server logs for details. User may still be able to use the app if profile and org exist."
      });
    }
    
    console.log(`✅ Provision successful: orgId=${result.orgId}, projectId=${result.projectId}`);
    res.json({ orgId: result.orgId, projectId: result.projectId });
  } catch (e: any) {
    console.error("Provision error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get current user info with plan context
// Register admin routes early (before parameterized routes)
setupAdminRoutes(app);
console.log("Admin routes registered successfully");

app.get("/api/me", async (req, res) => {
  try {
    const context = await getOrgContext(req);
    
    if (!context || context.error || !context.orgId) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // Get user ID from token
    const authHeader = req.headers.authorization;
    let userId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
      userId = user?.id;
    }
    
    // Get org details
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, slug, plan_tier, plan_status')
      .eq('id', context.orgId)
      .single();
    
    if (orgError || !org) {
      return res.status(404).json({ error: "Organization not found" });
    }
    
    // Check for emulation (superuser only)
    const emulation = (req as any).emulation;
    
    // Get plan context (with emulation if active)
    const planContext = await planService.getOrgPlanContext(
      context.orgId,
      emulation
    );
    
    // Get admin context to check if superuser
    const { getAdminContext } = await import('./admin/middleware.js');
    const adminContext = await getAdminContext(req);
    
    // Get entitlements
    const entitlements = await entitlementsService.getOrgEntitlements(context.orgId);
    
    // Get user's role in the org
    let role: string | null = null;
    if (userId) {
      const { data: member } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('org_id', context.orgId)
        .eq('user_id', userId)
        .maybeSingle();
      role = member?.role || null;
    }
    
    res.json({
      user: userId ? { id: userId } : undefined,
      role: role || null,
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        planTier: org.plan_tier || 'SANDBOX',
        planStatus: org.plan_status || 'ACTIVE',
      },
      planContext: {
        tier: planContext.tier,
        status: planContext.status,
        capabilities: planContext.capabilities,
        limits: planContext.limits,
        remainingToday: planContext.remainingToday,
        // Include emulation metadata if present
        ...(planContext.emulated && {
          emulated: planContext.emulated,
          realPlanTier: planContext.realPlanTier,
          effectivePlanTier: planContext.effectivePlanTier,
        }),
      },
      entitlements: {
        orgId: entitlements.orgId,
        tier: entitlements.tier,
        features: entitlements.features,
      },
      isSuperuser: adminContext?.isSuperuser || false,
    });
  } catch (e: any) {
    console.error("Get /api/me error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get entitlements endpoint
app.get("/api/entitlements", async (req, res) => {
  try {
    const context = await getOrgContext(req);
    
    if (!context || context.error || !context.orgId) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    const entitlements = await entitlementsService.getOrgEntitlements(context.orgId);
    
    res.json({
      entitlements: {
        orgId: entitlements.orgId,
        tier: entitlements.tier,
        features: entitlements.features,
      },
    });
  } catch (e: any) {
    console.error("Get /api/entitlements error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get user's organizations
app.post("/api/me/orgs", async (req, res) => {
  try {
    // Get userId from request body
    const userId = req.body.userId as string | undefined;
    
    if (!userId || userId.trim() === '') {
      return res.status(400).json({ error: "userId required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const orgs = await getUserOrgs(userId);
    res.json({ orgs });
  } catch (e: any) {
    console.error("Get orgs error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// ============================================
// Member Management Endpoints
// ============================================

// List members of an organization
// NOTE: This endpoint is now handled by setupOrgRoutes in orgs/routes.ts
// Removed duplicate endpoint - use /api/orgs/:orgId/members from orgs/routes.ts instead

// Invite a member to an organization
app.post("/api/orgs/:orgId/members/invite", async (req, res) => {
  try {
    const { orgId } = req.params;
    const { email, role } = req.body;
    const userId = req.body.userId || req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }
    
    if (!email || !role) {
      return res.status(400).json({ error: "email and role are required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const result = await inviteMember(userId, orgId, email, role);
    
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    
    // Log audit event
    await logAudit({
      orgId,
      actorUserId: userId,
      action: 'member.invite',
      targetType: 'org_member',
      targetId: result.userId,
      meta: { email, role }
    });
    
    res.json(result);
  } catch (e: any) {
    console.error("Invite member error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Update a member's role (requires enterpriseGovernance entitlement for role changes)
app.patch("/api/orgs/:orgId/members/:memberUserId", requireEntitlement('enterpriseGovernance'), async (req, res) => {
  try {
    const { orgId, memberUserId } = req.params;
    const { role } = req.body;
    const userId = req.body.userId || req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }
    
    if (!role) {
      return res.status(400).json({ error: "role is required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const result = await updateMemberRole(userId, orgId, memberUserId, role);
    
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    
    // Log audit event
    await logAudit({
      orgId,
      actorUserId: userId,
      action: 'member.update_role',
      targetType: 'org_member',
      targetId: memberUserId,
      meta: { newRole: role }
    });
    
    res.json(result);
  } catch (e: any) {
    console.error("Update member role error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Remove a member from an organization
app.delete("/api/orgs/:orgId/members/:memberUserId", async (req, res) => {
  try {
    const { orgId, memberUserId } = req.params;
    const userId = req.body.userId || req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const result = await removeMember(userId, orgId, memberUserId);
    
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    
    // Log audit event
    await logAudit({
      orgId,
      actorUserId: userId,
      action: 'member.remove',
      targetType: 'org_member',
      targetId: memberUserId
    });
    
    res.json(result);
  } catch (e: any) {
    console.error("Remove member error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// API Key management endpoints
app.post("/api/orgs/:orgId/api-keys", async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // TODO: Verify user has admin/owner role for orgId
    
    const { key, prefix, hash } = generateApiKey();
    
    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .insert({
        org_id: orgId,
        name,
        key_hash: hash,
        prefix,
        scopes: ['validate:write', 'validate:read']
      })
      .select('id, name, prefix, created_at')
      .single();
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    // Return key only once (never again)
    res.json({
      id: data.id,
      name: data.name,
      prefix: data.prefix,
      key, // Only returned on creation
      createdAt: data.created_at
    });
    
    // Log audit
    await logAudit({
      orgId,
      action: 'apikey.create',
      targetType: 'api_key',
      targetId: data.id,
      meta: { name }
    });
  } catch (e: any) {
    console.error("Create API key error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

app.get("/api/orgs/:orgId/projects/:projectId/api-keys", async (req, res) => {
  try {
    const { orgId, projectId } = req.params;
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // TODO: Verify user has admin/owner role for orgId
    
    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, name, prefix, env, scopes, is_active, created_at, revoked_at')
      .eq('org_id', orgId)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ keys: data || [] });
  } catch (e: any) {
    console.error("Get API keys error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get evaluations for an org/project
app.get("/evaluations", async (req, res) => {
  try {
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const projectId = req.query.projectId as string || context.projectId;
    const env = req.query.env as string || context.env;
    
    let query = supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('org_id', context.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    if (env) {
      query = query.eq('env', env);
    }
    
    const { data, error } = await query;
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ evaluations: data || [] });
  } catch (e: any) {
    console.error("Get evaluations error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get a single evaluation by ID
app.get("/evaluations/:evaluationId", async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data, error } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .maybeSingle();
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    if (!data) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    res.json({ evaluation: data });
  } catch (e: any) {
    console.error("Get evaluation error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get issues for a specific evaluation
app.get("/evaluations/:evaluationId/issues", async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // Get the evaluation with its report (which contains issues)
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('id, org_id, report')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .maybeSingle();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    // Issues are stored in the report JSONB field
    const issues = (evaluation.report as any)?.issues || [];
    
    res.json({ issues });
  } catch (e: any) {
    console.error("Get evaluation issues error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Update an issue status (e.g., mark as resolved)
app.patch("/evaluations/:evaluationId/issues/:issueId", async (req, res) => {
  try {
    const { evaluationId, issueId } = req.params;
    const { status } = req.body;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // Get the evaluation with its report
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('id, org_id, report')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .maybeSingle();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    // Find and update the issue in the report
    const report = evaluation.report as any;
    if (!report || !report.issues) {
      return res.status(404).json({ error: "No issues found in evaluation" });
    }
    
    // issueId could be the claimId or issue index
    const issueIndex = report.issues.findIndex((i: any) => i.claimId === issueId || i.id === issueId);
    if (issueIndex === -1) {
      return res.status(404).json({ error: "Issue not found" });
    }
    
    // Update the issue status
    report.issues[issueIndex].status = status;
    report.issues[issueIndex].updated_at = new Date().toISOString();
    
    // Save the updated report
    const { error: updateError } = await supabaseAdmin
      .from('evaluations')
      .update({ report })
      .eq('id', evaluationId);
    
    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }
    
    res.json({ success: true, issue: report.issues[issueIndex] });
  } catch (e: any) {
    console.error("Update evaluation issue error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// ============================================================================
// ISSUE EXPORT ENDPOINTS
// ============================================================================

// Export evaluation issues as JSON
app.get("/evaluations/:evaluationId/export/json", requireCapability(Capability.EXPORT_JSON), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('id, org_id, report')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .maybeSingle();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const issueAnalysis = report?.issueAnalysis;
    
    if (issueAnalysis) {
      // Use the new clustered issue analysis
      const output: IssueAnalysisOutput = {
        summary: issueAnalysis.summary,
        issues: issueAnalysis.clusteredIssues,
        claims: report.claims?.map((c: any) => ({
          id: c.id,
          speaker: c.meta?.speaker || "UNKNOWN",
          text: c.text,
          turnIndex: c.meta?.turnIndex || 0,
          topics: c.topicTags || []
        })) || [],
        edges: (report.graph?.contradictions || []).map((c: any, i: number) => ({
          id: `edge_${i}`,
          type: "CONTRADICTION",
          fromClaimId: c.claimA,
          toClaimId: c.claimB,
          score: c.weight || 1,
          rationale: "Contradiction"
        })).concat((report.graph?.supports || []).map((s: any, i: number) => ({
          id: `edge_support_${i}`,
          type: "SUPPORT",
          fromClaimId: s.claimA,
          toClaimId: s.claimB,
          score: s.weight || 1,
          rationale: "Support"
        }))),
        reproducibility: issueAnalysis.reproducibility,
        processingTimeMs: issueAnalysis.processingTimeMs || 0
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}.json"`);
      return res.send(exportAsJSON(output));
    }
    
    // Fallback: export raw report
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}.json"`);
    res.json(report);
  } catch (e: any) {
    console.error("Export JSON error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Export evaluation issues as CSV
app.get("/evaluations/:evaluationId/export/csv", requireCapability(Capability.EXPORT_CSV), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('id, org_id, report')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .maybeSingle();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const issueAnalysis = report?.issueAnalysis;
    
    if (issueAnalysis) {
      const output: IssueAnalysisOutput = {
        summary: issueAnalysis.summary,
        issues: issueAnalysis.clusteredIssues,
        claims: [],
        edges: [],
        reproducibility: issueAnalysis.reproducibility,
        processingTimeMs: issueAnalysis.processingTimeMs || 0
      };
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}.csv"`);
      return res.send(exportAsCSV(output));
    }
    
    // Fallback: generate CSV from raw issues
    const issues = report?.issues || [];
    const headers = ["claimId", "severity", "issueType", "claimText", "speaker", "status"];
    const rows = issues.map((i: any) => [
      i.claimId,
      i.risk?.severity || i.severity || "unknown",
      i.what?.issueType || i.issueType || "unknown",
      `"${(i.what?.claimText || i.claimText || "").replace(/"/g, '""')}"`,
      i.who?.speaker || i.speaker || "unknown",
      i.status || "OPEN"
    ]);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}.csv"`);
    res.send([headers.join(","), ...rows.map((r: string[]) => r.join(","))].join("\n"));
  } catch (e: any) {
    console.error("Export CSV error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Export evaluation as HTML report (printable/PDF-ready)
app.get("/evaluations/:evaluationId/export/html", requireCapability(Capability.EXPORT_JSON), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('id, org_id, report')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .maybeSingle();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const issueAnalysis = report?.issueAnalysis;
    
    if (issueAnalysis) {
      const output: IssueAnalysisOutput = {
        summary: issueAnalysis.summary,
        issues: issueAnalysis.clusteredIssues,
        claims: [],
        edges: [],
        reproducibility: issueAnalysis.reproducibility,
        processingTimeMs: issueAnalysis.processingTimeMs || 0
      };
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}.html"`);
      return res.send(exportAsHTML(output));
    }
    
    // Fallback: generate simple HTML from raw issues
    const issues = report?.issues || [];
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Evaluation Report - ${evaluationId}</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .issue { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .severity-critical { border-left: 4px solid #991b1b; }
    .severity-high { border-left: 4px solid #ea580c; }
    .severity-medium { border-left: 4px solid #2563eb; }
    .severity-low { border-left: 4px solid #16a34a; }
  </style>
</head>
<body>
  <h1>Evaluation Report</h1>
  <p>ID: ${evaluationId}</p>
  <p>Total Issues: ${issues.length}</p>
  ${issues.map((i: any, idx: number) => `
    <div class="issue severity-${(i.risk?.severity || i.severity || 'medium').toLowerCase()}">
      <h3>#${idx + 1}: ${i.what?.issueType || i.issueType || 'Issue'}</h3>
      <p><strong>Speaker:</strong> ${i.who?.speaker || i.speaker || 'Unknown'}</p>
      <p><strong>Claim:</strong> ${i.what?.claimText || i.claimText || 'N/A'}</p>
      <p><strong>Status:</strong> ${i.status || 'OPEN'}</p>
    </div>
  `).join('')}
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}.html"`);
    res.send(html);
  } catch (e: any) {
    console.error("Export HTML error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Export issue narratives as CSV
app.get("/evaluations/:evaluationId/export/narratives/csv", requireCapability(Capability.EXPORT_CSV), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .single();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const issueNarratives = report?.issueNarratives;
    
    if (!issueNarratives || !issueNarratives.narratives) {
      return res.status(404).json({ error: "Issue narratives not found for this evaluation" });
    }
    
    // Get reproducibility from manifest
    const manifest = report?.manifest || {};
    const reproducibility = {
      inputHash: manifest.inputHash || "N/A",
      configHash: manifest.configHash || "N/A",
      codeVersion: manifest.codeVersion || "N/A",
      engineVersion: manifest.engineVersion || "N/A",
      modelFingerprint: manifest.modelFingerprint || {},
    };
    
    const exportData = {
      narratives: issueNarratives.narratives,
      summary: issueNarratives.summary,
      reproducibility,
    };
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}-narratives.csv"`);
    return res.send(exportNarrativesAsCSV(exportData));
  } catch (e: any) {
    console.error("Export narratives CSV error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Export issue narratives as JSON
app.get("/evaluations/:evaluationId/export/narratives/json", requireCapability(Capability.EXPORT_JSON), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .single();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const issueNarratives = report?.issueNarratives;
    
    if (!issueNarratives || !issueNarratives.narratives) {
      return res.status(404).json({ error: "Issue narratives not found for this evaluation" });
    }
    
    // Get reproducibility from manifest
    const manifest = report?.manifest || {};
    const reproducibility = {
      inputHash: manifest.inputHash || "N/A",
      configHash: manifest.configHash || "N/A",
      codeVersion: manifest.codeVersion || "N/A",
      engineVersion: manifest.engineVersion || "N/A",
      modelFingerprint: manifest.modelFingerprint || {},
    };
    
    const exportData = {
      narratives: issueNarratives.narratives,
      summary: issueNarratives.summary,
      reproducibility,
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}-narratives.json"`);
    return res.send(exportNarrativesAsJSON(exportData));
  } catch (e: any) {
    console.error("Export narratives JSON error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Export issue narratives as HTML (PDF-ready)
app.get("/evaluations/:evaluationId/export/narratives/html", requireCapability(Capability.EXPORT_JSON), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .single();
    
    if (evalError) {
      return res.status(500).json({ error: evalError.message });
    }
    
    if (!evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const issueNarratives = report?.issueNarratives;
    
    if (!issueNarratives || !issueNarratives.narratives) {
      return res.status(404).json({ error: "Issue narratives not found for this evaluation" });
    }
    
    // Get reproducibility from manifest
    const manifest = report?.manifest || {};
    const reproducibility = {
      inputHash: manifest.inputHash || "N/A",
      configHash: manifest.configHash || "N/A",
      codeVersion: manifest.codeVersion || "N/A",
      engineVersion: manifest.engineVersion || "N/A",
      modelFingerprint: manifest.modelFingerprint || {},
    };
    
    const exportData = {
      narratives: issueNarratives.narratives,
      summary: issueNarratives.summary,
      reproducibility,
    };
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}-narratives.html"`);
    return res.send(exportNarrativesAsHTML(exportData));
  } catch (e: any) {
    console.error("Export narratives HTML error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// ============================================================================
// ISSUE V2 EXPORTS (Enterprise-Grade)
// ============================================================================

// Export IssueV2 as CSV
app.get("/evaluations/:evaluationId/export/issues-v2/csv", requireCapability(Capability.EXPORT_CSV), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .single();
    
    if (evalError || !evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const allIssuesV2 = report?.allIssuesV2 || [];
    
    if (allIssuesV2.length === 0) {
      return res.status(404).json({ error: "IssueV2 data not found for this evaluation" });
    }
    
    // Build CSV
    const headers = [
      'Rank', 'Issue ID', 'Issue Key', 'Type', 'Category', 'Severity', 'Risk Score',
      'Confidence', 'Review Required', 'Verification Level', 'Speaker', 'Turn Index',
      'Primary Claim ID', 'Related Claim IDs', 'Issue Summary', 'Issue Detail',
      'Evidence Count', 'Compliance Tags', 'Legal Hold Suggested', 'Disclaimers'
    ];
    
    const rows = allIssuesV2.map((issue: any, idx: number): string[] => [
      idx + 1,
      issue.issueId || '',
      issue.issueKey || '',
      issue.type || '',
      issue.category || '',
      issue.severity || '',
      (issue.riskScore * 100).toFixed(2),
      (issue.confidence * 100).toFixed(2),
      issue.reviewRequired ? 'Yes' : 'No',
      issue.verification?.level || '',
      issue.who?.speaker || '',
      issue.who?.turnIndex || '',
      issue.what?.primaryClaimId || '',
      (issue.what?.relatedClaimIds || []).join('; '),
      (issue.what?.issueSummary || '').replace(/"/g, '""'),
      (issue.what?.issueDetail || '').replace(/"/g, '""'),
      (issue.evidence?.refs || []).length,
      (issue.compliance?.tags || []).join('; '),
      issue.compliance?.legalHoldSuggested ? 'Yes' : 'No',
      (issue.compliance?.disclaimers || []).join('; ').replace(/"/g, '""')
    ]);
    
    const csv = [
      headers.map((h: string) => `"${h}"`).join(','),
      ...rows.map((row: string[]) => row.map((cell: string) => `"${cell}"`).join(','))
    ].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}-issues-v2.csv"`);
    return res.send(csv);
  } catch (e: any) {
    console.error("Export IssueV2 CSV error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Export IssueV2 as JSON
app.get("/evaluations/:evaluationId/export/issues-v2/json", requireCapability(Capability.EXPORT_JSON), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .single();
    
    if (evalError || !evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const allIssuesV2 = report?.allIssuesV2 || [];
    const topIssuesV2 = report?.topIssuesV2 || [];
    const issueSummaryV2 = report?.issueSummaryV2 || {};
    const manifest = report?.manifest || {};
    
    if (allIssuesV2.length === 0) {
      return res.status(404).json({ error: "IssueV2 data not found for this evaluation" });
    }
    
    const exportData = {
      evaluationId,
      runId: evaluation.id,
      conversationId: evaluation.conversation_id,
      exportedAt: new Date().toISOString(),
      allIssues: allIssuesV2,
      topIssues: topIssuesV2,
      summary: issueSummaryV2,
      reproducibility: {
        inputHash: manifest.inputHash,
        configHash: manifest.configHash,
        codeVersion: manifest.codeVersion,
        engineVersion: manifest.engineVersion,
        modelFingerprint: manifest.modelFingerprint,
        evidenceMode: manifest.evidenceMode,
      },
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}-issues-v2.json"`);
    return res.json(exportData);
  } catch (e: any) {
    console.error("Export IssueV2 JSON error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Export IssueV2 as PDF (HTML printable)
app.get("/evaluations/:evaluationId/export/issues-v2/pdf", requireCapability(Capability.EXPORT_JSON), async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('id', evaluationId)
      .eq('org_id', context.orgId)
      .single();
    
    if (evalError || !evaluation) {
      return res.status(404).json({ error: "Evaluation not found" });
    }
    
    const report = evaluation.report as any;
    const allIssuesV2 = report?.allIssuesV2 || [];
    const topIssuesV2 = report?.topIssuesV2 || [];
    const issueSummaryV2 = report?.issueSummaryV2 || {};
    const manifest = report?.manifest || {};
    
    if (allIssuesV2.length === 0) {
      return res.status(404).json({ error: "IssueV2 data not found for this evaluation" });
    }
    
    // Generate HTML report
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Evaluation Issues V2 - ${evaluationId}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 2px solid #ddd; padding-bottom: 5px; }
    .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .summary-item { margin: 5px 0; }
    .issue { margin: 20px 0; padding: 15px; border-left: 4px solid #ddd; }
    .issue.critical { border-left-color: #991b1b; }
    .issue.high { border-left-color: #ea580c; }
    .issue.medium { border-left-color: #2563eb; }
    .issue.low { border-left-color: #16a34a; }
    .issue-header { display: flex; gap: 15px; margin-bottom: 10px; }
    .issue-meta { font-size: 0.9em; color: #666; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 3px; font-size: 0.85em; margin-right: 5px; }
    .badge-transcript-only { background: #e3f2fd; color: #1976d2; }
    .evidence-section { margin-top: 10px; padding: 10px; background: #f9f9f9; }
    .evidence-quote { margin: 5px 0; padding: 5px; background: white; border-left: 3px solid #ccc; }
    .compliance-tags { margin-top: 10px; }
    .compliance-tag { background: #e0e0e0; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; margin-right: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>Evaluation Issues V2 Report</h1>
  <div class="summary">
    <h2>Summary</h2>
    <div class="summary-item"><strong>Evaluation ID:</strong> ${evaluationId}</div>
    <div class="summary-item"><strong>Total Issues:</strong> ${allIssuesV2.length}</div>
    <div class="summary-item"><strong>Top Issues:</strong> ${topIssuesV2.length}</div>
    <div class="summary-item"><strong>Evidence Mode:</strong> ${manifest.evidenceMode || 'N/A'}</div>
    <div class="summary-item"><strong>Exported:</strong> ${new Date().toISOString()}</div>
  </div>
  
  <h2>Top ${topIssuesV2.length} Issues (Ranked by Risk)</h2>
  ${topIssuesV2.map((issue: any, idx: number) => `
    <div class="issue ${issue.severity}">
      <div class="issue-header">
        <strong>#${idx + 1}: ${issue.type}</strong>
        <span class="badge severity-${issue.severity}">${issue.severity.toUpperCase()}</span>
        <span class="badge">Risk: ${(issue.riskScore * 100).toFixed(0)}%</span>
        ${issue.verification.level === 'TRANSCRIPT_ONLY' ? '<span class="badge badge-transcript-only">TRANSCRIPT_ONLY</span>' : ''}
        ${issue.reviewRequired ? '<span class="badge">Review Required</span>' : ''}
      </div>
      <div class="issue-meta">
        <strong>Category:</strong> ${issue.category} | 
        <strong>Speaker:</strong> ${issue.who.speaker} | 
        <strong>Confidence:</strong> ${(issue.confidence * 100).toFixed(0)}%
      </div>
      <div><strong>Summary:</strong> ${issue.what.issueSummary}</div>
      <div><strong>Detail:</strong> ${issue.what.issueDetail}</div>
      ${issue.evidence.refs.length > 0 ? `
        <div class="evidence-section">
          <strong>Evidence (${issue.evidence.refs.length}):</strong>
          ${issue.evidence.refs.map((ref: any) => `
            <div class="evidence-quote">
              <strong>${ref.sourceType}</strong> (${ref.sourceId}): "${ref.quote}"
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${issue.compliance.tags.length > 0 ? `
        <div class="compliance-tags">
          <strong>Compliance Tags:</strong>
          ${issue.compliance.tags.map((tag: string) => `<span class="compliance-tag">${tag}</span>`).join('')}
        </div>
      ` : ''}
      ${issue.compliance.disclaimers.length > 0 ? `
        <div><strong>Disclaimers:</strong> ${issue.compliance.disclaimers.join('; ')}</div>
      ` : ''}
    </div>
  `).join('')}
  
  ${allIssuesV2.length > topIssuesV2.length ? `
    <h2>All Issues (${allIssuesV2.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Type</th>
          <th>Severity</th>
          <th>Risk Score</th>
          <th>Summary</th>
          <th>Verification</th>
        </tr>
      </thead>
      <tbody>
        ${allIssuesV2.map((issue: any, idx: number) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${issue.type}</td>
            <td>${issue.severity.toUpperCase()}</td>
            <td>${(issue.riskScore * 100).toFixed(0)}%</td>
            <td>${issue.what.issueSummary}</td>
            <td>${issue.verification.level}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}
  
  <div class="summary" style="margin-top: 40px;">
    <h2>Reproducibility</h2>
    <div class="summary-item"><strong>Engine Version:</strong> ${manifest.engineVersion || 'N/A'}</div>
    <div class="summary-item"><strong>Input Hash:</strong> ${manifest.inputHash || 'N/A'}</div>
    <div class="summary-item"><strong>Config Hash:</strong> ${manifest.configHash || 'N/A'}</div>
    <div class="summary-item"><strong>Code Version:</strong> ${manifest.codeVersion || 'N/A'}</div>
  </div>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${evaluationId}-issues-v2.html"`);
    res.send(html);
  } catch (e: any) {
    console.error("Export IssueV2 PDF error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Get projects for an org
app.get("/api/orgs/:orgId/projects", async (req, res) => {
  try {
    const { orgId } = req.params;
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // TODO: Verify user has access to this org
    
    const projects = await getOrgProjects(orgId);
    res.json({ projects });
  } catch (e: any) {
    console.error("Get projects error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get project environments
app.get("/api/projects/:projectId/envs", async (req, res) => {
  try {
    const { projectId } = req.params;
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // TODO: Verify user has access to this project
    
    const envs = await getProjectEnvs(projectId);
    res.json({ envs });
  } catch (e: any) {
    console.error("Get project envs error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Revoke API key
app.post("/api/orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke", async (req, res) => {
  try {
    const { orgId, projectId, keyId } = req.params;
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // TODO: Verify user has admin/owner role for orgId
    
    const { error } = await supabaseAdmin
      .from('api_keys')
      .update({ 
        is_active: false,
        revoked_at: new Date().toISOString()
      })
      .eq('id', keyId)
      .eq('org_id', orgId)
      .eq('project_id', projectId);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ success: true });
    
    // Log audit
    await logAudit({
      orgId,
      action: 'apikey.revoke',
      targetType: 'api_key',
      targetId: keyId,
      meta: { projectId }
    });
  } catch (e: any) {
    console.error("Revoke API key error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Setup conversation routes (drafts, transcription) RIGHT BEFORE general /api/conversations route
// This ensures more specific routes like /api/conversations/drafts/audio are matched first
// Registered here (after middleware setup) to avoid initialization issues
console.log("Registering conversation routes (before /api/conversations)...");
setupConversationRoutes(app);
console.log("Conversation routes registered successfully");

// Create conversation (ingest transcript)
app.post("/api/conversations", async (req, res) => {
  try {
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const { title, content, externalId, metadata = {} } = req.body;
    
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: "content is required and must be a string" });
    }
    
    // TODO: Extract userId from JWT if user session
    
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .insert({
        org_id: context.orgId,
        project_id: context.projectId || null,
        env: context.env,
        external_id: externalId || null,
        title: title || null,
        content: content,
        metadata: metadata
      })
      .select('id, org_id, project_id, env, title, created_at')
      .single();
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    // Track usage
    await trackUsage(context.orgId, context.projectId, context.env, 'conversation');
    
    // Log audit
    await logAudit({
      orgId: context.orgId,
      action: 'conversation.create',
      targetType: 'conversation',
      targetId: data.id,
      meta: { projectId: context.projectId, env: context.env }
    });
    
    res.json({ conversation: data });
  } catch (e: any) {
    console.error("Create conversation error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get conversations
app.get("/api/conversations", async (req, res) => {
  try {
    const context = await getOrgContext(req);
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const projectId = req.query.projectId as string || context.projectId;
    const env = req.query.env as string || context.env;
    
    let query = supabaseAdmin
      .from('conversations')
      .select('id, org_id, project_id, env, external_id, title, created_at')
      .eq('org_id', context.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    if (env) {
      query = query.eq('env', env);
    }
    
    const { data, error } = await query;
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ conversations: data || [] });
  } catch (e: any) {
    console.error("Get conversations error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// Get evaluations for a conversation
app.get("/api/conversations/:conversationId/evaluations", async (req, res) => {
  try {
    const context = await getOrgContext(req);
    const { conversationId } = req.params;
    
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const { data, error } = await supabaseAdmin
      .from('evaluations')
      .select('*')
      .eq('org_id', context.orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ evaluations: data || [] });
  } catch (e: any) {
    console.error("Get conversation evaluations error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error"
    });
  }
});

// ============================================================================
// SENSITIVE ACTIONS: Re-authentication verification
// ============================================================================

/**
 * Verify user password for sensitive actions
 * This endpoint is called before performing operations like:
 * - Deleting evaluations
 * - Exporting audit packets
 * - Changing org settings
 * - Managing API keys
 * - Modifying integrations
 */
// Helper to check and auto-grant superuser after authentication
async function checkAndGrantSuperuser(userId: string, email: string): Promise<void> {
  try {
    const { maybeGrantSuperuser } = await import('./admin/superuser-auto-grant.js');
    await maybeGrantSuperuser(userId, email);
  } catch (error: any) {
    // Don't fail auth if superuser grant fails
    console.error('Failed to check superuser auto-grant:', error);
  }
}

app.post("/auth/verify-password", async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: "password is required" });
    }
    
    const context = await getOrgContext(req);
    if (!context || context.error || !context.userId) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // Get user's email
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    
    if (userError || !user || !user.email) {
      return res.status(401).json({ error: "User not found" });
    }
    
    // Verify password by signing in (this doesn't create a new session, just verifies)
    // Note: We use signInWithPassword to verify - Supabase doesn't have a dedicated verify endpoint
    const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: user.email,
      password
    });
    
    if (signInError) {
      return res.status(401).json({ error: "Invalid password", verified: false });
    }
    
    // Check and auto-grant superuser if in allowlist
    await checkAndGrantSuperuser(context.userId, user.email);
    
    // Log audit event
    await logAudit({
      orgId: context.orgId,
      action: 'sensitive_action.reauth',
      targetType: 'user',
      targetId: context.userId,
      meta: { 
        success: true,
        ip: req.ip
      }
    });
    
    res.json({ verified: true });
  } catch (e: any) {
    console.error("Verify password error:", e);
    res.status(500).json({ 
      error: e?.message ?? "unknown error",
      verified: false
    });
  }
});

// Audio transcription endpoint
app.post("/api/transcribe", upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const context = await getOrgContext(req);
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }

    // Transcribe audio (does not store the file)
    // Concurrency limiting is handled inside transcribeAudio()
    const result = await transcribeAudio(req.file.buffer, req.file.originalname);

    // Track usage
    await trackUsage(context.orgId, context.projectId, context.env, 'transcription');

    // Log audit (do not log transcript text for privacy)
    await logAudit({
      orgId: context.orgId,
      action: 'transcription.create',
      targetType: 'transcription',
      meta: {
        filename: req.file.originalname,
        size: req.file.size,
        language: result.language,
        durationMs: result.durationMs,
        vadMode: result.vadStats?.mode,
      },
    });

    // Return result (backward compatible format + new optional fields)
    res.json({
      transcript: result.transcript,
      text: result.text || result.transcript, // Alias for backward compatibility
      language: result.language || 'unknown',
      // New optional fields (non-breaking)
      ...(result.segments && { segments: result.segments }),
      ...(result.durationMs !== undefined && { durationMs: result.durationMs }),
      ...(result.vadStats && { vadStats: result.vadStats }),
    });
  } catch (e: any) {
    // Handle concurrency limit (429)
    if (e.code === 'ASR_BUSY' || e.statusCode === 429) {
      return res.status(429).json({
        error: 'ASR_BUSY',
        message: e.message || 'Transcription worker is busy. Try again.',
      });
    }

    console.error("Transcription error:", e.message);
    res.status(500).json({
      error: e?.message ?? "Transcription failed",
    });
  }
});

// Setup integration routes
console.log("Registering integration routes...");
setupIntegrationRoutes(app);
console.log("Integration routes registered successfully");

// Setup webhooks routes
console.log("Registering webhooks routes...");
setupWebhooksRoutes(app);
console.log("Webhooks routes registered successfully");

// Setup Jira routes
console.log("Registering Jira routes...");
setupJiraRoutes(app);
console.log("Jira routes registered successfully");

// Setup batch ingestion routes
console.log("Registering batch ingestion routes...");
setupBatchIngestionRoutes(app);
console.log("Batch ingestion routes registered successfully");

// Setup connector routes
console.log("Registering connector routes...");
setupConnectorRoutes(app);
console.log("Connector routes registered successfully");

// Setup evaluation search routes FIRST (before /api/evaluations)
// This ensures /api/evaluations/search matches before the more general /api/evaluations route
console.log("Registering evaluation search routes...");
setupEvaluationSearchRoutes(app);
console.log("Evaluation search routes registered successfully");

// Setup audit-grade analysis routes
console.log("Registering audit routes...");
setupAuditRoutes(app);
console.log("Audit routes registered successfully");

// Setup issue workflow routes
console.log("Registering issue workflow routes...");
setupIssueWorkflowRoutes(app);
console.log("Issue workflow routes registered successfully");

// Setup issue decisions routes
console.log("Registering issue decisions routes...");
setupIssueDecisionsRoutes(app);
console.log("Issue decisions routes registered successfully");

// Setup issue signoffs routes
console.log("Registering issue signoffs routes...");
setupIssueSignoffsRoutes(app);
console.log("Issue signoffs routes registered successfully");

// Setup issue snapshots routes
console.log("Registering issue snapshots routes...");
setupIssueSnapshotsRoutes(app);
console.log("Issue snapshots routes registered successfully");

// Setup cases routes
console.log("Registering cases routes...");
setupCasesRoutes(app);
console.log("Cases routes registered successfully");

// Setup analytics routes
console.log("Registering analytics routes...");
setupAnalyticsRoutes(app);

// Setup org routes
console.log("Registering org routes...");
setupOrgRoutes(app);
console.log("Org routes registered successfully");

// Setup project routes
console.log("Registering project routes...");
setupProjectRoutes(app);
console.log("Project routes registered successfully");

setupTemplateRoutes(app);
console.log("Template routes registered successfully");
console.log("Analytics routes registered successfully");

// Setup export routes
console.log("Registering export routes...");
setupExportRoutes(app);
console.log("Export routes registered successfully");

// Setup policy routes
console.log("Registering policy routes...");
setupPolicyRoutes(app);
console.log("Policy routes registered successfully");

// Setup evidence routes
console.log("Registering evidence routes...");
setupEvidenceRoutes(app);
console.log("Evidence routes registered successfully");

// Setup admin scoring profiles routes
console.log("Registering admin scoring profiles routes...");
setupScoringProfilesRoutes(app);
console.log("Admin scoring profiles routes registered successfully");

// Setup API key management routes
console.log("Registering API key routes...");
setupApiKeyRoutes(app);
console.log("API key routes registered successfully");

// Setup API analyze endpoint
console.log("Registering API analyze endpoint...");
setupAnalyzeEndpoint(app);
console.log("API analyze endpoint registered successfully");

// Setup webhook routes
console.log("Registering webhook routes...");
setupWebhookRoutes(app);
console.log("Webhook routes registered successfully");

// Setup integration connections routes
console.log("Registering integration connections routes...");
setupIntegrationConnectionsRoutes(app);
console.log("Integration connections routes registered successfully");

// Setup billing routes
console.log("Registering billing routes...");
setupBillingRoutes(app);
console.log("Billing routes registered successfully");

// Stripe webhook endpoint (raw body required)
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  await handleStripeWebhook(req, res);
});
console.log("Stripe webhook endpoint registered");

// Setup downgrade job route (admin)
setupDowngradeJobRoute(app);
console.log("Downgrade job route registered");

// Setup ingestion routes (normalization pipeline)
console.log("Registering ingestion routes...");
registerIngestEndpoints(app);

// Register new ingestion job routes (async transcription workflow)
console.log("Registering ingestion job routes...");
registerIngestionJobRoutes(app);
console.log("Ingestion job routes registered successfully");
console.log("Ingestion routes registered successfully");

// Load and validate plan configuration at startup
console.log("Loading plan configuration...");
try {
  const planConfig = loadPlanConfig();
  validatePlanConfig(planConfig);
  console.log("✅ Plan configuration loaded and validated successfully");
  console.log(`   - SANDBOX: ${planConfig.plans.SANDBOX.capabilities.length} capabilities`);
  console.log(`   - TEAM: ${planConfig.plans.TEAM.capabilities.length} capabilities`);
  console.log(`   - ENTERPRISE: ${planConfig.plans.ENTERPRISE.capabilities.length} capabilities`);
} catch (error: any) {
  console.error("❌ Failed to load plan configuration:", error.message);
  console.error("   Server will not start with invalid plan configuration.");
  process.exit(1);
}

// Railway sets PORT automatically, but we default to 8787
const port = Number(process.env.PORT || 8787);

console.log(`Starting server...`);
console.log(`PORT environment variable: ${process.env.PORT || 'not set'}`);
console.log(`Using port: ${port}`);

// Check critical environment variables
const spectralUrl = process.env.TCL_SPECTRAL_URL;
if (spectralUrl) {
  console.log(`✅ TCL_SPECTRAL_URL configured: ${spectralUrl}`);
} else {
  console.warn(`⚠️ TCL_SPECTRAL_URL not set - spectral analysis will be skipped!`);
  console.warn(`   Set this to your tcl-spectral service URL (e.g., https://tcl-spectral-production-xxxx.up.railway.app)`);
}

// Start server with error handling
try {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ TCL-Core listening on ${port}`);
    console.log(`Health check available at http://0.0.0.0:${port}/health`);
    console.log(`Environment: PORT=${process.env.PORT || 'default (8787)'}, NODE_ENV=${process.env.NODE_ENV || 'not set'}`);
    console.log(`TCL_SPECTRAL_URL: ${process.env.TCL_SPECTRAL_URL || 'NOT SET'}`);
    
    // Verify server is actually listening
    const address = server.address();
    if (address && typeof address === 'object') {
      console.log(`Server bound to ${address.address}:${address.port}`);
    }
    
    // Start evidence indexing worker
    try {
      startIndexingWorker();
      console.log('✅ Evidence indexing worker started');
    } catch (err: any) {
      console.warn('⚠️ Failed to start evidence indexing worker:', err.message);
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
  console.error('========== UNHANDLED REJECTION ==========');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  if (reason instanceof Error) {
    console.error('Error message:', reason.message);
    console.error('Error stack:', reason.stack);
  }
  console.error('==========================================');
});

// Global error handler middleware (must be last)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('========== GLOBAL ERROR HANDLER ==========');
  console.error('Path:', req.path);
  console.error('Method:', req.method);
  console.error('Error:', err);
  console.error('Error message:', err?.message);
  console.error('Error stack:', err?.stack);
  console.error('==========================================');
  
  if (!res.headersSent) {
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: err?.message || 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
});
