import { ValidateInput, ValidateOutput, SpectralReport } from "./types.js";
import { extractClaims } from "./claim_extractor.js";
import { attachEvidenceAndFindViolations } from "./evidence.js";
import { findLogicViolations } from "./logic.js";
import { blendScores, shouldRefuse } from "./scoring.js";
import { collectFailingClaimIds, repairOnce } from "./repair.js";
import type { LLMAdapter } from "./adapters/llm_adapter.js";
import { buildClaimGraph, HttpNliScorer, TokenHeuristicScorer } from "./graph/edge_builder.js";

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

async function validateOnce(input: ValidateInput, adapter?: LLMAdapter): Promise<ValidateOutput> {
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
      claims = extractClaims(answer);
    }

    // 2) grounding (legacy MVP evidence check)
    const evidenceRes = attachEvidenceAndFindViolations(claims, sources);

    // 3) logic (legacy MVP contradiction check)
    const logicRes = findLogicViolations(evidenceRes.claims);

    // 4) production graph build
    // Check for NLI endpoint in options or environment
    const nliEndpoint = options?.nliEndpoint || process.env.TCL_NLI_ENDPOINT || "";
    const nliApiKey = options?.nliApiKey || process.env.TCL_NLI_API_KEY;
    const nliModelId = options?.nliModelId || process.env.TCL_NLI_MODEL_ID || "nli-default";
    
    const scorer = nliEndpoint
      ? new HttpNliScorer({ 
          endpoint: nliEndpoint, 
          apiKey: nliApiKey,
          modelId: nliModelId
        })
      : new TokenHeuristicScorer();
    
    console.log(`Using scorer: ${scorer.id}${nliEndpoint ? ` (endpoint: ${nliEndpoint})` : ' (heuristic - no NLI endpoint configured)'}`);

    let graph;
    try {
      console.log("Building claim graph...");
      console.log(`Using scorer: ${scorer.id}, Claims: ${evidenceRes.claims.length}, Sources: ${sources?.length || 0}`);
      // Use lower thresholds for TokenHeuristicScorer to find more relationships
      const isHeuristic = scorer.id === "token-heuristic";
      graph = await buildClaimGraph(evidenceRes.claims, sources, {
        scorer,
        supportThreshold: isHeuristic ? 0.40 : 0.58, // Lower threshold for heuristic
        contradictionThreshold: isHeuristic ? 0.50 : 0.70, // Lower threshold for heuristic
        groundingThreshold: isHeuristic ? 0.40 : 0.60, // Lower threshold for heuristic
        maxPairwiseEdges: options?.maxPairwiseEdges ?? 200, // Increased to find more edges
        batchSize: options?.batchSize ?? 32,
        ann: {
          index: "bruteforce", // Use brute force instead of HNSW to avoid dependency issues
          neighborK: options?.annNeighborK ?? options?.neighborK ?? Math.min(12, evidenceRes.claims.length - 1) // Don't exceed claim count
        },
        cache: {
          enabled: false, // Disable cache for now to avoid file system issues
          persistPath: options?.cachePersistPath
        }
      });
      console.log("Claim graph built successfully");
      console.log(`Graph stats: ${graph.supports.length} supports, ${graph.contradictions.length} contradictions, ${graph.grounding.length} grounding edges`);
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

    // 5) spectral
    let spectral: SpectralReport | undefined;
    let coherenceScore = 50;
    const envSpectralUrl = process.env.TCL_SPECTRAL_URL || "";
    const urlToUse = spectralServiceUrl || envSpectralUrl;
    console.log(`Spectral check: enabled=${spectralEnabled}, URL from options=${spectralServiceUrl ? 'SET' : 'NOT SET'}, URL from env=${envSpectralUrl ? 'SET' : 'NOT SET'}, final URL=${urlToUse ? 'SET' : 'NOT SET'}`);
    
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

    // 6) scores
    const truthScore = evidenceRes.truthScore;
    const consistencyScore = logicRes.consistencyScore;
    const overall = blendScores(truthScore, consistencyScore, coherenceScore);
    const refusal = shouldRefuse(overall, truthScore, consistencyScore, options?.thresholds);

    return {
      answer,
      refusal,
      scores: { truth: truthScore, consistency: consistencyScore, coherence: coherenceScore, overall },
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
  try {
    const adapter = input.options?.llmAdapter;

    const first = await validateOnce(input, adapter);

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
      adapter
    );

    return second;
  } catch (error: any) {
    console.error("Validate function error:", error);
    throw error;
  }
}