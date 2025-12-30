import type { SupabaseClient } from "@supabase/supabase-js";
export interface EvaluationRunInput {
    conversationId: string;
    claims: Array<{
        id: string;
        text: string;
        speaker?: string;
        turnIndex?: number;
    }>;
    supports: Array<{
        claimA: string;
        claimB: string;
        weight?: number;
    }>;
    contradictions: Array<{
        claimA: string;
        claimB: string;
        weight?: number;
    }>;
    grounded: string[];
    config?: {
        wSupport?: number;
        wContradiction?: number;
        wCircularity?: number;
        cycleMaxLen?: number;
        alpha?: number;
        tau?: number;
    };
    sources?: Array<{
        id: string;
        text: string;
    }>;
}
export interface EvaluationRunResult {
    evaluationId: string;
    conversationId: string;
    inputHash: string;
    configHash: string;
    latency: number;
}
/**
 * Run an evaluation and store it with full reproducibility manifest
 */
export declare function runEvaluation(input: EvaluationRunInput, context: {
    orgId: string;
    projectId: string;
    env: string;
    userId?: string;
}, supabaseAdmin: SupabaseClient): Promise<EvaluationRunResult>;
