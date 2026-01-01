import { ValidateInput, ValidateOutput, SpectralReport, Source, RunManifest } from "./types.js";
import { extractClaims } from "./claim_extractor.js";
import { attachEvidenceAndFindViolations } from "./evidence.js";
import { findLogicViolations } from "./logic.js";
import { blendScores, shouldRefuse } from "./scoring.js";
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

/**
 * Generate input hash for reproducibility
 */
function generateInputHash(question: string, answer: string): string {
  const input = `${question}|||${answer}`;
  return createHash("sha256").update(input).digest("hex").substring(0, 16);
}

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
  const validationStartTime = startTime ?? Date.now();
  try {
    const { question, answer, sources: externalSources, options } = input;
    // Spectral is the CORE VALUE of the app - enabled by default
    // Only disable if explicitly set to false
    const spectralEnabled = options?.spectral !== false;
    const spectralServiceUrl = options?.spectralServiceUrl ?? process.env.TCL_SPECTRAL_URL ?? "";
    
    // Configuration for this run
    const retrievalK = options?.annNeighborK ?? 8; // Top-k chunks per claim for NLI
    const conversationId = (options as any)?.conversationId ?? "inline";
    const artifactId = (options as any)?.artifactId;

    // 1) claims
    let claims = [];
    if (adapter) {
      const art = await adapter.extractArtifacts({ question, answer, sources: externalSources });
      claims = art.claims;
      console.log(`📋 Extracted ${claims.length} claims using adapter`);
    } else {
      // For call center QA: if answer is empty, extract claims from question (transcript)
      // For original QA: extract claims from answer
      const textToExtract = answer && answer.trim().length > 0 ? answer : question;
      console.log(`📋 Extracting claims from ${answer && answer.trim().length > 0 ? 'answer' : 'question (transcript)'}, length=${textToExtract.length}`);
      claims = extractClaims(textToExtract);
      console.log(`📋 Extracted ${claims.length} claims`);
    }
    
    if (claims.length === 0) {
      console.error(`❌ ERROR: No claims extracted! This will cause an empty graph.`);
      console.error(`  Question length: ${question.length}`);
      console.error(`  Answer length: ${answer?.length || 0}`);
    }

    // 2) CRITICAL: Generate transcript sources for grounding
    // This is REQUIRED even if no external sources are provided
    let sources: Source[] = [...(externalSources || [])];
    let transcriptSourcesCount = 0;
    
    const isCallTranscript = !answer || answer.trim().length === 0;
    if (isCallTranscript && question.trim().length > 0) {
      // Generate sources from transcript text
      const transcriptSources = generateSourcesFromRawTranscript(question, conversationId);
      sources = [...sources, ...transcriptSources];
      transcriptSourcesCount = transcriptSources.length;
      console.log(`📝 Generated ${transcriptSourcesCount} transcript evidence sources for grounding`);
      
      if (transcriptSourcesCount === 0) {
        console.warn(`⚠️ No transcript sources generated - grounding will fail!`);
      }
    } else if (sources.length === 0 && answer && answer.trim().length > 0) {
      // For Q&A mode with answer text, generate sources from answer
      const answerSources = generateSourcesFromRawTranscript(answer, conversationId);
      sources = [...sources, ...answerSources];
      transcriptSourcesCount = answerSources.length;
      console.log(`📝 Generated ${transcriptSourcesCount} answer evidence sources`);
    }

    // 3) Retrieve evidence for each claim BEFORE NLI (MANDATORY)
    // This ensures NLI is run on (claim, relevant_chunk) pairs, not in a vacuum
    const evidencePerClaim = retrieveEvidenceForClaims(claims, sources, retrievalK);
    
    let totalEvidenceHits = 0;
    for (const [, hits] of evidencePerClaim) {
      totalEvidenceHits += hits.length;
    }
    console.log(`🔍 Retrieved ${totalEvidenceHits} evidence hits for ${claims.length} claims (k=${retrievalK})`);
    
    if (totalEvidenceHits === 0 && claims.length > 0 && sources.length > 0) {
      console.error(`❌ CRITICAL: No evidence retrieved despite having ${sources.length} sources!`);
      console.error(`   This will cause zero grounding edges.`);
    }

    // 4) grounding (legacy MVP evidence check - enhanced with retrieved evidence)
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
    
    const spectralUrl = options?.spectralServiceUrl || process.env.TCL_SPECTRAL_URL || "";
    const nliEndpoint = options?.nliEndpoint || process.env.TCL_NLI_ENDPOINT || "";
    const nliApiKey = options?.nliApiKey || process.env.TCL_NLI_API_KEY;
    const nliModelId = options?.nliModelId || process.env.TCL_NLI_MODEL_ID || "nli-default";
    const mistralApiKey = options?.mistralApiKey || process.env.MISTRAL_API_KEY;
    const mistralModel = options?.mistralModel || process.env.MISTRAL_MODEL;
    const useLocalNli = options?.useLocalNli ?? (process.env.TCL_USE_LOCAL_NLI === "true"); // Default: false (prefer spectral)
    
    let scorer;
    
    if (spectralUrl && !nliEndpoint) {
      // Priority 1: Spectral NLI (Python service with transformers - works in any container)
      // This is the RECOMMENDED approach as it avoids native onnxruntime issues
      try {
        const spectralScorer = new SpectralNliScorer({ endpoint: spectralUrl });
        
        // Test the connection
        console.log(`🔌 Testing Spectral NLI connection...`);
        const testScore = await spectralScorer.entailment(
          "The sky is blue.",
          "The sky has a blue color."
        );
        
        if (testScore >= 0) {
          scorer = spectralScorer;
          console.log(`✅ Using scorer: ${scorer.id} (Spectral Python service, test score: ${testScore.toFixed(3)})`);
        } else {
          throw new Error(`Test score invalid: ${testScore}`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Spectral NLI failed: ${error.message}`);
        console.warn(`   Falling back to next scorer option...`);
      }
    }
    
    if (!scorer && nliEndpoint) {
      // Priority 2: Custom NLI endpoint (most flexible - user's own NLI)
      scorer = new HttpNliScorer({ 
        endpoint: nliEndpoint, 
        apiKey: nliApiKey,
        modelId: nliModelId
      });
      console.log(`Using scorer: ${scorer.id} (custom NLI endpoint: ${nliEndpoint})`);
    }
    
    if (!scorer && mistralApiKey) {
      // Priority 3: Built-in Mistral API (easy upgrade, no deployment needed)
      const { MistralNliScorer } = await import("./graph/edge_builder.js");
      scorer = new MistralNliScorer({
        apiKey: mistralApiKey,
        model: mistralModel
      });
      console.log(`Using scorer: ${scorer.id} (Mistral API - auto-enabled)`);
    }
    
    if (!scorer && useLocalNli) {
      // Priority 4: Local Transformers model (downloads on first run, no API keys)
      // May fail in containers without native onnxruntime libraries
      try {
        const localModelName = process.env.TCL_LOCAL_NLI_MODEL;
        const transformersScorer = new TransformersNliScorer(
          localModelName ? { modelName: localModelName } : {}
        );
        console.log(`Testing local NLI model: ${transformersScorer.id}...`);
        
        const testScore = await transformersScorer.entailment(
          "The sky is blue.",
          "The sky has color."
        );
        
        if (testScore >= 0) {
          scorer = transformersScorer;
          console.log(`✅ Using scorer: ${scorer.id} (local model verified, test score: ${testScore.toFixed(3)})`);
        } else {
          throw new Error(`Test score invalid: ${testScore}`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Local NLI model failed: ${error.message}`);
      }
    }
    
    if (!scorer) {
      // Priority 5: Fallback heuristic (always works, basic accuracy)
      scorer = new TokenHeuristicScorer();
      console.log(`⚠️ Using scorer: ${scorer.id} (fallback - basic accuracy)`);
      console.log(`💡 Tip: Configure TCL_SPECTRAL_URL to use Python-based NLI (recommended)`);
    }

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

    let graph;
    try {
      console.log("Building claim graph...");
      console.log(`Using scorer: ${scorer.id}, Claims: ${evidenceRes.claims.length}, Sources: ${sources?.length || 0}`);
      console.log(`Text type: ${isCallTranscript ? 'Call transcript' : 'Answer text'}, Conversational patterns: ${hasConversationalPatterns}`);
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
          enabled: options?.cache ?? false, // Default: disabled (enable in production for many calls)
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
          // ALWAYS use /spectral/analyze - this is the production endpoint
          // /spectral/score was the first iteration for testing only
          console.log(`📡 Calling Spectral service at: ${urlToUse}/spectral/analyze`);
          
          spectral = await callSpectralAnalyzeService(
            urlToUse,
            evidenceRes.claims.map((c) => ({ id: c.id, text: c.text })),
            graph.supports,
            uniqueContradictions.map(c => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight })),
            groundedForSpectral,
            {
              wSupport: undefined, // Use spectral service defaults
              wContradiction: undefined,
              wCircularity: undefined,
              cycleMaxLen: undefined
            }
          );
          coherenceScore = spectral.coherenceScore;
          console.log(`✅ Spectral ANALYZE complete. Coherence: ${coherenceScore}, truthVector: ${spectral.truthVector?.length || 0} values`);
        } catch (error: any) {
          console.error("❌ Spectral service error:", error);
          console.error("Error message:", error?.message);
          console.error("Error stack:", error?.stack);
          // Continue without Spectral - don't fail the entire validation
          spectral = {
            spectralSkipped: true,
            debugReason: `spectral_service_error: ${error?.message || 'unknown'}`
          } as any;
          coherenceScore = null;
        }
      }
    } else {
      console.log("Spectral disabled in options");
    }

    // 6) scores - ensure all scores are valid numbers in 0-100 range
    // Only compute from real data - no fallbacks
    const truthScore = evidenceRes.truthScore !== undefined 
      ? Math.max(0, Math.min(100, Math.round(evidenceRes.truthScore)))
      : null; // null if not computed
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
    const refusal = shouldRefuse(overall, truthScore ?? null, finalConsistencyScore ?? null, options?.thresholds);
    
    console.log(`Final scores: truth=${truthScore}, consistency=${finalConsistencyScore}, coherence=${finalCoherenceScore}, overall=${overall}, refusal=${refusal}`);

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

    // Build run manifest for audit
    const runManifest: RunManifest = {
      inputHash: generateInputHash(question, answer),
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
      codeVersion: engineVersion,
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

    return {
      answer,
      refusal,
      scores: { truth: truthScore, consistency: finalConsistencyScore, coherence: finalCoherenceScore, overall },
      scorerId: scorer.id, // Include scorer ID so UI can display it
      latency,
      cacheHitRate,
      engineVersion,
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
            numSources: sources.length, // Use actual sources count
            transcriptSourcesGenerated: transcriptSourcesCount
          } : undefined
        },
        suggestions,
        destructiveClaims: destructiveClaims.length > 0 ? destructiveClaims : undefined,
        trajectory,
        manifest: runManifest // AUDIT-CRITICAL: Include run manifest
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