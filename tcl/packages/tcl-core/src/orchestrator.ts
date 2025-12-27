import { ValidateInput, ValidateOutput, SpectralReport } from "./types";
import { extractClaims } from "./claim_extractor";
import { attachEvidenceAndFindViolations } from "./evidence";
import { findLogicViolations } from "./logic";
import { blendScores, shouldRefuse } from "./scoring";
import { collectFailingClaimIds, repairOnce } from "./repair";
import type { LLMAdapter } from "./adapters/llm_adapter";
import { buildClaimGraph, HttpNliScorer, TokenHeuristicScorer } from "./graph/edge_builder";

async function callSpectralService(
  spectralServiceUrl: string,
  claims: { id: string; text: string }[],
  supports: { claimA: string; claimB: string; weight?: number }[],
  contradictions: { claimA: string; claimB: string; weight?: number }[],
  groundedClaimIds: string[]
): Promise<SpectralReport> {
  const res = await fetch(`${spectralServiceUrl.replace(/\/$/, "")}/spectral/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claims, supports, contradictions, grounded: groundedClaimIds })
  });
  if (!res.ok) throw new Error(`Spectral service error: ${res.status}`);
  return (await res.json()) as SpectralReport;
}

async function validateOnce(input: ValidateInput, adapter?: LLMAdapter): Promise<ValidateOutput> {
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
  const scorer =
    options?.nliEndpoint
      ? new HttpNliScorer({ 
          endpoint: options.nliEndpoint, 
          apiKey: options.nliApiKey,
          modelId: options.nliModelId || "nli-default"
        })
      : new TokenHeuristicScorer();

  const graph = await buildClaimGraph(evidenceRes.claims, sources, {
    scorer,
    maxPairwiseEdges: options?.maxPairwiseEdges ?? 6000,
    batchSize: options?.batchSize ?? 256,
    ann: {
      index: options?.annIndex ?? "hnsw",
      neighborK: options?.annNeighborK ?? options?.neighborK ?? 12
    },
    cache: {
      enabled: true,
      persistPath: options?.cachePersistPath
    }
  });

  // merge hard contradictions found by rule layer into graph contradictions (weight=1)
  const hardContradictions = logicRes.contradictions.map((x) => ({ claimA: x.claimA, claimB: x.claimB, weight: 1.0 }));
  const contradictions = [...graph.contradictions, ...hardContradictions];

  // 5) spectral
  let spectral: SpectralReport | undefined;
  let coherenceScore = 50;
  if (spectralEnabled) {
    if (!spectralServiceUrl) throw new Error("spectral=true but no spectralServiceUrl/TCL_SPECTRAL_URL configured");
    spectral = await callSpectralService(
      spectralServiceUrl,
      evidenceRes.claims.map((c) => ({ id: c.id, text: c.text })),
      graph.supports,
      contradictions,
      graph.groundedClaimIds
    );
    coherenceScore = spectral.coherenceScore;
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
      spectral
    }
  };
}

export async function validate(input: ValidateInput): Promise<ValidateOutput> {
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
}