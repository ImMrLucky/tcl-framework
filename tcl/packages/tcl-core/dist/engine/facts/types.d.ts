/**
 * Data types for the deterministic truth graph engine.
 */
export type Modality = "absolute" | "conditional" | "informational" | "question" | "request" | "apology";
export type Polarity = "affirm" | "deny" | "unknown";
export type Speaker = "agent" | "customer" | "system";
/**
 * Claim kind for contradiction gating
 */
export type ClaimKind = "assertion" | "intent" | "question" | "meta" | "emotion" | "promise" | "unknown";
/**
 * Intent classification for request fulfillment
 */
export type Intent = "send_document" | "email" | "call_back" | "refund" | "cancel" | "change_plan" | "unknown";
/**
 * Enhanced Claim with deterministic classification.
 */
export interface EnhancedClaim {
    id: string;
    speaker: Speaker;
    text: string;
    turnIndex: number;
    timestamp?: string;
    modality: Modality;
    polarity: Polarity;
    topics: string[];
    claimKind: ClaimKind;
    intent?: Intent;
    entities: Array<{
        type: string;
        value: string;
    }>;
    numbers: Array<{
        raw: string;
        value?: number;
        unit?: string;
    }>;
    hasNegation: boolean;
    hasAbsoluteLanguage: boolean;
    hasConditionalLanguage: boolean;
}
/**
 * Value type for semantic comparison
 */
export type ValueType = 'boolean' | 'number' | 'money' | 'string' | 'enum' | 'unknown';
/**
 * Certainty level derived from modality language
 */
export type CertaintyLevel = 'high' | 'medium' | 'low';
/**
 * Normalized timeframe bucket
 */
export interface TimeframeNormalized {
    bucket: string;
    startEpoch?: number;
    endEpoch?: number;
    relative?: string;
}
/**
 * Normalized Fact extracted from a Claim.
 * Facts are the basis for contradiction/support detection.
 */
export interface Fact {
    id: string;
    claimId: string;
    turnIndex: number;
    speaker: Speaker;
    subject: string;
    predicate: string;
    value: string | number | boolean | null;
    subjectNormalized: string;
    predicateNormalized: string;
    valueType: ValueType;
    normalizedValue: string | number | boolean | null;
    polarity: Polarity;
    certainty: CertaintyLevel;
    conditions: string[];
    timeframe?: {
        start?: string;
        end?: string;
        relative?: string;
    };
    timeframeNormalized?: TimeframeNormalized;
    sourceCertainty: "stated" | "inferred";
    sourceSpan?: {
        start: number;
        end: number;
    };
}
/**
 * Edge types for the truth graph.
 */
export type EdgeType = "support" | "contradiction" | "grounding" | "structure";
export type EdgeProvenance = "rules" | "retrieval" | "structure";
/**
 * Contradiction type for gating
 */
export type TruthEdgeContradictionType = "direct" | "topic_mismatch" | "low_overlap" | "needs_review";
/**
 * Rule-based edge with full provenance.
 */
export interface TruthEdge {
    id: string;
    type: EdgeType;
    srcId: string;
    dstId: string;
    weight: number;
    reason: string;
    ruleId: string;
    provenance: EdgeProvenance;
    contradictionType?: TruthEdgeContradictionType;
    overlapScore?: number;
    reasonCodes?: string[];
    metadata?: {
        subject?: string;
        predicate?: string;
        polarityConflict?: boolean;
        modalityShift?: boolean;
        timeframeOverlap?: boolean;
        topic?: string;
        srcText?: string;
        dstText?: string;
        isQualification?: boolean;
        earlierBucket?: string;
        laterBucket?: string;
        supportType?: 'entailed' | 'paraphrase' | 'agent_confirm' | 'weak';
        customerIntent?: string;
        overlapScore?: number;
    };
}
/**
 * Evidence chunk for grounding edges.
 */
export interface EvidenceChunk {
    id: string;
    sourceType: "policy" | "agreement" | "kb" | "product";
    sourceRef: string;
    title?: string;
    text: string;
    tags: string[];
    authority: "high" | "medium" | "low";
}
/**
 * Complete truth graph output.
 */
export interface TruthGraph {
    claims: EnhancedClaim[];
    facts: Fact[];
    evidenceChunks?: EvidenceChunk[];
    contradictionEdges: TruthEdge[];
    supportEdges: TruthEdge[];
    groundingEdges: TruthEdge[];
    structureEdges: TruthEdge[];
    inputHash: string;
    configHash: string;
    codeVersion: string;
    generatedAt: string;
    stats: {
        claimCount: number;
        factCount: number;
        edgeCounts: Record<EdgeType, number>;
        rulesApplied: string[];
        processingTimeMs: number;
    };
}
