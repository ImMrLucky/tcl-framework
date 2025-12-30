import type { Claim, SpectralReport } from "../../types.js";
import { 
  computeInputHash, 
  computeConfigHash, 
  getEngineVersion, 
  getCodeVersion, 
  getModelFingerprint,
  buildIssuesList
} from "./reproducibility.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Call Spectral analyze service directly
 */
async function callSpectralAnalyze(
  claims: Array<{ id: string; text: string }>,
  supports: Array<{ claimA: string; claimB: string; weight?: number }>,
  contradictions: Array<{ claimA: string; claimB: string; weight?: number }>,
  grounded: string[],
  config?: {
    wSupport?: number;
    wContradiction?: number;
    wCircularity?: number;
    cycleMaxLen?: number;
  }
): Promise<SpectralReport> {
  const spectralServiceUrl = process.env.TCL_SPECTRAL_URL || "";
  if (!spectralServiceUrl) {
    throw new Error("TCL_SPECTRAL_URL not configured");
  }
  
  const url = `${spectralServiceUrl.replace(/\/$/, "")}/spectral/analyze`;
  
  const payload = {
    claims,
    supports,
    contradictions,
    grounded,
    w_support: config?.wSupport,
    w_contradiction: config?.wContradiction,
    w_circularity: config?.wCircularity,
    cycle_max_len: config?.cycleMaxLen
  };
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Spectral service error: ${res.status} - ${errorText}`);
  }
  
  return await res.json() as SpectralReport;
}

export interface EvaluationRunInput {
  conversationId: string;
  claims: Array<{ id: string; text: string; speaker?: string; turnIndex?: number }>;
  supports: Array<{ claimA: string; claimB: string; weight?: number }>;
  contradictions: Array<{ claimA: string; claimB: string; weight?: number }>;
  grounded: string[];
  config?: {
    wSupport?: number;
    wContradiction?: number;
    wCircularity?: number;
    cycleMaxLen?: number;
    alpha?: number;
    tau?: number;
  };
  sources?: Array<{ id: string; text: string }>;
}

export interface EvaluationRunResult {
  evaluationId: string;
  conversationId: string;
  inputHash: string;
  configHash: string;
  latency: number;
}

/**
 * Run an evaluation and store it with full reproducibility manifest
 */
export async function runEvaluation(
  input: EvaluationRunInput,
  context: { orgId: string; projectId: string; env: string; userId?: string },
  supabaseAdmin: SupabaseClient
): Promise<EvaluationRunResult> {
  const startTime = Date.now();
  
  // Compute hashes
  const inputHash = computeInputHash(
    input.claims,
    input.supports,
    input.contradictions,
    input.grounded
  );
  const configHash = computeConfigHash(input.config || {});
  
  // Call Spectral analyze service directly with provided claims/edges
  const spectral = await callSpectralAnalyze(
    input.claims,
    input.supports,
    input.contradictions,
    input.grounded,
    input.config
  );
  const latency = Date.now() - startTime;
  
  // Convert provided claims to Claim[] format for buildIssuesList
  const claims: Array<Claim & { meta?: { speaker?: string; turnIndex?: number } }> = input.claims.map(c => ({
    id: c.id,
    text: c.text,
    confidence: 0.75,
    evidence: [],
    meta: {
      speaker: c.speaker === 'AGENT' ? 'Agent' : c.speaker === 'CUSTOMER' ? 'Customer' : undefined,
      turnIndex: c.turnIndex
    }
  }));
  
  // Build issues list (destructive claims will be derived from spectral)
  const issues = buildIssuesList(
    spectral,
    claims,
    undefined // Destructive claims will be derived from spectral output
  );
  
  // Build full manifest
  const manifest = {
    run: {
      evaluationId: '', // Will be set after insert
      conversationId: input.conversationId,
      orgId: context.orgId,
      projectId: context.projectId,
      env: context.env,
      createdAt: new Date().toISOString(),
      createdBy: context.userId || null,
      engine: 'tcl-spectral',
      engineVersion: getEngineVersion(),
      codeVersion: getCodeVersion(),
      modelFingerprint: getModelFingerprint(),
      config: input.config || {},
      inputHash,
      configHash
    },
    inputs: {
      claims: input.claims.map(c => ({
        id: c.id,
        text: c.text,
        speaker: c.speaker === 'Agent' ? 'AGENT' : c.speaker === 'Customer' ? 'CUSTOMER' : 'UNKNOWN',
        turnStartIdx: c.turnIndex,
        turnEndIdx: c.turnIndex,
        startMs: null,
        endMs: null,
        tags: []
      })),
      supports: input.supports,
      contradictions: input.contradictions,
      grounded: input.grounded
    },
    spectral: spectral || {},
    issues
  };
  
  // Store evaluation
  const { data: evaluation, error } = await supabaseAdmin
    .from('evaluations')
    .insert({
      org_id: context.orgId,
      project_id: context.projectId,
      env: context.env,
      conversation_id: input.conversationId,
      scores: {
        spectral: spectral ? {
          coherenceScore: spectral.coherenceScore,
          contradictionEnergy: spectral.contradictionEnergy,
          supportEnergy: spectral.supportEnergy,
          circularityScore: spectral.circularityScore,
          spectralGap: spectral.spectralGap,
          cycleMass: spectral.cycleMass,
          heatTrace: spectral.heatTrace
        } : {},
        counts: {
          claims: claims.length,
          contradicted: issues.filter(i => i.truthState === 'Contradicted').length,
          ungrounded: issues.filter(i => i.truthState === 'Ungrounded').length,
          supported: issues.filter(i => i.truthState === 'Supported').length
        }
      },
      refusal: false,
      scorer_id: null,
      engine_version: getEngineVersion(),
      latency_ms: latency,
      report: manifest
    })
    .select('id')
    .single();
  
  if (error) {
    throw new Error(`Failed to store evaluation: ${error.message}`);
  }
  
  // Update manifest with evaluation ID
  manifest.run.evaluationId = evaluation.id;
  await supabaseAdmin
    .from('evaluations')
    .update({ report: manifest })
    .eq('id', evaluation.id);
  
  return {
    evaluationId: evaluation.id,
    conversationId: input.conversationId,
    inputHash,
    configHash,
    latency
  };
}

