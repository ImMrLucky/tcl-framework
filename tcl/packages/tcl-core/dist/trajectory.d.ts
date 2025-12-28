/**
 * Trajectory scoring for call transcripts
 *
 * Segments transcripts into windows and validates each segment,
 * producing a timeline of risk and identifying moments of instability.
 */
import type { ValidateInput, ValidateOutput, TrajectoryReport } from "./types.js";
import type { LLMAdapter } from "./adapters/llm_adapter.js";
type ValidateOnceFn = (input: ValidateInput, adapter?: LLMAdapter, startTime?: number) => Promise<ValidateOutput>;
export declare function computeTrajectory(input: ValidateInput, validateOnce: ValidateOnceFn, adapter?: LLMAdapter, options?: {
    windowTurns?: number;
    maxSegments?: number;
}): Promise<TrajectoryReport>;
export {};
