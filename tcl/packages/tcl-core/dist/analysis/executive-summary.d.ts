/**
 * Executive Summary Module
 *
 * E1-E3: Compute root-cause driven executive summary from aggregated issues
 *
 * The summary should be derived from aggregatedIssues, not raw atomic issues.
 * This ensures the summary reflects root causes, not edge spam.
 */
import type { AggregatedIssue, ExecutiveSummary, EvalMode } from '../types.js';
export interface ExecutiveSummaryInput {
    aggregatedIssues: AggregatedIssue[];
    truthScore: number | null;
    coherenceScore: number | null;
    consistencyScore: number | null;
    evalMode: EvalMode;
    provenance?: {
        ingestionMode: string;
        transcriptSource: string;
        hasAudio: boolean;
    };
}
/**
 * E1-E3: Compute executive summary from aggregated issues
 */
export declare function computeExecutiveSummary(input: ExecutiveSummaryInput): ExecutiveSummary;
