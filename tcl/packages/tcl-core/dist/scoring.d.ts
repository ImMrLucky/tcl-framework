/**
 * Blends truth, consistency, and coherence scores into an overall score.
 * Weights: 50% truth, 30% consistency, 20% coherence.
 * Ensures result is in 0-100 range.
 */
export declare function blendScores(truth: number | null, consistency: number | null, coherence: number | null): number | null;
/**
 * Determines if an answer should be refused based on score thresholds.
 * Returns true if any score is below its threshold.
 */
export declare function shouldRefuse(overall: number | null, truth: number | null, consistency: number | null, thresholds?: {
    truth?: number;
    consistency?: number;
    overall?: number;
}): boolean;
