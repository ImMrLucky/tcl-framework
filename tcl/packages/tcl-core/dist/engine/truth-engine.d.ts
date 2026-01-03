/**
 * Truth Engine - Main entry point for deterministic truth graph generation.
 *
 * Replaces NLI-based edge generation with:
 * 1. Claim extraction (enhanced with modality/polarity)
 * 2. Fact normalization (structured semantic content)
 * 3. Rule-based edge generation (deterministic, auditable)
 * 4. Graph assembly (for spectral.py)
 *
 * Same input + config = identical output (reproducible).
 * No ML/NLI calls.
 */
import type { TruthEngineConfig } from "./config/types.js";
import type { TruthGraph } from "./facts/types.js";
export interface TruthEngineInput {
    transcript: string;
    config?: TruthEngineConfig;
    conversationId?: string;
}
export interface TruthEngineOutput {
    graph: TruthGraph;
    spectralInput: {
        claims: Array<{
            id: string;
            text: string;
        }>;
        supports: Array<{
            claimA: string;
            claimB: string;
            weight: number;
        }>;
        contradictions: Array<{
            claimA: string;
            claimB: string;
            weight: number;
        }>;
        grounded: string[];
    };
    timings: {
        claimExtraction: number;
        factExtraction: number;
        ruleEngine: number;
        total: number;
    };
}
/**
 * Run the deterministic truth engine on a transcript.
 */
export declare function runTruthEngine(input: TruthEngineInput): TruthEngineOutput;
/**
 * Convert Truth Engine output to legacy graph format for compatibility.
 */
export declare function toLegacyGraph(output: TruthEngineOutput): {
    supports: Array<{
        claimA: string;
        claimB: string;
        weight: number;
    }>;
    contradictions: Array<{
        claimA: string;
        claimB: string;
        weight: number;
    }>;
    grounding: Array<{
        claimId: string;
        sourceId: string;
        weight: number;
        quote?: string;
    }>;
    groundedClaimIds: string[];
    debug?: Record<string, any>;
};
/**
 * Build issues from truth graph for UI display.
 * Clusters contradictions by topic/subject for manager-grade problem statements.
 */
export declare function buildIssuesFromGraph(graph: TruthGraph): Array<{
    issueId: string;
    claimId: string;
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    ruleId: string;
    relatedClaims: string[];
    topic?: string;
    subject?: string;
    turnRange?: [number, number];
}>;
