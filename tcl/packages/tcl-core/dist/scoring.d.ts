/**
 * Blends truth, consistency, and coherence scores into an overall score.
 * Weights: 50% truth, 30% consistency, 20% coherence.
 * Ensures result is in 0-100 range.
 */
export declare function blendScores(truth: number | null, consistency: number | null, coherence: number | null): number | null;
/**
 * Run status for evaluations - replaces boolean "refusal"
 */
export type RunStatus = 'OK' | 'DEGRADED' | 'FAILED';
/**
 * Detailed run quality assessment with reasons
 */
export interface RunQualityResult {
    status: RunStatus;
    degradedReasons: string[];
    /** Legacy boolean for backward compatibility */
    refusal: boolean;
}
/**
 * Determines run quality based on scores and graph health.
 * Returns detailed status with reasons instead of just a boolean.
 */
export declare function assessRunQuality(overall: number | null, truth: number | null, consistency: number | null, graphHealth?: {
    supportsCount?: number;
    contradictionsCount?: number;
    groundingCount?: number;
    claimsCount?: number;
    hasExternalEvidence?: boolean;
}, thresholds?: {
    truth?: number;
    consistency?: number;
    overall?: number;
}): RunQualityResult;
/**
 * Determines if an answer should be refused based on score thresholds.
 * Returns true if any score is below its threshold.
 *
 * @deprecated Use assessRunQuality() instead for more detailed status
 */
export declare function shouldRefuse(overall: number | null, truth: number | null, consistency: number | null, thresholds?: {
    truth?: number;
    consistency?: number;
    overall?: number;
}): boolean;
