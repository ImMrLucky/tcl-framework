/**
 * Evaluation DTOs
 *
 * Explicit data transfer objects for API responses.
 * These DTOs prevent leaking internal engine fields and allow for versioning.
 *
 * IMPORTANT: Never spread raw engine/report objects into DTOs.
 * Always explicitly map fields.
 */
/**
 * Convert database evaluation row to DTO
 *
 * @param evaluation - Raw evaluation from database
 * @param includeReport - Whether to include full report (default: true for backward compatibility)
 * @returns EvaluationDto
 */
export function toEvaluationDto(evaluation, includeReport = true) {
    const dto = {
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
export function toEvaluationSlimDto(evaluation) {
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
