export declare function blendScores(truth: number, consistency: number, coherence: number): number;
export declare function shouldRefuse(overall: number, truth: number, consistency: number, thresholds?: {
    truth?: number;
    consistency?: number;
    overall?: number;
}): boolean;
