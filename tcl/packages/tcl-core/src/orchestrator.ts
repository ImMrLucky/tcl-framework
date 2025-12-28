import { ValidateInput, ValidateOutput, SpectralReport } from "./types.js";
import { extractClaims } from "./claim_extractor.js";
import { attachEvidenceAndFindViolations } from "./evidence.js";
import { findLogicViolations } from "./logic.js";
import { blendScores, shouldRefuse } from "./scoring.js";
import { collectFailingClaimIds, repairOnce } from "./repair.js";
import type { LLMAdapter } from "./adapters/llm_adapter.js";
import { buildClaimGraph, HttpNliScorer, TokenHeuristicScorer } from "./graph/edge_builder.js";
import { TransformersNliScorer } from "./graph/transformers_scorer.js";

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

async function validateOnce(input: ValidateInput, adapter?: LLMAdapter, startTime?: number): Promise<ValidateOutput> {
  const validationStartTime = startTime ?? Date.now();
  try {
    const { question, answer, sources, options } = input;
    const spectralEnabled = !!options?.spectral;
    const spectralServiceUrl = options?.spectralServiceUrl ?? process.env.TCL_SPECTRAL_URL ?? "";

    // 1) claims
    let claims = [];
    if (adapter) {
      const art = await adapter.extractArtifacts({ question, answer, sources });
      claims = art.claims;
    } else {
      // For call center QA: if answer is empty, extract claims from question (transcript)
      // For original QA: extract claims from answer
      const textToExtract = answer && answer.trim().length > 0 ? answer : question;
      claims = extractClaims(textToExtract);
    }

    // 2) grounding (legacy MVP evidence check)
    const evidenceRes = attachEvidenceAndFindViolations(claims, sources);

    // 3) logic (legacy MVP contradiction check)
    const logicRes = findLogicViolations(evidenceRes.claims);

    // 4) production graph build
    // Scorer priority: Custom NLI endpoint > Mistral API > Local Transformers > TokenHeuristicScorer (default)
    const nliEndpoint = options?.nliEndpoint || process.env.TCL_NLI_ENDPOINT || "";
    const nliApiKey = options?.nliApiKey || process.env.TCL_NLI_API_KEY;
    const nliModelId = options?.nliModelId || process.env.TCL_NLI_MODEL_ID || "nli-default";
    const mistralApiKey = options?.mistralApiKey || process.env.MISTRAL_API_KEY;
    const mistralModel = options?.mistralModel || process.env.MISTRAL_MODEL;
    const useLocalNli = options?.useLocalNli ?? (process.env.TCL_USE_LOCAL_NLI !== "false"); // Default: true
    
    let scorer;
    if (nliEndpoint) {
      // Priority 1: Custom NLI endpoint (most flexible - user's own NLI)
      scorer = new HttpNliScorer({ 
        endpoint: nliEndpoint, 
        apiKey: nliApiKey,
        modelId: nliModelId
      });
      console.log(`Using scorer: ${scorer.id} (custom NLI endpoint: ${nliEndpoint})`);
    } else if (mistralApiKey) {
      // Priority 2: Built-in Mistral API (easy upgrade, no deployment needed)
      const { MistralNliScorer } = await import("./graph/edge_builder.js");
      scorer = new MistralNliScorer({
        apiKey: mistralApiKey,
        model: mistralModel
      });
      console.log(`Using scorer: ${scorer.id} (Mistral API - auto-enabled)`);
    } else if (useLocalNli) {
      // Priority 3: Local Transformers model (downloads on first run, no API keys)
      try {
        // Use deberta-v3-base by default (was working before)
        // Can override with TCL_LOCAL_NLI_MODEL env var
        const localModelName = process.env.TCL_LOCAL_NLI_MODEL;
        scorer = new TransformersNliScorer(
          localModelName ? { modelName: localModelName } : {} // If not set, TransformersNliScorer uses deberta-v3-base default
        );
        console.log(`Using scorer: ${scorer.id} (local model - downloads ~200MB on first run)`);
      } catch (error: any) {
        console.warn(`Failed to load local NLI model, falling back to heuristic:`, error.message);
        scorer = new TokenHeuristicScorer();
        console.log(`Using scorer: ${scorer.id} (fallback - basic accuracy)`);
      }
    } else {
      // Priority 4: Default heuristic (free, works out of box)
      scorer = new TokenHeuristicScorer();
      console.log(`Using scorer: ${scorer.id} (free, basic accuracy)`);
      console.log(`💡 Tip: Set TCL_USE_LOCAL_NLI=true to use local NLI model (downloads on first run)`);
    }

    let graph;
    try {
      console.log("Building claim graph...");
      console.log(`Using scorer: ${scorer.id}, Claims: ${evidenceRes.claims.length}, Sources: ${sources?.length || 0}`);
      
      // Detect if this is a call transcript (conversational text)
      // Call transcripts have multiple speakers, questions, and conversational patterns
      const isCallTranscript = !answer || answer.trim().length === 0;
      const hasConversationalPatterns = question.includes('Agent:') || question.includes('Customer:') || 
                                       question.includes('Agent:') || question.includes('Customer:') ||
                                       (question.split('?').length > 3); // Multiple questions suggest conversation
      
      console.log(`Text type: ${isCallTranscript ? 'Call transcript' : 'Answer text'}, Conversational patterns: ${hasConversationalPatterns}`);
      
      // Use appropriate thresholds based on scorer type
      // TokenHeuristicScorer: lower thresholds (less accurate)
      // TransformersNliScorer: medium thresholds (local model, decent accuracy)
      // HttpNliScorer/MistralNliScorer: higher thresholds (more accurate)
      const isHeuristic = scorer.id === "token-heuristic-v1" || scorer.id === "token-heuristic";
      const isLocalTransformers = scorer.id.includes("transformers");
      
      let defaultSupportThreshold: number;
      let defaultContradictionThreshold: number;
      let defaultGroundingThreshold: number;
      
      // For call transcripts, use lower thresholds because support relationships are more implicit
      const transcriptMultiplier = (isCallTranscript || hasConversationalPatterns) ? 0.85 : 1.0;
      
      if (isHeuristic) {
        // Token heuristic: very low thresholds
        defaultSupportThreshold = 0.40 * transcriptMultiplier;
        defaultContradictionThreshold = 0.50 * transcriptMultiplier;
        defaultGroundingThreshold = 0.40 * transcriptMultiplier;
      } else if (isLocalTransformers) {
        // Local Transformers model: medium thresholds (balance between accuracy and coverage)
        // Lower for transcripts because conversational support is harder to detect
        defaultSupportThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.35 : 0.45;
        defaultContradictionThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.45 : 0.55;
        defaultGroundingThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.35 : 0.45;
      } else {
        // HTTP NLI or Mistral API: higher thresholds (more accurate models)
        defaultSupportThreshold = 0.58 * transcriptMultiplier;
        defaultContradictionThreshold = 0.70 * transcriptMultiplier;
        defaultGroundingThreshold = 0.60 * transcriptMultiplier;
      }
      
      console.log(`Building graph with ${evidenceRes.claims.length} claims, scorer: ${scorer.id}`);
      console.log(`Thresholds: support=${options?.supportThreshold ?? defaultSupportThreshold}, contradiction=${options?.contradictionThreshold ?? defaultContradictionThreshold}, grounding=${options?.groundingThreshold ?? defaultGroundingThreshold}`);
      if (isCallTranscript || hasConversationalPatterns) {
        console.log(`📞 Call transcript detected - using lower thresholds for conversational text`);
        console.log(`   Support threshold lowered to: ${options?.supportThreshold ?? defaultSupportThreshold} (from 0.45)`);
      }
      
      graph = await buildClaimGraph(evidenceRes.claims, sources, {
        scorer,
        supportThreshold: options?.supportThreshold ?? defaultSupportThreshold,
        contradictionThreshold: options?.contradictionThreshold ?? defaultContradictionThreshold,
        groundingThreshold: options?.groundingThreshold ?? defaultGroundingThreshold,
        maxPairwiseEdges: options?.maxPairwiseEdges ?? 200, // Increased to find more edges
        batchSize: options?.batchSize ?? 32,
        ann: {
          index: "bruteforce", // Use brute force instead of HNSW to avoid dependency issues
          neighborK: options?.annNeighborK ?? options?.neighborK ?? Math.min(12, evidenceRes.claims.length - 1) // Don't exceed claim count
        },
        cache: {
          enabled: options?.cache ?? false, // Use user's cache option
          persistPath: options?.cachePersistPath
        }
      });
      
      console.log("Claim graph built successfully");
      console.log(`Graph stats: ${graph.supports.length} supports, ${graph.contradictions.length} contradictions, ${graph.grounding.length} grounding edges`);
      if (graph.supports.length === 0 && graph.contradictions.length === 0) {
        console.warn("⚠️ No edges found in graph. This might indicate:");
        console.warn("  - Thresholds are too high (try lowering support/contradiction thresholds)");
        console.warn("  - Scorer is not finding relationships (check scorer logs above for actual scores)");
        console.warn("  - Claims are too dissimilar");
        if (isCallTranscript || hasConversationalPatterns) {
          console.warn("  - 📞 Call transcript detected - conversational text may have implicit support relationships");
          console.warn("  - 💡 Try lowering support threshold to 0.30-0.35 for call transcripts");
        }
        console.warn(`  - Current thresholds: support=${options?.supportThreshold ?? defaultSupportThreshold}, contradiction=${options?.contradictionThreshold ?? defaultContradictionThreshold}`);
        console.warn(`  - Scorer: ${scorer.id}`);
        console.warn("  - Check logs above for '[TransformersNliScorer]' to see actual scores being returned");
      }
    } catch (error: any) {
      console.error("Error building claim graph:", error);
      console.error("Error stack:", error?.stack);
      // Fallback: return empty graph if build fails
      graph = {
        supports: [],
        contradictions: [],
        grounding: [],
        groundedClaimIds: []
      };
    }

    // merge hard contradictions found by rule layer into graph contradictions (weight=1)
    const hardContradictions = logicRes.contradictions.map((x) => ({ claimA: x.claimA, claimB: x.claimB, weight: 1.0 }));
    const contradictions = [...graph.contradictions, ...hardContradictions];

    // Calculate consistency score from ALL contradictions (both logic and graph-based)
    // Dedupe contradictions to avoid double-counting
    const contradictionSet = new Set<string>();
    let totalContradictions = 0;
    
    // Count unique contradiction pairs
    for (const cont of contradictions) {
      const key1 = `${cont.claimA}::${cont.claimB}`;
      const key2 = `${cont.claimB}::${cont.claimA}`;
      if (!contradictionSet.has(key1) && !contradictionSet.has(key2)) {
        contradictionSet.add(key1);
        totalContradictions++;
      }
    }
    
    // Calculate consistency score: 100 base, -25 per unique contradiction, min 0
    const base = 100;
    const penalty = Math.min(100, totalContradictions * 25);
    const consistencyScore = Math.max(0, base - penalty);
    
    console.log(`Consistency: ${totalContradictions} unique contradictions (${logicRes.contradictions.length} from logic, ${graph.contradictions.length} from graph), score: ${consistencyScore}`);

    // 5) spectral
    let spectral: SpectralReport | undefined;
    let coherenceScore = 50;
    const envSpectralUrl = process.env.TCL_SPECTRAL_URL || "";
    const urlToUse = spectralServiceUrl || envSpectralUrl;
    
    // Debug logging
    console.log(`Spectral check: enabled=${spectralEnabled}`);
    console.log(`  - URL from options: ${spectralServiceUrl || 'NOT SET'}`);
    console.log(`  - URL from env (TCL_SPECTRAL_URL): ${envSpectralUrl || 'NOT SET'}`);
    console.log(`  - Final URL to use: ${urlToUse || 'NOT SET'}`);
    if (envSpectralUrl) {
      console.log(`  - Environment variable TCL_SPECTRAL_URL is set to: ${envSpectralUrl.substring(0, 50)}...`);
    } else {
      console.log(`  - Environment variable TCL_SPECTRAL_URL is NOT set`);
      console.log(`  - Available env vars: ${Object.keys(process.env).filter(k => k.includes('SPECTRAL') || k.includes('TCL')).join(', ') || 'none'}`);
    }
    
    if (spectralEnabled) {
      if (!urlToUse) {
        console.warn("⚠️ Spectral enabled but no spectralServiceUrl/TCL_SPECTRAL_URL configured. Skipping Spectral analysis.");
        console.warn("Please set TCL_SPECTRAL_URL environment variable in Railway.");
      } else {
        try {
          console.log(`📡 Calling Spectral service at: ${urlToUse}`);
          spectral = await callSpectralService(
            urlToUse,
            evidenceRes.claims.map((c) => ({ id: c.id, text: c.text })),
            graph.supports,
            contradictions,
            graph.groundedClaimIds
          );
          coherenceScore = spectral.coherenceScore;
          console.log(`✅ Spectral analysis complete. Coherence score: ${coherenceScore}`);
        } catch (error: any) {
          console.error("❌ Spectral service error:", error);
          console.error("Error message:", error?.message);
          console.error("Error stack:", error?.stack);
          // Continue without Spectral - don't fail the entire validation
        }
      }
    } else {
      console.log("Spectral disabled in options");
    }

    // 6) scores - ensure all scores are valid numbers in 0-100 range
    const truthScore = Math.max(0, Math.min(100, Math.round(evidenceRes.truthScore || 0)));
    const finalConsistencyScore = Math.max(0, Math.min(100, Math.round(consistencyScore || 0)));
    const finalCoherenceScore = Math.max(0, Math.min(100, Math.round(coherenceScore || 50)));
    const overall = blendScores(truthScore, finalConsistencyScore, finalCoherenceScore);
    const refusal = shouldRefuse(overall, truthScore, finalConsistencyScore, options?.thresholds);
    
    console.log(`Final scores: truth=${truthScore}, consistency=${finalConsistencyScore}, coherence=${finalCoherenceScore}, overall=${overall}, refusal=${refusal}`);

    // Calculate latency
    const latency = Date.now() - validationStartTime;
    
    // Get cache hit rate from graph
    const cacheHitRate = graph.cacheStats?.hitRate;

    // Get engine version (from package.json or git)
    const engineVersion = process.env.TCL_ENGINE_VERSION || process.env.GIT_COMMIT || 'v0.2.0';

    return {
      answer,
      refusal,
      scores: { truth: truthScore, consistency: finalConsistencyScore, coherence: finalCoherenceScore, overall },
      scorerId: scorer.id, // Include scorer ID so UI can display it
      latency,
      cacheHitRate,
      engineVersion,
      report: {
        claims: evidenceRes.claims,
        violations: [...evidenceRes.violations, ...logicRes.violations],
        missingEvidence: evidenceRes.missing,
        contradictions: logicRes.contradictions.map((c) => ({ claimA: c.claimA, claimB: c.claimB, reason: c.reason })),
        spectral,
        graph: {
          supports: graph.supports,
          contradictions: graph.contradictions,
          grounding: graph.grounding
        }
      }
    };
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
      (first.refusal || first.scores.truth < (input.options?.thresholds?.truth ?? 60));

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