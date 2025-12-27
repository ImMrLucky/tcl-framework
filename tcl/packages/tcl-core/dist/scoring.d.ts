/**
 * Blends truth, consistency, and coherence scores into an overall score.
 * Weights: 50% truth, 30% consistency, 20% coherence.
 * Ensures result is in 0-100 range.
 */
export declare function blendScores(truth: number, consistency: number, coherence: number): number;
/**
 * Determines if an answer should be refused based on score thresholds.
 * Returns true if any score is below its threshold.
 */
export declare function shouldRefuse(overall: number, truth: number, consistency: number, thresholds?: {
    truth?: number;
    consistency?: number;
    overall?: number;
}): boolean;
