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
import { buildIssuesList } from "./audit/reproducibility.js";
import { getOrgContext } from "./auth-context.js";
import { registerIngestEndpoints } from "./ingestion/ingest-endpoint.js";

const app = express();

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
  if (req.path === '/transcribe' || req.path.startsWith('/webhooks/')) {
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
    const groundingPairs = [];
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
      batchSize: 32,
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
    const startTime = Date.now();
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
        const graphData = out.report.graph || {};
        const graphSupports = graphData.supports || [];
        const graphContradictions = graphData.contradictions || out.report.contradictions?.map((c: any) => ({ 
          claimA: c.claimA, 
          claimB: c.claimB, 
          weight: 1.0 
        })) || [];
        const graphGrounding = graphData.grounding || [];
        
        console.log("6️⃣ BUILDING ISSUES with spectral + graph data:", {
          hasSpectral: !out.report.spectral?.spectralSkipped,
          truthStatesCount: spectralData.truthStates?.length || 0,
          nodeBlameCount: spectralData.nodeBlameNorm?.length || 0,
          destructiveCount: out.report.destructiveClaims?.length || 0,
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
      } catch (issueErr: any) {
        console.warn('Failed to build issues list:', issueErr.message);
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
    const reportWithIssues = {
      ...out.report,
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
      hasSpectral: !!reportWithIssues.spectral,
      spectralCoherence: reportWithIssues.spectral?.coherenceScore,
      issuesCount: issues.length,
      claimsCount: reportWithIssues.claims?.length || 0,
      inputsClaimsCount: reportWithIssues.inputs?.claims?.length || 0,
      supportsCount: reportWithIssues.graph?.supports?.length || 0,
      contradictionsCount: reportWithIssues.graph?.contradictions?.length || 0
    });

    // Store validation in Supabase if configured
    const context = await getOrgContext(req);
    if (context && supabaseAdmin) {
      try {
        // Check if conversation_id is provided in request body
        const conversationId = (req.body as any).conversation_id;
        
        // Build proper scores structure that frontend expects
        const spectralReport = out.report?.spectral || {};
        const spectralSkipped = spectralReport.spectralSkipped === true;
        
        // Count issues by type
        const contradictedCount = issues.filter((i: any) => 
          i.what?.truthState === 'Contradicted' || i.truthState === 'Contradicted'
        ).length;
        const ungroundedCount = issues.filter((i: any) => 
          i.what?.truthState === 'Ungrounded' || i.truthState === 'Ungrounded'
        ).length;
        const totalClaims = out.report?.claims?.length || 0;
        
        // Calculate coherence - use spectral if available, fallback to orchestrator score
        const coherenceScore = spectralReport.coherenceScore ?? out.scores?.coherence;
        
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
          // Counts (always include for UI display)
          counts: {
            claims: totalClaims,
            contradicted: contradictedCount,
            ungrounded: ungroundedCount,
            supported: Math.max(0, totalClaims - contradictedCount - ungroundedCount),
            supports: out.report?.graph?.supports?.length || 0,
            contradictions: out.report?.graph?.contradictions?.length || 0
          }
        };
        
        const { error: dbError } = await supabaseAdmin
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
            report: reportWithIssues
          });
        
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
        }
      } catch (dbErr: any) {
        console.error('Database error (non-fatal):', dbErr);
      }
    }

    clearTimeout(timeout);
    // Return output with issues included
    res.json({
      ...out,
      report: reportWithIssues
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

// Get user's organizations
app.post("/me/orgs", async (req, res) => {
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
app.get("/orgs/:orgId/members", async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.body.userId || req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }
    
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase not configured" });
    }
    
    // Check if user has view permission (all members can view)
    const canView = await checkUserPermission(userId, orgId, 'view');
    if (!canView) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    
    const members = await listMembers(orgId);
    res.json({ members });
  } catch (e: any) {
    console.error("List members error:", e);
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
});

// Invite a member to an organization
app.post("/orgs/:orgId/members/invite", async (req, res) => {
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

// Update a member's role
app.patch("/orgs/:orgId/members/:memberUserId", async (req, res) => {
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
app.delete("/orgs/:orgId/members/:memberUserId", async (req, res) => {
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
app.post("/orgs/:orgId/api-keys", async (req, res) => {
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

app.get("/orgs/:orgId/projects/:projectId/api-keys", async (req, res) => {
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

// Get projects for an org
app.get("/orgs/:orgId/projects", async (req, res) => {
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
app.get("/projects/:projectId/envs", async (req, res) => {
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
app.post("/orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke", async (req, res) => {
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

// Create conversation (ingest transcript)
app.post("/conversations", async (req, res) => {
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
app.get("/conversations", async (req, res) => {
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
app.get("/conversations/:conversationId/evaluations", async (req, res) => {
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
app.post("/transcribe", upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const context = await getOrgContext(req);
    if (!context || context.error) {
      return res.status(401).json({ error: context?.error || "Authorization required" });
    }

    // Transcribe audio (does not store the file)
    const result = await transcribeAudio(req.file.buffer, req.file.originalname);

    // Track usage
    await trackUsage(context.orgId, context.projectId, context.env, 'transcription');

    // Log audit
    await logAudit({
      orgId: context.orgId,
      action: 'transcription.create',
      targetType: 'transcription',
      meta: {
        filename: req.file.originalname,
        size: req.file.size,
        language: result.language,
      },
    });

    res.json({
      transcript: result.transcript,
      text: result.transcript, // Alias for compatibility
      language: result.language,
    });
  } catch (e: any) {
    console.error("Transcription error:", e);
    res.status(500).json({
      error: e?.message ?? "Transcription failed",
    });
  }
});

// Setup integration routes
setupIntegrationRoutes(app);

// Setup audit-grade analysis routes
console.log("Registering audit routes...");
setupAuditRoutes(app);
console.log("Audit routes registered successfully");

// Setup ingestion routes (normalization pipeline)
console.log("Registering ingestion routes...");
registerIngestEndpoints(app);
console.log("Ingestion routes registered successfully");

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
