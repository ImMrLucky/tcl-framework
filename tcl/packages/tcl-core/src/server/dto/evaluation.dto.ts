/**
 * Evaluation DTOs
 * 
 * Explicit data transfer objects for API responses.
 * These DTOs prevent leaking internal engine fields and allow for versioning.
 * 
 * IMPORTANT: Never spread raw engine/report objects into DTOs.
 * Always explicitly map fields.
 */

export interface EvaluationDto {
  id: string;
  org_id: string;
  project_id: string;
  env: string;
  conversation_id: string | null;
  scores: {
    spectral?: {
      coherenceScore?: number;
      contradictionEnergy?: number;
      supportEnergy?: number;
      circularityScore?: number;
      spectralGap?: number;
      cycleMass?: number;
      heatTrace?: number;
    };
    counts?: {
      claims?: number;
      contradicted?: number;
      ungrounded?: number;
      supported?: number;
    };
  };
  refusal: boolean;
  scorer_id: string | null;
  engine_version: string;
  latency_ms: number;
  created_at: string;
  
  // Report fields (only include what UI needs)
  report?: {
    summary?: any;
    issues?: any[];
    topIssuesV2?: any[];
    allIssuesV2?: any[];
    claims?: any[];
    graph?: {
      contradictions?: any[];
      supports?: any[];
    };
    spectral?: any;
    run?: {
      evaluationId?: string;
      inputHash?: string;
      configHash?: string;
      engineVersion?: string;
      modelFingerprint?: any;
    };
  };
}

export interface EvaluationSlimDto {
  id: string;
  org_id: string;
  project_id: string;
  env: string;
  conversation_id: string | null;
  scores: {
    spectral?: {
      coherenceScore?: number;
      contradictionEnergy?: number;
      supportEnergy?: number;
      circularityScore?: number;
      spectralGap?: number;
      cycleMass?: number;
      heatTrace?: number;
    };
    counts?: {
      claims?: number;
      contradicted?: number;
      ungrounded?: number;
      supported?: number;
    };
  };
  refusal: boolean;
  scorer_id: string | null;
  engine_version: string;
  latency_ms: number;
  created_at: string;
  
  // Slim mode: exclude large report fields
  // UI can fetch issues separately via /api/evaluations/:id/issues
}

/**
 * Convert database evaluation row to DTO
 * 
 * @param evaluation - Raw evaluation from database
 * @param includeReport - Whether to include full report (default: true for backward compatibility)
 * @returns EvaluationDto
 */
export function toEvaluationDto(
  evaluation: any,
  includeReport: boolean = true
): EvaluationDto {
  const dto: EvaluationDto = {
    id: evaluation.id,
    org_id: evaluation.org_id,
    project_id: evaluation.project_id,
    env: evaluation.env,
    conversation_id: evaluation.conversation_id,
    scores: evaluation.scores || {},
    refusal: evaluation.refusal || false,
    scorer_id: evaluation.scorer_id,
    engine_version: evaluation.engine_version,
    latency_ms: evaluation.latency_ms,
    created_at: evaluation.created_at,
  };

  if (includeReport && evaluation.report) {
    // Explicitly pick only needed report fields
    dto.report = {
      summary: evaluation.report.summary,
      issues: evaluation.report.issues,
      topIssuesV2: evaluation.report.topIssuesV2,
      allIssuesV2: evaluation.report.allIssuesV2,
      claims: evaluation.report.claims,
      graph: evaluation.report.graph ? {
        contradictions: evaluation.report.graph.contradictions,
        supports: evaluation.report.graph.supports,
      } : undefined,
      spectral: evaluation.report.spectral,
      run: evaluation.report.run ? {
        evaluationId: evaluation.report.run.evaluationId,
        inputHash: evaluation.report.run.inputHash,
        configHash: evaluation.report.run.configHash,
        engineVersion: evaluation.report.run.engineVersion,
        modelFingerprint: evaluation.report.run.modelFingerprint,
      } : undefined,
    };
  }

  return dto;
}

/**
 * Convert database evaluation row to slim DTO (no report)
 */
export function toEvaluationSlimDto(evaluation: any): EvaluationSlimDto {
  return {
    id: evaluation.id,
    org_id: evaluation.org_id,
    project_id: evaluation.project_id,
    env: evaluation.env,
    conversation_id: evaluation.conversation_id,
    scores: evaluation.scores || {},
    refusal: evaluation.refusal || false,
    scorer_id: evaluation.scorer_id,
    engine_version: evaluation.engine_version,
    latency_ms: evaluation.latency_ms,
    created_at: evaluation.created_at,
  };
}

