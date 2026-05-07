/**
 * Graph Builder - Unified Entry Point
 *
 * This is the main entry point for building a semantically correct Claim-Evidence-Action Graph.
 *
 * Pipeline:
 * 1. Extract claims with subject slots
 * 2. Topic segmentation
 * 3. Candidate generation (per-claim budgets)
 * 4. Edge classification (slot-first gating)
 * 5. Weight calibration
 * 6. Truth state derivation (from graph, never assigned directly)
 * 7. Return ClaimGraph + RunDiagnostics
 *
 * INVARIANTS:
 * - Graph is the single source of truth
 * - Edges are evidence-bearing objects
 * - Support ≠ transcript quote (transcript = GROUNDING, not SUPPORT)
 * - Contradictions require same subject slot
 * - All thresholds are config-driven
 */
import { ClaimGraph, ClaimModality, SpeakerRole, EvidenceKind } from './types.js';
import { getTemplateConfig, setTemplateConfig, TemplateConfig } from './template-config.js';
export { setTemplateConfig, getTemplateConfig, TemplateConfig };
import { SegmentationResult } from './topic-segmentation.js';
import { TruthDerivationResult, TruthScores } from './truth-state-derivation.js';
export interface GraphBuilderInput {
    /**
     * Raw transcript or interaction text.
     * Will be parsed into claims if rawClaims not provided.
     */
    transcript?: string;
    /**
     * Pre-extracted claims (if available).
     * Each must have id, text, speakerRole, and span.
     */
    rawClaims?: Array<{
        id: string;
        text: string;
        speakerRole: SpeakerRole;
        span: {
            turnId: string;
            startChar: number;
            endChar: number;
        };
        timestamp?: string;
        modality?: ClaimModality;
        claimType?: string;
        confidence?: number;
        meta?: Record<string, any>;
    }>;
    /**
     * Evidence documents (policies, facts, system records).
     * These can create SUPPORT edges (not transcript).
     */
    evidence?: Array<{
        id: string;
        kind: EvidenceKind;
        content: string;
        title?: string;
        sourceSystem?: string;
        version?: string;
        effectiveDate?: string;
        fields?: Record<string, any>;
    }>;
    /**
     * Template ID or custom config.
     * Determines domain-specific lexicon, thresholds, and gating rules.
     */
    template?: string | Partial<TemplateConfig>;
    /**
     * Conversation/interaction ID for traceability.
     */
    conversationId?: string;
    /**
     * Speaker role map (from conversation.metadata.speakerRoleMap)
     * Maps transcript speaker labels to normalized roles: REPRESENTATIVE | CUSTOMER | THIRD_PARTY | UNKNOWN
     */
    speakerRoleMap?: Record<string, 'REPRESENTATIVE' | 'CUSTOMER' | 'THIRD_PARTY' | 'UNKNOWN'>;
}
export interface GraphBuilderOutput {
    /** The complete claim graph */
    graph: ClaimGraph;
    /** Truth scores computed from the graph */
    truthScores: TruthScores;
    /** Per-claim truth state derivation */
    truthDerivation: TruthDerivationResult;
    /** Topic segmentation result */
    topicSegmentation: SegmentationResult;
    /** For backward compatibility with legacy edge_builder */
    legacy: {
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
    };
    /** Processing metrics */
    metrics: {
        totalClaims: number;
        totalEvidence: number;
        totalEdges: number;
        processingTimeMs: number;
        pipelineSteps: Record<string, number>;
        /** Edge classification diagnostics (for debugging) */
        edgeClassification?: {
            candidatesProcessed: number;
            edgesCreated: number;
            rejectedBySlotGating: number;
            rejectedByTopicGating: number;
            rejectedByPolarityGating: number;
            rejectedByThreshold: number;
            rejectedByIneligibleSlot: number;
            rejectedByValueTypeMismatch: number;
            sampleRejections: Array<{
                claimA: string;
                claimB: string;
                reason: string;
                slotA: string;
                slotB: string;
                textA: string;
                textB: string;
            }>;
        };
        /** Candidate generation diagnostics */
        candidateGeneration?: {
            totalCandidatesGenerated: number;
            claimsWithZeroCandidates: number;
            budgetExhausted: boolean;
        };
        /** Slot mapping diagnostics */
        slotMapping?: {
            registryVersion: string;
            totalClaims: number;
            counts: {
                HARD: number;
                SOFT: number;
                NONE: number;
            };
            miscClaims: number;
            topSlotKeys: Array<{
                slotKey: string;
                count: number;
            }>;
        };
    };
}
/**
 * Build graph synchronously (uses regex entities, backwards compatible).
 */
export declare function buildGraph(input: GraphBuilderInput): GraphBuilderOutput;
/**
 * Build graph asynchronously (uses spaCy entities if available, better quality).
 */
export declare function buildGraphAsync(input: GraphBuilderInput): Promise<GraphBuilderOutput>;
export interface SpectralInput {
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
}
export declare function toSpectralInput(output: GraphBuilderOutput): SpectralInput;
export declare function assertGraphInvariants(graph: ClaimGraph): {
    passed: boolean;
    failures: string[];
};
