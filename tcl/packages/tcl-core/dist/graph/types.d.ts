/**
 * ProtectQA Canonical Graph Types
 *
 * This file defines the core data model for the Claim-Evidence-Action Graph.
 * All analysis, spectral metrics, and truth states are derived from this graph.
 *
 * INVARIANTS:
 * - Graph is the single source of truth
 * - Edges are evidence-bearing objects (explainable and traceable)
 * - Support ≠ transcript quote (transcript creates GROUNDING, not SUPPORT)
 * - Contradictions require same subject slot
 * - All thresholds and weights are config-driven
 */
export type NodeType = 'CLAIM' | 'EVIDENCE' | 'ACTION' | 'TOPIC';
export type SpeakerRole = 'customer' | 'agent' | 'assistant' | 'system' | 'tool' | 'unknown';
export type ClaimModality = 'assert' | 'deny' | 'question' | 'hedge' | 'promise';
/**
 * SubjectSlot is REQUIRED for all claims.
 * This is what enables meaningful contradiction detection.
 * Only claims with matching slots can contradict each other.
 */
export interface SubjectSlot {
    /** High-level category: fee, promo, contract_term, refund_policy, payment_date, rate, dscr, etc. */
    slotType: string;
    /** Canonical key: router_fee, late_fee, streaming_plus_addon, price_lock, etc. */
    entityKey: string;
    /** Normalized value (cents for money, ISO for dates, etc.) */
    value?: any;
    /** Stable string representation for comparison */
    valueNorm?: string;
    /** Additional qualifiers: planId, region, product, termMonths, etc. */
    qualifiers?: Record<string, any>;
}
export interface ExtractedEntity {
    type: string;
    value: string;
    normalized?: any;
    span?: {
        start: number;
        end: number;
    };
    confidence?: number;
}
export interface EvidenceAnchor {
    /** Type of anchor: span, field, section, line */
    type: 'span' | 'field' | 'section' | 'line';
    /** Reference identifier */
    ref: string;
    /** Human-readable location */
    location?: string;
    /** Exact text at anchor */
    text?: string;
}
export type AnchorType = 'MONEY' | 'DATE' | 'TIMEFRAME' | 'PERCENT' | 'QUANTITY' | 'ADDRESS' | 'EMAIL' | 'PHONE' | 'PAYMENT_CARD' | 'SSN_LAST4' | 'URL' | 'ID';
export interface ClaimAnchor {
    type: AnchorType;
    key: string;
    raw?: string;
    span?: {
        start: number;
        end: number;
    };
    confidence?: number;
}
export interface ClaimNode {
    id: string;
    type: 'CLAIM';
    text: string;
    /** Speaker role (legacy - for backward compatibility) */
    speakerRole: SpeakerRole;
    /** Who said this claim - normalized attribution */
    who?: {
        /** Transcript speaker label (e.g., "Vanessa", "Agent", "SPEAKER_0") */
        speaker: string;
        /** Display label (same as speaker, or normalized) */
        speakerLabel: string;
        /** Normalized role: REPRESENTATIVE | CUSTOMER | THIRD_PARTY | UNKNOWN */
        role: 'REPRESENTATIVE' | 'CUSTOMER' | 'THIRD_PARTY' | 'UNKNOWN';
    };
    /** Location in transcript */
    span: {
        turnId: string;
        startChar: number;
        endChar: number;
    };
    /** Timestamp if available */
    timestamp?: string;
    /** Claim modality */
    modality: ClaimModality;
    /** Template-driven taxonomy: pricing, policy, process, eligibility */
    claimType?: string;
    /** Extracted entities */
    entities: ExtractedEntity[];
    /** Normalized values derived from entities */
    normalized: NormalizedValues;
    /** REQUIRED - Subject slot for this claim */
    slot: SubjectSlot;
    /** Industry-agnostic anchors (universal slot keys) */
    anchors?: ClaimAnchor[];
    /** Computed topic ID */
    topicId?: string;
    /** ASR or extraction confidence */
    confidence?: number;
    /** Timestamp of creation */
    createdAt: string;
    /** Additional metadata */
    meta?: Record<string, any>;
}
export interface NormalizedValues {
    amount?: number;
    date?: string;
    duration?: number;
    percentage?: number;
    text?: string;
}
export type EvidenceKind = 'policy' | 'system_fact' | 'document' | 'kb' | 'tool_log' | 'transcript';
export interface EvidenceNode {
    id: string;
    type: 'EVIDENCE';
    /** Kind of evidence */
    evidenceKind: EvidenceKind;
    /** Source system: billing, crm, zendesk, confluence, etc. */
    sourceSystem?: string;
    /** Title or label */
    title?: string;
    /** Version identifier */
    version?: string;
    /** When this evidence became effective */
    effectiveDate?: string;
    /** Stable citation anchors */
    anchors: EvidenceAnchor[];
    /** Text excerpt for policy/doc/kb */
    content?: string;
    /** Structured facts (ledger, underwriting fields) */
    fields?: Record<string, any>;
    /** When this evidence was retrieved */
    retrievedAt?: string;
    /** Timestamp of creation */
    createdAt: string;
    /** Additional metadata */
    meta?: Record<string, any>;
}
export interface ActionNode {
    id: string;
    type: 'ACTION';
    /** Action type: waive_fee, refund_requested, addon_removed, ticket_created */
    actionType: string;
    /** Who performed the action */
    actorRole: SpeakerRole;
    /** When the action occurred */
    timestamp?: string;
    /** Structured details */
    details?: Record<string, any>;
    /** Timestamp of creation */
    createdAt: string;
    /** Additional metadata */
    meta?: Record<string, any>;
}
export interface TopicNode {
    id: string;
    type: 'TOPIC';
    /** Topic label */
    label: string;
    /** Constituent slot types */
    slotTypes: string[];
    /** Timestamp of creation */
    createdAt: string;
    /** Additional metadata */
    meta?: Record<string, any>;
}
export type GraphNode = ClaimNode | EvidenceNode | ActionNode | TopicNode;
export type EdgeType = 'SUPPORT' | 'CONTRADICTION' | 'GROUNDING' | 'ACTION_RESULT' | 'CORRECTION';
export interface EdgeRationale {
    /** Method used to determine this edge */
    method: 'nli' | 'rule' | 'hybrid' | 'retrieval+rerank' | 'exact_match' | 'semantic';
    /** Contributing signals */
    signals: {
        similarity?: number;
        entityMatchScore?: number;
        slotMatchScore?: number;
        polarityScore?: number;
        nliScore?: number;
        ruleMatched?: string[];
        [key: string]: any;
    };
}
export interface EdgeProvenance {
    /** Citation anchors for support/grounding */
    anchors?: EvidenceAnchor[];
    /** Span pairs showing what matched */
    spanPairs?: Array<{
        fromSpan: {
            start: number;
            end: number;
            text?: string;
        };
        toSpan: {
            start: number;
            end: number;
            text?: string;
        };
    }>;
    /** Source IDs (evidence IDs, log IDs) */
    sourceIds?: string[];
}
export interface GraphEdge {
    id: string;
    type: EdgeType;
    /** Source node ID */
    from: string;
    /** Target node ID */
    to: string;
    /** Calibrated weight (0..1) */
    weight: number;
    /** Why this edge exists */
    rationale: EdgeRationale;
    /** Traceability information */
    provenance: EdgeProvenance;
    /** REQUIRED for CONTRADICTION, recommended for SUPPORT */
    slot: {
        slotType: string;
        entityKey: string;
    };
    /** Topic this edge belongs to */
    topicId?: string;
    /** Timestamp of creation */
    createdAt: string;
}
export interface CandidateBudgets {
    perClaim: {
        contradictionPairs: number;
        supportClaimPairs: number;
        supportEvidencePairs: number;
        groundingPairs: number;
    };
    global?: {
        /** Safety cap - must not starve per-claim budgets */
        maxPairsTotal?: number;
    };
}
export type RunStatus = 'OK' | 'DEGRADED' | 'FAILED';
export interface RunDiagnostics {
    status: RunStatus;
    /** Reasons for degradation/failure */
    reasons: string[];
    /** Counters for debugging */
    counters: Record<string, number>;
    /** Timestamp */
    timestamp: string;
}
export type TruthState = 'SUPPORTED' | 'CONTRADICTED' | 'UNVERIFIED' | 'UNGROUNDED';
export interface ClaimGraph {
    /** All nodes in the graph */
    nodes: {
        claims: ClaimNode[];
        evidence: EvidenceNode[];
        actions: ActionNode[];
        topics: TopicNode[];
    };
    /** All edges in the graph */
    edges: {
        support: GraphEdge[];
        contradiction: GraphEdge[];
        grounding: GraphEdge[];
        actionResult: GraphEdge[];
        correction: GraphEdge[];
    };
    /** Run diagnostics */
    diagnostics: RunDiagnostics;
    /** Metadata */
    meta: {
        templateId: string;
        createdAt: string;
        inputHash: string;
        configHash: string;
    };
}
export declare function slotsMatch(a: SubjectSlot, b: SubjectSlot): boolean;
export declare function slotsCompatible(a: SubjectSlot, b: SubjectSlot): boolean;
