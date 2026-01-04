import { ValidateInput, ValidateOutput, SpectralReport, Source, RunManifest, Claim, GraphDebugInfo } from "./types.js";
import { extractClaims, extractClaimsWithTypes, type ExtractedClaim } from "./claim_extractor.js";
import { attachEvidenceAndFindViolations } from "./evidence.js";
import { findLogicViolations } from "./logic.js";
import { blendScores, shouldRefuse, assessRunQuality } from "./scoring.js";
import { collectFailingClaimIds, repairOnce } from "./repair.js";
import type { LLMAdapter } from "./adapters/llm_adapter.js";
import { buildClaimGraph, HttpNliScorer, TokenHeuristicScorer } from "./graph/edge_builder.js";
import { TransformersNliScorer } from "./graph/transformers_scorer.js";
import { SpectralNliScorer } from "./graph/spectral_nli_scorer.js";
import { calculateAllClaimConfidences } from "./confidence.js";
import { generateSuggestions } from "./suggestions.js";
import { validateCustomRules } from "./custom_rules.js";
import { computeDestructiveClaims } from "./destructive.js";
import { computeTrajectory } from "./trajectory.js";
import { generateSourcesFromRawTranscript, retrieveEvidenceForClaims } from "./evidence_sources.js";
import { createHash } from "crypto";
import { startPipelineTimer, type PipelineTimer } from "./pipeline_timer.js";

// NEW: Deterministic Truth Engine (replaces NLI)
import { runTruthEngine, toLegacyGraph, buildIssuesFromGraph } from "./engine/index.js";
import { 
  generateReproducibilityMetadata,
  getCodeVersion,
  getEngineVersion,
  getModelFingerprint,
  computeFullConfigHash
} from "./analysis/reproducibility.js";
import { computeTruthFromGraph } from "./analysis/compute-truth-from-graph.js";
import { getEngineConfig } from "./config/engine-config.js";

// NEW: Unified Graph Builder (3-stage pipeline with subject slots)
import { 
  buildGraph as buildUnifiedGraph, 
  toSpectralInput,
  setTemplateConfig,
  type GraphBuilderOutput 
} from "./graph/graph-builder.js";

// Cache for scorer to avoid re-initialization on every request
let cachedScorer: { scorer: any; url: string; timestamp: number } | null = null;
const SCORER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Feature flag: Use deterministic Truth Engine instead of NLI
// Set via environment variable or options
const USE_TRUTH_ENGINE = process.env.TCL_USE_TRUTH_ENGINE === "true";

// Feature flag: Use new unified graph builder (3-stage pipeline with subject slots)
// This is the preferred method - produces semantically correct edges
const USE_UNIFIED_GRAPH_BUILDER = process.env.TCL_USE_UNIFIED_GRAPH === "true";

async function callSpectralService(
  spectralServiceUrl: string,
  claims: { id: string; text: string }[],
  supports: { claimA: string; claimB: string; weight?: number }[],
  contradictions: { claimA: string; claimB: string; weight?: number }[],
  groundedClaimIds: string[]
): Promise<SpectralReport> {
  const url = `${spectralServiceUrl.replace(/\/$/, "")}/spectral/score`;
  console.log(`Spectral request URL: ${url}`);
  console.log(`Spectral request payload:`, {
    claimsCount: claims.length,
    supportsCount: supports.length,
    contradictionsCount: contradictions.length,
    groundedCount: groundedClaimIds.length
  });
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claims, supports, contradictions, grounded: groundedClaimIds })
  });
  
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    console.error(`Spectral service HTTP error ${res.status}: ${errorText}`);
    throw new Error(`Spectral service error: ${res.status} - ${errorText}`);
  }
  
  const result = await res.json() as SpectralReport;
  console.log(`Spectral response:`, result);
  return result;
}

async function callSpectralAnalyzeService(
  spectralServiceUrl: string,
  claims: { id: string; text: string }[],
  supports: { claimA: string; claimB: string; weight?: number }[],
  contradictions: { claimA: string; claimB: string; weight?: number }[],
  groundedClaimIds: string[],
  options?: {
    wSupport?: number;
    wContradiction?: number;
    wCircularity?: number;
    cycleMaxLen?: number;
  }
): Promise<SpectralReport> {
  const url = `${spectralServiceUrl.replace(/\/$/, "")}/spectral/analyze`;
  console.log(`Spectral analyze request URL: ${url}`);
  
  const payload = {
    claims,
    supports,
    contradictions,
    grounded: groundedClaimIds,
    w_support: options?.wSupport,
    w_contradiction: options?.wContradiction,
    w_circularity: options?.wCircularity,
    cycle_max_len: options?.cycleMaxLen
  };
  
  console.log(`Spectral analyze request payload:`, {
    claimsCount: claims.length,
    supportsCount: supports.length,
    contradictionsCount: contradictions.length,
    groundedCount: groundedClaimIds.length
  });
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    console.error(`Spectral analyze service HTTP error ${res.status}: ${errorText}`);
    throw new Error(`Spectral analyze service error: ${res.status} - ${errorText}`);
  }
  
  const result = await res.json() as SpectralReport;
  console.log(`Spectral analyze response received:`, {
    coherenceScore: result.coherenceScore,
    truthVectorLength: result.truthVector?.length || 0,
    truthStatesLength: result.truthStates?.length || 0,
    nodeBlameNormLength: result.nodeBlameNorm?.length || 0,
    topBadContradictions: result.topBadContradictions?.length || 0,
    topBadSupports: result.topBadSupports?.length || 0
  });
  return result;
}

