/**
 * Run Diagnostics
 *
 * Replaces boolean "refusal" with structured run status.
 *
 * Status:
 * - OK: Graph is healthy, spectral analysis is meaningful
 * - DEGRADED: Graph has issues, spectral results may be unreliable
 * - FAILED: Graph construction failed, results should not be used
 */
import { RunDiagnostics, RunStatus, ClaimGraph } from './types.js';
export declare const DIAGNOSTIC_REASONS: {
    PAIR_BUDGET_STARVED: string;
    NO_SUPPORT_EVIDENCE: string;
    TOPIC_SEGMENTATION_LOW_CONF: string;
    TOO_FEW_CLAIMS: string;
    TOO_MANY_UNGROUNDED: string;
    HIGH_CONTRADICTION_RATE: string;
    NO_GROUNDING_EDGES: string;
    SPECTRAL_SKIPPED: string;
    EMPTY_GRAPH: string;
    CONFIG_MISMATCH: string;
};
export interface DiagnosticsInput {
    candidateDiagnostics: {
        totalClaimsProcessed: number;
        totalCandidatesGenerated: number;
        budgetExhausted: boolean;
        claimsWithZeroCandidates: number;
    };
    edgeDiagnostics: {
        candidatesProcessed: number;
        edgesCreated: number;
        rejectedBySlotGating: number;
        rejectedByPolarityGating: number;
        rejectedByThreshold: number;
    };
    truthSummary: {
        supported: number;
        contradicted: number;
        unverified: number;
        ungrounded: number;
        total: number;
    };
    hasExternalEvidence: boolean;
    spectralSkipped: boolean;
}
export declare function buildRunDiagnostics(input: DiagnosticsInput): RunDiagnostics;
export interface GraphIntegrityResult {
    isValid: boolean;
    violations: string[];
}
export declare function validateGraphIntegrity(graph: ClaimGraph): GraphIntegrityResult;
export interface FormattedDiagnostics {
    status: RunStatus;
    statusLabel: string;
    statusDescription: string;
    reasons: Array<{
        code: string;
        message: string;
    }>;
    counters: Record<string, {
        label: string;
        value: number;
    }>;
}
export declare function formatDiagnosticsForUI(diagnostics: RunDiagnostics): FormattedDiagnostics;
