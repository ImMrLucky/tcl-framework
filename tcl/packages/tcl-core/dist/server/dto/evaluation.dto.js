/**
 * Evaluation DTOs
 *
 * Explicit data transfer objects for API responses.
 * These DTOs prevent leaking internal engine fields and allow for versioning.
 *
 * IMPORTANT: Never spread raw engine/report objects into DTOs.
 * Always explicitly map fields.
 */
import { computeIssueSummaryV2 } from '../issues/issue-summary.js';
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
        // CRITICAL: Preserve issueSummaryV2 if it exists (has correct topIssuesCount vs allIssuesCount)
        // Only recompute if missing or if counts don't match
        const allIssuesV2 = dto.report.allIssuesV2 || [];
        const existingSummary = evaluation.report.issueSummaryV2;
        if (existingSummary && existingSummary.allIssuesCount === allIssuesV2.length) {
            // Use existing summary if it matches the current issue count (preserves topIssuesCount distinction)
            dto.report.issueSummaryV2 = existingSummary;
        }
        else if (allIssuesV2.length > 0) {
            // Recompute only if summary is missing or counts don't match
            // Note: When recomputing, we don't know topIssuesCount, so both counts will be the same
            dto.report.issueSummaryV2 = computeIssueSummaryV2(allIssuesV2);
        }
        else if (existingSummary) {
            // Keep existing summary if no issues (for consistency)
            dto.report.issueSummaryV2 = existingSummary;
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
/**
 * Strip legacy fields from an issue (v2 canonical shape)
 * B2: Remove scoreBreakdown and severityDisplay completely
 */
function stripLegacyFields(issue) {
    if (!issue || typeof issue !== 'object') {
        return issue;
    }
    // Create a new object without legacy fields
    const cleanIssue = {};
    for (const key in issue) {
        if (key === 'scoreBreakdown' || key === 'severityDisplay') {
            // Skip legacy fields
            continue;
        }
        // Recursively clean nested objects/arrays
        if (Array.isArray(issue[key])) {
            cleanIssue[key] = issue[key].map((item) => typeof item === 'object' ? stripLegacyFields(item) : item);
        }
        else if (issue[key] && typeof issue[key] === 'object' && !(issue[key] instanceof Date)) {
            cleanIssue[key] = stripLegacyFields(issue[key]);
        }
        else {
            cleanIssue[key] = issue[key];
        }
    }
    return cleanIssue;
}
/**
 * Convert database evaluation row to V2 DTO (canonical, no legacy fields)
 */
export function toEvaluationV2Dto(evaluation) {
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
    if (evaluation.report) {
        // B2: Clean issues: remove scoreBreakdown and severityDisplay
        // Use defensive approach: strip + explicit delete
        const rawAtomicIssues = evaluation.report.allIssuesV2 || evaluation.report.issues?.atomic || [];
        const rawGroupedIssues = evaluation.report.topIssuesV2 || evaluation.report.issues?.grouped || [];
        const atomicIssues = rawAtomicIssues.map((issue) => {
            const cleaned = stripLegacyFields(issue);
            // Defensive: explicitly delete if still present (handles edge cases)
            if ('scoreBreakdown' in cleaned) {
                delete cleaned.scoreBreakdown;
            }
            if ('severityDisplay' in cleaned) {
                delete cleaned.severityDisplay;
            }
            return cleaned;
        });
        const groupedIssues = rawGroupedIssues.map((issue) => {
            const cleaned = stripLegacyFields(issue);
            // Defensive: explicitly delete if still present
            if ('scoreBreakdown' in cleaned) {
                delete cleaned.scoreBreakdown;
            }
            if ('severityDisplay' in cleaned) {
                delete cleaned.severityDisplay;
            }
            return cleaned;
        });
        dto.report = {
            issues: {
                atomic: atomicIssues,
                grouped: groupedIssues,
            },
            // Legacy aliases for backward compatibility (but cleaned)
            topIssuesV2: groupedIssues,
            allIssuesV2: atomicIssues,
            issueSummaryV2: evaluation.report.issueSummaryV2,
            claims: evaluation.report.claims,
            graph: evaluation.report.graph ? {
                contradictions: evaluation.report.graph.contradictions,
                supports: evaluation.report.graph.supports,
            } : undefined,
            spectral: evaluation.report.spectral,
            executiveSummary: evaluation.report.executiveSummary,
            evalMode: evaluation.report.evalMode,
        };
    }
    return dto;
}