async function validateOnce(input: ValidateInput, adapter?: LLMAdapter, startTime?: number): Promise<ValidateOutput> {
  const timer = startPipelineTimer();
  const validationStartTime = startTime ?? Date.now();
  try {
    const { question, answer, sources: externalSources, options } = input;
    
    // =========================================================================
    // FAST PATH: Use deterministic Truth Engine instead of NLI
    // This is 100-1000x faster and more reproducible
    // =========================================================================
    const useTruthEngine = (options as any)?.useTruthEngine ?? USE_TRUTH_ENGINE;
    
    if (useTruthEngine) {
      console.log("🚀 Using deterministic Truth Engine (NLI disabled)");
      
      // Run the Truth Engine
      const transcript = answer && answer.trim().length > 0 ? answer : question;
      const engineResult = runTruthEngine({ 
        transcript,
        conversationId: (options as any)?.conversationId ?? "inline"
      });
      
      // Convert to legacy graph format
      const legacyGraph = toLegacyGraph(engineResult);
      
      // Build issues
      const issues = buildIssuesFromGraph(engineResult.graph);
      
      // Build claims in expected format (must match Claim type)
      const claims: Claim[] = engineResult.graph.claims.map(c => ({
        id: c.id,
        text: c.text,
        evidence: [], // No external evidence in transcript-only mode
        meta: {
          speaker: c.speaker,
          turnIndex: c.turnIndex,
        },
        confidence: 0.7, // Will be refined by spectral
      }));
      
      // Call spectral with the rule-based graph
      const spectralEnabled = options?.spectral !== false;
      const spectralServiceUrl = options?.spectralServiceUrl ?? process.env.TCL_SPECTRAL_URL ?? "";
      
      let spectral: SpectralReport | undefined;
      let coherenceScore: number | null = null;
      
      if (spectralEnabled && spectralServiceUrl && claims.length > 0) {
        try {
          console.log(`📡 Calling Spectral with rule-based graph (${legacyGraph.contradictions.length} contradictions, ${legacyGraph.supports.length} supports)`);
          
          spectral = await callSpectralAnalyzeService(
            spectralServiceUrl,
            claims.map(c => ({ id: c.id, text: c.text })),
            legacyGraph.supports,
            legacyGraph.contradictions,
            legacyGraph.groundedClaimIds,
            {}
          );
          coherenceScore = spectral.coherenceScore;
          console.log(`✅ Spectral complete. Coherence: ${coherenceScore}`);
        } catch (e: any) {
          console.error("❌ Spectral error:", e.message);
          spectral = { spectralSkipped: true, debugReason: `spectral_error: ${e.message}` } as any;
        }
      }
      
      // Calculate scores
      const consistencyScore = legacyGraph.contradictions.length === 0 ? 100 :
        Math.max(0, 100 - legacyGraph.contradictions.length * 15);
      const finalCoherence = coherenceScore !== null ? Math.round(coherenceScore * 100) : null;
      const overall = finalCoherence !== null 
        ? Math.round((consistencyScore + finalCoherence) / 2)
        : consistencyScore;
      
      // Generate reproducibility metadata (reuse transcript from above)
      const reproMetadata = generateReproducibilityMetadata(transcript);
      
      // Build manifest with full reproducibility
      const manifest: RunManifest = {
        inputHash: reproMetadata.inputHash,
        configHash: reproMetadata.configHash,
        artifactId: (options as any)?.artifactId,
        claimExtractorVersion: "truth-engine-v1",
        nliModelId: "none-rules-only",
        nliThresholds: { support: 0, contradiction: 0, grounding: 0 },
        embeddingModel: "none",
        retrievalK: 0,
        spectralEngineVersion: spectral && !(spectral as any).spectralSkipped ? "v1.0.0" : undefined,
        codeVersion: reproMetadata.codeVersion,
        engineVersion: reproMetadata.engineVersion,
        modelFingerprint: reproMetadata.modelFingerprint,
        createdAt: engineResult.graph.generatedAt,
        transcriptSourcesCount: 0,
        graphHealth: {
          supportEdges: legacyGraph.supports.length,
          contradictionEdges: legacyGraph.contradictions.length,
          groundingEdges: legacyGraph.grounding.length,
          totalEdges: legacyGraph.supports.length + legacyGraph.contradictions.length + legacyGraph.grounding.length,
          healthy: legacyGraph.contradictions.length > 0 || legacyGraph.supports.length > 0,
          reason: undefined,
        },
      };
      
      console.log(`✅ Truth Engine complete: ${engineResult.timings.total}ms (vs ~100s with NLI)`);
      timer.logSummary();
      
      // Map contradictions with reasons for the report (different from graph edges)
      const reportContradictions = engineResult.graph.contradictionEdges.map(e => ({
        claimA: e.srcId,
        claimB: e.dstId,
        reason: e.reason,
      }));
      
      // Build debug info matching GraphDebugInfo type
      const debugInfo: GraphDebugInfo = {
        numClaims: engineResult.graph.claims.length,
        numSources: 0,
        transcriptSourcesGenerated: 0,
        annEnabled: false,
        cacheEnabled: false,
        spectralEnabled: spectralEnabled,
        neighborK: 0,
        supportThreshold: 0,
        contradictionThreshold: 0,
        groundingThreshold: 0,
        pairsGenerated: 0,
        pairsScored: 0,
        edges: {
          supportsAdded: legacyGraph.supports.length,
          contradictionsAdded: legacyGraph.contradictions.length,
          groundingAdded: 0,
        },
        filtered: {
          belowSupportThreshold: 0,
          belowContradictionThreshold: 0,
          belowGroundingThreshold: 0,
          droppedByMaxEdges: 0,
        },
        model: {
          scorerId: "truth-engine-rules-v1",
        },
        reasonIfEmptyGraph: legacyGraph.contradictions.length === 0 && legacyGraph.supports.length === 0 
          ? "no_edges_from_rules" 
          : null,
      };
      
      return {
        answer: answer || transcript,
        refusal: false,
        scores: {
          truth: null,
          consistency: consistencyScore,
          coherence: finalCoherence,
          overall,
        },
        scorerId: "truth-engine-v1",
        latency: engineResult.timings.total,
        engineVersion: engineResult.graph.codeVersion,
        report: {
          claims,
          violations: [],
          missingEvidence: [],
          contradictions: reportContradictions,
          spectral,
          graph: {
            supports: legacyGraph.supports,
            contradictions: legacyGraph.contradictions,
            grounding: legacyGraph.grounding,
            debug: debugInfo,
          },
          suggestions: [],
          manifest,
        },
      };
    }
    
    // =========================================================================
    // LEGACY PATH: NLI-based edge generation (slow, ~100s)
    // =========================================================================
    console.log("⚠️ Using NLI-based edge generation (slow). Set TCL_USE_TRUTH_ENGINE=true for 100x speedup.");
    
    // Spectral is the CORE VALUE of the app - enabled by default
    // Only disable if explicitly set to false
    const spectralEnabled = options?.spectral !== false;
    const spectralServiceUrl = options?.spectralServiceUrl ?? process.env.TCL_SPECTRAL_URL ?? "";
    
    // Configuration for this run
    const retrievalK = options?.annNeighborK ?? 8; // Top-k chunks per claim for NLI
    const conversationId = (options as any)?.conversationId ?? "inline";
    const artifactId = (options as any)?.artifactId;

    // 1) claims
    timer.start('claim_extract');
    let claims = [];
    if (adapter) {
      const art = await adapter.extractArtifacts({ question, answer, sources: externalSources });
      claims = art.claims;
    } else {
      const textToExtract = answer && answer.trim().length > 0 ? answer : question;
      claims = extractClaims(textToExtract);
    }
    timer.end('claim_extract');
    timer.set('num_claims', claims.length);
    console.log(`📋 Claims extracted: ${claims.length} (${timer.duration('claim_extract')}ms)`);
    
    if (claims.length === 0) {
      console.error(`❌ ERROR: No claims extracted!`);
    }

    // 2) CRITICAL: Generate transcript sources for grounding
    timer.start('source_gen');
    let sources: Source[] = [...(externalSources || [])];
    let transcriptSourcesCount = 0;
    
    const isCallTranscript = !answer || answer.trim().length === 0;
    if (isCallTranscript && question.trim().length > 0) {
      const transcriptSources = generateSourcesFromRawTranscript(question, conversationId);
      sources = [...sources, ...transcriptSources];
      transcriptSourcesCount = transcriptSources.length;
    } else if (sources.length === 0 && answer && answer.trim().length > 0) {
      const answerSources = generateSourcesFromRawTranscript(answer, conversationId);
      sources = [...sources, ...answerSources];
      transcriptSourcesCount = answerSources.length;
    }
    timer.end('source_gen');
    timer.set('num_sources', sources.length);
    console.log(`📝 Sources generated: ${sources.length} (${timer.duration('source_gen')}ms)`);

    // 3) Retrieve evidence for each claim BEFORE NLI (MANDATORY)
    timer.start('retrieval');
    const evidencePerClaim = retrieveEvidenceForClaims(claims, sources, retrievalK);
    
    let totalEvidenceHits = 0;
    for (const [, hits] of evidencePerClaim) {
      totalEvidenceHits += hits.length;
    }
    timer.end('retrieval');
    timer.set('num_evidence_chunks', totalEvidenceHits);
    console.log(`🔍 Evidence retrieved: ${totalEvidenceHits} hits (${timer.duration('retrieval')}ms)`);

    // 4) grounding (legacy MVP evidence check)
    const evidenceRes = attachEvidenceAndFindViolations(claims, sources);

    // 3) logic (legacy MVP contradiction check)
    const logicRes = findLogicViolations(evidenceRes.claims);

    // 4) production graph build
    // Scorer priority:
    //   1. Spectral NLI (if TCL_SPECTRAL_URL configured - uses Python transformers, no native deps)
    //   2. Custom NLI endpoint (if TCL_NLI_ENDPOINT configured)
    //   3. Mistral API (if MISTRAL_API_KEY configured)
    //   4. Local Transformers (may fail in containers)
    //   5. TokenHeuristicScorer (fallback)
    
    timer.start('scorer_init');
    const spectralUrl = options?.spectralServiceUrl || process.env.TCL_SPECTRAL_URL || "";
    const nliEndpoint = options?.nliEndpoint || process.env.TCL_NLI_ENDPOINT || "";
    const nliApiKey = options?.nliApiKey || process.env.TCL_NLI_API_KEY;
    const nliModelId = options?.nliModelId || process.env.TCL_NLI_MODEL_ID || "nli-default";
    const mistralApiKey = options?.mistralApiKey || process.env.MISTRAL_API_KEY;
    const mistralModel = options?.mistralModel || process.env.MISTRAL_MODEL;
    const useLocalNli = options?.useLocalNli ?? (process.env.TCL_USE_LOCAL_NLI === "true");
    
    let scorer;
    
    // OPTIMIZATION: Cache scorer to avoid re-testing on every request
    if (cachedScorer && cachedScorer.url === spectralUrl && (Date.now() - cachedScorer.timestamp) < SCORER_CACHE_TTL) {
      scorer = cachedScorer.scorer;
      console.log(`⚡ Using cached scorer: ${scorer.id} (cache hit)`);
    } else if (spectralUrl && !nliEndpoint) {
      // Priority 1: Spectral NLI (Python service)
      try {
        const spectralScorer = new SpectralNliScorer({ endpoint: spectralUrl });
        
        // Quick test - only once per cache period
        console.log(`🔌 Testing Spectral NLI connection...`);
        const testScore = await spectralScorer.entailment(
          "The sky is blue.",
          "The sky has a blue color."
        );
        
        if (testScore > 0.3) {
          scorer = spectralScorer;
          cachedScorer = { scorer, url: spectralUrl, timestamp: Date.now() };
          console.log(`✅ Scorer: ${scorer.id} (test: ${testScore.toFixed(3)})`);
        } else {
          throw new Error(`Test score too low: ${testScore}`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Spectral NLI failed: ${error.message}`);
      }
    }
    
    if (!scorer && nliEndpoint) {
      scorer = new HttpNliScorer({ endpoint: nliEndpoint, apiKey: nliApiKey, modelId: nliModelId });
    }
    
    if (!scorer && mistralApiKey) {
      const { MistralNliScorer } = await import("./graph/edge_builder.js");
      scorer = new MistralNliScorer({ apiKey: mistralApiKey, model: mistralModel });
    }
    
    if (!scorer && useLocalNli) {
      try {
        const transformersScorer = new TransformersNliScorer({});
        const testScore = await transformersScorer.entailment("The sky is blue.", "The sky has color.");
        if (testScore >= 0) scorer = transformersScorer;
      } catch (error: any) {
        console.warn(`⚠️ Local NLI failed: ${error.message}`);
      }
    }
    
    if (!scorer) {
      scorer = new TokenHeuristicScorer();
      console.log(`⚠️ Using fallback scorer: ${scorer.id}`);
    }
    timer.end('scorer_init');
    console.log(`🔧 Scorer init: ${timer.duration('scorer_init')}ms`);

    // Determine threshold values BEFORE graph building (hoisted for use in manifest)
    // These need to be accessible throughout the function
    const hasConversationalPatterns = question.includes('Agent:') || question.includes('Customer:') || 
                                     question.includes('Agent:') || question.includes('Customer:') ||
                                     (question.split('?').length > 3);
    
    const isHeuristic = scorer.id === "token-heuristic-v1" || scorer.id === "token-heuristic";
    const isLocalTransformers = scorer.id.includes("transformers");
    const isSpectralNli = scorer.id.includes("spectral-nli");
    const isRealNli = isLocalTransformers || isSpectralNli; // Real NLI model
    const transcriptMultiplier = (isCallTranscript || hasConversationalPatterns) ? 0.85 : 1.0;
    
    let defaultSupportThreshold: number;
    let defaultContradictionThreshold: number;
    let defaultGroundingThreshold: number;
    
    if (isHeuristic) {
      // Heuristic scorer - lower thresholds since it's not as accurate
      defaultSupportThreshold = 0.30 * transcriptMultiplier;
      defaultContradictionThreshold = 0.40 * transcriptMultiplier;
      defaultGroundingThreshold = 0.30 * transcriptMultiplier;
    } else if (isRealNli) {
      // Real NLI model (local transformers or spectral service) - use optimal thresholds
      // Lower for conversational text which has more noise
      defaultSupportThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.25 : 0.35;
      defaultContradictionThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.35 : 0.45;
      defaultGroundingThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.25 : 0.35;
      console.log(`🔬 Using real NLI scorer: ${scorer.id} with optimized thresholds`);
    } else {
      // Unknown scorer - use moderate thresholds
      defaultSupportThreshold = 0.45 * transcriptMultiplier;
      defaultContradictionThreshold = 0.55 * transcriptMultiplier;
      defaultGroundingThreshold = 0.45 * transcriptMultiplier;
    }

    // OPTIMIZATION: Limit candidate pairs using top-K instead of all-vs-all
    // For N claims and M sources:
    //   - Old: N*M grounding pairs + N*(N-1)/2 claim pairs = O(N*M + N²)
    //   - New: N*K grounding pairs + N*K claim pairs = O(N*K) where K << M
    // 
    // FIX: The old MAX_CLAIM_PAIRS=100 was WAY too low for N=62 claims.
    // This caused 0 support edges because almost no pairs got scored.
    // New approach: per-claim budget, not global cap.
    const MAX_GROUNDING_PAIRS_PER_CLAIM = 15; // Ground against top 15 sources per claim
    const PAIRS_PER_CLAIM = 10; // Score top 10 claim pairs per claim
    const numClaims = evidenceRes.claims.length;
    // Total pairs = N * PAIRS_PER_CLAIM, capped at N*(N-1)/2 (all pairs)
    const maxPossiblePairs = numClaims > 1 ? (numClaims * (numClaims - 1)) / 2 : 0;
    const MAX_CLAIM_PAIRS = Math.min(numClaims * PAIRS_PER_CLAIM, maxPossiblePairs, 5000); // Cap at 5000 for very large transcripts
    
    let graph;
    timer.start('graph_build');
    timer.start('nli_total');
    try {
      console.log(`🔨 Building claim graph: ${evidenceRes.claims.length} claims, ${sources?.length || 0} sources`);
      console.log(`   Thresholds: sup=${(options?.supportThreshold ?? defaultSupportThreshold).toFixed(2)}, con=${(options?.contradictionThreshold ?? defaultContradictionThreshold).toFixed(2)}, gnd=${(options?.groundingThreshold ?? defaultGroundingThreshold).toFixed(2)}`);
      
      graph = await buildClaimGraph(evidenceRes.claims, sources, {
        scorer,
        supportThreshold: options?.supportThreshold ?? defaultSupportThreshold,
        contradictionThreshold: options?.contradictionThreshold ?? defaultContradictionThreshold,
        groundingThreshold: options?.groundingThreshold ?? defaultGroundingThreshold,
        maxPairwiseEdges: options?.maxPairwiseEdges ?? MAX_CLAIM_PAIRS,
        batchSize: options?.batchSize ?? 256, // Large batches = fewer HTTP calls
        ann: {
          index: "bruteforce",
          neighborK: options?.annNeighborK ?? options?.neighborK ?? Math.min(MAX_GROUNDING_PAIRS_PER_CLAIM, evidenceRes.claims.length - 1)
        },
        cache: {
          enabled: options?.cache ?? false,
          persistPath: options?.cachePersistPath
        },
        // Pass timer for NLI tracking
        timer
      });
      
      timer.end('nli_total');
      timer.end('graph_build');
      timer.set('edges_support', graph.supports.length);
      timer.set('edges_contra', graph.contradictions.length);
      timer.set('edges_ground', graph.grounding.length);
      
      console.log(`📊 Graph: ${graph.supports.length} sup, ${graph.contradictions.length} con, ${graph.grounding.length} gnd (${timer.duration('graph_build')}ms)`);
      
    } catch (error: any) {
      console.error("Error building claim graph:", error);
      timer.end('nli_total');
      timer.end('graph_build');
      graph = { supports: [], contradictions: [], grounding: [], groundedClaimIds: [] };
    }

    // 4.5) Custom rule validation (domain-specific rules)
    const customRuleViolations = options?.customRules 
      ? validateCustomRules(evidenceRes.claims, input, options.customRules)
      : [];
    
    // Create canonical contradiction list (unified representation)
    // Merge graph contradictions (NLI-based, weighted) and logic contradictions (rule-based, weight=1.0)
    const canonicalContradictions: Array<{ claimA: string; claimB: string; weight: number; source: 'nli' | 'rule' | 'heuristic' }> = [];
    
    // Add graph contradictions (NLI-based)
    for (const cont of graph.contradictions) {
      canonicalContradictions.push({
        claimA: cont.claimA,
        claimB: cont.claimB,
        weight: cont.weight,
        source: 'nli'
      });
    }
    
    // Add logic contradictions (rule-based, weight=1.0)
    for (const cont of logicRes.contradictions) {
      canonicalContradictions.push({
        claimA: cont.claimA,
        claimB: cont.claimB,
        weight: 1.0,
        source: 'rule'
      });
    }
    
    // Dedupe contradictions (keep highest weight)
    const contradictionMap = new Map<string, { claimA: string; claimB: string; weight: number; source: string }>();
    for (const cont of canonicalContradictions) {
      const key1 = `${cont.claimA}::${cont.claimB}`;
      const key2 = `${cont.claimB}::${cont.claimA}`;
      const existing = contradictionMap.get(key1) || contradictionMap.get(key2);
      if (!existing || cont.weight > existing.weight) {
        contradictionMap.delete(key1);
        contradictionMap.delete(key2);
        contradictionMap.set(key1, cont);
      }
    }
    
    const uniqueContradictions = Array.from(contradictionMap.values());
    
    // Calculate consistency score using weighted sum (not just count)
    const contradictionWeight = uniqueContradictions.reduce((sum, c) => sum + c.weight, 0);
    const base = 100;
    const penalty = Math.min(100, contradictionWeight * 20); // 20 points per unit weight (was 25 per count)
    const consistencyScore = Math.max(0, base - penalty);
    
    console.log(`Consistency: ${uniqueContradictions.length} unique contradictions (weight=${contradictionWeight.toFixed(2)}, ${logicRes.contradictions.length} from logic, ${graph.contradictions.length} from graph), score: ${consistencyScore}`);

    // 5) spectral - WITH GRAPH HEALTH GATING
    let spectral: (SpectralReport & { spectralSkipped?: boolean; debugReason?: string; graphHealthDiagnostic?: any }) | undefined;
    let coherenceScore: number | null = null;
    const envSpectralUrl = process.env.TCL_SPECTRAL_URL || "";
    const urlToUse = spectralServiceUrl || envSpectralUrl;
    
    // Calculate graph health metrics
    const supportEdgeCount = graph.supports.length;
    const contradictionEdgeCount = uniqueContradictions.length;
    const groundingEdgeCount = graph.grounding.length;
    const totalEdges = supportEdgeCount + contradictionEdgeCount + groundingEdgeCount;
    
    // Graph health diagnostic
    const graphHealthDiagnostic = {
      supportEdges: supportEdgeCount,
      contradictionEdges: contradictionEdgeCount,
      groundingEdges: groundingEdgeCount,
      totalEdges,
      claimsCount: evidenceRes.claims.length,
      sourcesCount: sources.length,
      transcriptSourcesGenerated: transcriptSourcesCount,
      retrievalK,
      nliModelId: scorer.id,
      thresholds: {
        support: options?.supportThreshold ?? defaultSupportThreshold,
        contradiction: options?.contradictionThreshold ?? defaultContradictionThreshold,
        grounding: options?.groundingThreshold ?? defaultGroundingThreshold
      }
    };
    
    // Debug logging
    console.log(`📊 Graph Health Check:`);
    console.log(`  - Claims: ${evidenceRes.claims.length}`);
    console.log(`  - Sources: ${sources.length} (${transcriptSourcesCount} from transcript)`);
    console.log(`  - Edges: ${totalEdges} total (support=${supportEdgeCount}, contradiction=${contradictionEdgeCount}, grounding=${groundingEdgeCount})`);
    console.log(`  - NLI Model: ${scorer.id}`);
    console.log(`  - Thresholds: support=${graphHealthDiagnostic.thresholds.support.toFixed(2)}, contradiction=${graphHealthDiagnostic.thresholds.contradiction.toFixed(2)}, grounding=${graphHealthDiagnostic.thresholds.grounding.toFixed(2)}`);
    
    // CRITICAL: Gate spectral on graph health
    // Spectral on an empty graph produces mathematically valid but semantically meaningless results
    const graphIsHealthy = totalEdges > 0 || groundingEdgeCount > 0;
    
    if (spectralEnabled) {
      if (!urlToUse) {
        console.warn("⚠️ Spectral enabled but no spectralServiceUrl/TCL_SPECTRAL_URL configured. Skipping Spectral analysis.");
        console.warn("Please set TCL_SPECTRAL_URL environment variable in Railway.");
        spectral = {
          spectralSkipped: true,
          debugReason: "no_spectral_url_configured",
          graphHealthDiagnostic
        } as any;
        coherenceScore = null;
      } else if (evidenceRes.claims.length === 0) {
        console.warn("⚠️ Spectral enabled but no claims to analyze. Skipping Spectral analysis.");
        spectral = {
          spectralSkipped: true,
          debugReason: "no_claims_for_spectral",
          graphHealthDiagnostic
        } as any;
        coherenceScore = null;
      } else {
        // ALWAYS run spectral - but surface diagnostics if graph is empty
        // Empty graphs will still produce results (identifying ungrounded claims)
        if (totalEdges === 0) {
          console.warn("⚠️ DIAGNOSTIC: Graph has ZERO edges - spectral will run but results may be limited.");
          console.warn("   This is NOT a silent failure - investigate root cause:");
          console.warn(`   - NLI Model: ${scorer.id}`);
          console.warn(`   - Claims: ${evidenceRes.claims.length}`);
          console.warn(`   - Sources: ${sources.length} (${transcriptSourcesCount} from transcript)`);
          console.warn(`   - Thresholds: support=${graphHealthDiagnostic.thresholds.support.toFixed(2)}, contradiction=${graphHealthDiagnostic.thresholds.contradiction.toFixed(2)}`);
          console.warn(`   - Possible causes:`);
          console.warn(`     1. NLI label mapping failure (check LABEL_0/1/2 → ENTAILMENT/etc)`);
          console.warn(`     2. Thresholds too high for this content`);
          console.warn(`     3. No transcript sources generated`);
          console.warn(`     4. Claims too dissimilar`);
        }
        
        // If no grounding detected, synthetically ground agent claims
        // This gives spectral a starting point for truth flow
        let groundedForSpectral = [...graph.groundedClaimIds];
        if (groundedForSpectral.length === 0) {
          // Ground claims from the agent (they have some authority)
          const agentClaims = evidenceRes.claims
            .filter((c: any) => c.meta?.speaker === 'Agent' || c.meta?.speaker === 'AGENT')
            .slice(0, 3) // Limit to first 3 agent claims
            .map((c: any) => c.id);
          
          if (agentClaims.length > 0) {
            groundedForSpectral = agentClaims;
            console.log(`📌 No grounding detected, synthetically grounding ${agentClaims.length} agent claims: ${agentClaims.join(', ')}`);
          } else {
            // If no agent claims, ground the first claim as a baseline
            if (evidenceRes.claims.length > 0) {
              groundedForSpectral = [evidenceRes.claims[0].id];
              console.log(`📌 No grounding detected, synthetically grounding first claim: ${evidenceRes.claims[0].id}`);
            }
          }
        }
        
        try {
          timer.start('spectral');
          console.log(`📡 Calling Spectral: ${urlToUse}/spectral/analyze`);
          
          spectral = await callSpectralAnalyzeService(
            urlToUse,
            evidenceRes.claims.map((c) => ({ id: c.id, text: c.text })),
            graph.supports,
            uniqueContradictions.map(c => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight })),
            groundedForSpectral,
            {}
          );
          timer.end('spectral');
          coherenceScore = spectral.coherenceScore;
          console.log(`✅ Spectral: coherence=${coherenceScore}, truthVector=${spectral.truthVector?.length || 0} (${timer.duration('spectral')}ms)`);
        } catch (error: any) {
          timer.end('spectral');
          console.error("❌ Spectral error:", error?.message);
          spectral = { spectralSkipped: true, debugReason: `spectral_error: ${error?.message}` } as any;
          coherenceScore = null;
        }
      }
    } else {
      console.log("Spectral disabled in options");
    }

    // 6) scores - compute truth score incorporating contradictions
    // FIX: Use graph-based truth score that incorporates contradictions
    let truthScore: number | null = null;
    try {
      const engineConfig = getEngineConfig();
      const mode = sources && sources.length > 0 ? 'with_external_docs' : 'transcript_only';
      const graphBasedTruth = computeTruthFromGraph(
        evidenceRes.claims,
        uniqueContradictions,
        graph.supports,
        graph.grounding,
        mode
      );
      
      // Use graph-based truth score (incorporates contradictions)
      if (graphBasedTruth.truth !== undefined && !isNaN(graphBasedTruth.truth)) {
        truthScore = graphBasedTruth.truth;
      }
    } catch (error) {
      console.warn('Error computing graph-based truth score, falling back:', error);
    }
    
    // Fallback to evidenceRes.truthScore if graph-based computation failed
    if (truthScore === null && evidenceRes.truthScore !== undefined) {
      truthScore = Math.max(0, Math.min(100, Math.round(evidenceRes.truthScore)));
    }
    const pairsScored = graph.debug?.pairsScored || 0;
    const finalConsistencyScore = pairsScored > 0 && consistencyScore !== undefined
      ? Math.max(0, Math.min(100, Math.round(consistencyScore)))
      : null; // null if no pairs scored (unknown)
    const finalCoherenceScore = coherenceScore !== null 
      ? Math.max(0, Math.min(100, Math.round(coherenceScore)))
      : null; // null if Spectral skipped or failed
    const overall = blendScores(
      truthScore ?? null, 
      finalConsistencyScore ?? null, 
      finalCoherenceScore
    );
    // Assess run quality with detailed reasons (replaces simple boolean refusal)
    const runQuality = assessRunQuality(
      overall, 
      truthScore ?? null, 
      finalConsistencyScore ?? null,
      {
        supportsCount: graph.supports.length,
        contradictionsCount: uniqueContradictions.length,
        groundingCount: graph.grounding.length,
        claimsCount: evidenceRes.claims.length
      },
      options?.thresholds
    );
    const refusal = runQuality.refusal; // Legacy compatibility
    
    console.log(`Final scores: truth=${truthScore}, consistency=${finalConsistencyScore}, coherence=${finalCoherenceScore}, overall=${overall}`);
    console.log(`Run quality: status=${runQuality.status}, reasons=${runQuality.degradedReasons.join(', ') || 'none'}`);

    // Calculate latency
    const latency = Date.now() - validationStartTime;
    
    // Get cache hit rate from graph
    const cacheHitRate = graph.cacheStats?.hitRate;

    // Get engine version (from package.json or git)
    const engineVersion = process.env.TCL_ENGINE_VERSION || process.env.GIT_COMMIT || 'v0.2.0';

    // 7) Calculate confidence metrics for claims (if enabled)
    let claimsWithConfidence = evidenceRes.claims;
    if (options?.includeConfidenceMetrics !== false) { // Default: true
      const confidenceMetrics = calculateAllClaimConfidences(
        evidenceRes.claims,
        graph.supports,
        uniqueContradictions.map(c => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight })),
        graph.grounding
      );
      
      claimsWithConfidence = evidenceRes.claims.map(claim => {
        const metrics = confidenceMetrics.get(claim.id);
        return {
          ...claim,
          confidenceMetrics: metrics || undefined // Only include if computed, no fallback
        };
      });
    }

    // 8) Compute destructive claims (ranked by importance)
    const destructiveClaims = computeDestructiveClaims({
      claims: claimsWithConfidence,
      contradictions: uniqueContradictions.map(c => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight })),
      grounding: graph.grounding,
      customRuleViolations: [...evidenceRes.violations, ...logicRes.violations, ...customRuleViolations].filter(
        v => v.type === "CUSTOM_RULE"
      ),
      spectral: spectral ? {
        truthVector: spectral.truthVector,
        truthStates: spectral.truthStates,
        nodeBlameNorm: spectral.nodeBlameNorm
      } : undefined
    });

    // Build importance map for suggestions
    const importanceByClaimId = new Map<string, number>();
    destructiveClaims.forEach(dc => {
      importanceByClaimId.set(dc.claimId, dc.importance);
    });

    // 9) Generate suggestions (if enabled)
    // Use canonical contradictions for suggestions
    const allContradictionsForSuggestions = uniqueContradictions.map(c => ({
      claimA: c.claimA,
      claimB: c.claimB,
      reason: `Contradiction detected (${c.source}, weight=${c.weight.toFixed(2)})`
    }));
    
    const suggestions = (options?.includeSuggestions !== false) // Default: true
      ? generateSuggestions(
          claimsWithConfidence,
          [...evidenceRes.violations, ...logicRes.violations, ...customRuleViolations],
          allContradictionsForSuggestions,
          evidenceRes.missing,
          graph.supports,
          options?.customRules,
          importanceByClaimId,
          graph.grounding
        )
      : undefined;

    // 10) Compute trajectory (if enabled and transcript detected)
    const trajectory = options?.trajectory && (!answer || answer.trim().length === 0) && 
                       (question.includes("Agent:") || question.includes("Customer:"))
      ? await computeTrajectory(
          input,
          validateOnce, // Pass the function itself
          adapter,
          {
            windowTurns: options?.trajectoryWindowTurns ?? 3,
            maxSegments: options?.maxTrajectorySegments ?? 20
          }
        )
      : undefined;

    // Generate reproducibility metadata
    const transcriptForRepro = answer || question;
    const reproMetadata = generateReproducibilityMetadata(transcriptForRepro);
    
    // Build run manifest for audit
    const runManifest: RunManifest = {
      inputHash: reproMetadata.inputHash,
      configHash: reproMetadata.configHash,
      artifactId,
      claimExtractorVersion: "v1.0.0", // TODO: Extract from package.json
      nliModelId: scorer.id,
      nliThresholds: {
        support: options?.supportThreshold ?? defaultSupportThreshold,
        contradiction: options?.contradictionThreshold ?? defaultContradictionThreshold,
        grounding: options?.groundingThreshold ?? defaultGroundingThreshold
      },
      embeddingModel: "simple-ngram-v1", // Our built-in embedding
      retrievalK,
      spectralEngineVersion: spectralEnabled && spectral && !spectral.spectralSkipped ? "v1.0.0" : undefined,
      codeVersion: reproMetadata.codeVersion,
      engineVersion: reproMetadata.engineVersion,
      modelFingerprint: reproMetadata.modelFingerprint,
      createdAt: new Date().toISOString(),
      transcriptSourcesCount,
      graphHealth: {
        supportEdges: supportEdgeCount,
        contradictionEdges: contradictionEdgeCount,
        groundingEdges: groundingEdgeCount,
        totalEdges,
        healthy: graphIsHealthy,
        reason: !graphIsHealthy ? "zero_edges" : undefined
      }
    };

    // Log performance summary
    timer.set('num_issues', destructiveClaims?.length || 0);
    timer.logSummary();
    
    const result = {
      answer,
      refusal, // Legacy boolean (deprecated)
      runQuality: {
        status: runQuality.status,
        degradedReasons: runQuality.degradedReasons
      },
      scores: { truth: truthScore, consistency: finalConsistencyScore, coherence: finalCoherenceScore, overall },
      scorerId: scorer.id,
      latency,
      cacheHitRate,
      engineVersion,
      // Include performance metrics in response for debugging
      performanceMs: {
        total: timer.total(),
        claimExtract: timer.duration('claim_extract'),
        graphBuild: timer.duration('graph_build'),
        nliTotal: timer.duration('nli_total'),
        spectral: timer.duration('spectral'),
        nliCalls: timer.get('num_nli_calls'),
        nliPairs: timer.get('num_nli_pairs')
      },
      report: {
        claims: claimsWithConfidence,
        violations: [...evidenceRes.violations, ...logicRes.violations, ...customRuleViolations],
        missingEvidence: evidenceRes.missing,
        contradictions: allContradictionsForSuggestions,
        spectral,
        graph: {
          supports: graph.supports,
          contradictions: graph.contradictions,
          grounding: graph.grounding,
          debug: graph.debug ? { 
            ...graph.debug, 
            spectralEnabled: spectralEnabled,
            numSources: sources.length,
            transcriptSourcesGenerated: transcriptSourcesCount
          } : undefined
        },
        suggestions,
        destructiveClaims: destructiveClaims.length > 0 ? destructiveClaims : undefined,
        trajectory,
        manifest: runManifest
      }
    };
    
    return result;
  } catch (error: any) {
    console.error("validateOnce error:", error);
    throw error;
  }
}

export async function validate(input: ValidateInput): Promise<ValidateOutput> {
  const startTime = Date.now();
  try {
    const adapter = input.options?.llmAdapter;

    const first = await validateOnce(input, adapter, startTime);

    const repairEnabled = !!input.options?.repair && !!adapter;
    const hasSources = !!input.sources?.length;
    const requireCitations = input.options?.requireCitations ?? hasSources;

    const failingClaimIds = collectFailingClaimIds(first.report);

    const needsRepair =
      repairEnabled &&
      failingClaimIds.length > 0 &&
      (first.refusal || (first.scores.truth !== null && first.scores.truth < (input.options?.thresholds?.truth ?? 60)));

    if (!needsRepair) return first;

    const repaired = await repairOnce({
      adapter: adapter!,
      question: input.question,
      originalAnswer: input.answer,
      claims: first.report.claims,
      sources: input.sources,
      failingClaimIds,
      requireCitations
    });

    const second = await validateOnce(
      { ...input, answer: repaired.repairedAnswer, options: { ...input.options, repair: false } },
      adapter,
      startTime
    );

    return second;
  } catch (error: any) {
    console.error("Validate function error:", error);
    throw error;
  }
}