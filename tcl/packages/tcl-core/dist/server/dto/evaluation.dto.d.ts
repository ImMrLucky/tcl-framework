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
    report?: {
        summary?: any;
        issues?: any[];
        topIssuesV2?: any[];
        allIssuesV2?: any[];
        issueSummaryV2?: any;
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
}
/**
 * Convert database evaluation row to DTO
 *
 * @param evaluation - Raw evaluation from database
 * @param includeReport - Whether to include full report (default: true for backward compatibility)
 * @returns EvaluationDto
 */
export declare function toEvaluationDto(evaluation: any, includeReport?: boolean): EvaluationDto;
/**
 * Convert database evaluation row to slim DTO (no report)
 */
export declare function toEvaluationSlimDto(evaluation: any): EvaluationSlimDto;
/**
 * B1: V2 DTO - Canonical v2 response shape (no legacy fields)
 * Strips scoreBreakdown and severityDisplay from all issues
 */
export interface EvaluationV2Dto {
    id: string;
    org_id: string;
    project_id: string;
    env: string;
    conversation_id: string | null;
    scores: {
        truth?: number;
        overall?: number;
        coherence?: number;
        consistency?: number;
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
    report?: {
        issues?: {
            atomic: any[];
            grouped: any[];
        };
        topIssuesV2?: any[];
        allIssuesV2?: any[];
        issueSummaryV2?: any;
        claims?: any[];
        graph?: {
            contradictions?: any[];
            supports?: any[];
        };
        spectral?: any;
        executiveSummary?: any;
        evalMode?: any;
    };
}
/**
 * Convert database evaluation row to V2 DTO (canonical, no legacy fields)
 */
export declare function toEvaluationV2Dto(evaluation: any): EvaluationV2Dto;
