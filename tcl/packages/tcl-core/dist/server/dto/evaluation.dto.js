/**
 * Evaluation DTOs
 *
 * Explicit data transfer objects for API responses.
 * These DTOs prevent leaking internal engine fields and allow for versioning.
 *
 * IMPORTANT: Never spread raw engine/report objects into DTOs.
 * Always explicitly map fields.
 */
import { computeIssueSummaryV2, isIssueSummaryV2MissingOrIncomplete } from '../issues/issue-summary.js';
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
        // Backfill issueSummaryV2 if missing or incomplete (read-time backfill for older evaluations)
        const allIssuesV2 = dto.report.allIssuesV2 || [];
        if (allIssuesV2.length > 0) {
            const existingSummary = evaluation.report.issueSummaryV2;
            if (isIssueSummaryV2MissingOrIncomplete(existingSummary, allIssuesV2.length)) {
                // Compute summary from actual issues
                dto.report.issueSummaryV2 = computeIssueSummaryV2(allIssuesV2);
            }
            else {
                // Use existing summary if it's valid
                dto.report.issueSummaryV2 = existingSummary;
            }
        }
        else if (evaluation.report.issueSummaryV2) {
            // Keep existing summary even if no issues (for consistency)
            dto.report.issueSummaryV2 = evaluation.report.issueSummaryV2;
        }
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
