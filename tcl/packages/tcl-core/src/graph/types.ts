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

// =============================================================================
// NODE TYPES
// =============================================================================

export type NodeType = 'CLAIM' | 'EVIDENCE' | 'ACTION' | 'TOPIC';

export type SpeakerRole = 'customer' | 'agent' | 'assistant' | 'system' | 'tool' | 'unknown';

export type ClaimModality = 'assert' | 'deny' | 'question' | 'hedge' | 'promise';

// =============================================================================
// SUBJECT SLOT (The Key Upgrade)
// =============================================================================

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

// =============================================================================
// EXTRACTED ENTITIES
// =============================================================================

export interface ExtractedEntity {
  type: string;       // MONEY, DATE, PLAN, FEE, POLICY, ACTION, PERCENT, DURATION, etc.
  value: string;      // Raw extracted value
  normalized?: any;   // Normalized form (cents, ISO date, etc.)
  span?: { start: number; end: number };
  confidence?: number;
}

// =============================================================================
// EVIDENCE ANCHORS (for citations)
// =============================================================================

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

// =============================================================================
// CLAIM NODE
// =============================================================================

// =============================================================================
// ANCHOR TYPES (Industry-Agnostic Universal Slot Keys)
// =============================================================================

export type AnchorType =
  | 'MONEY'
  | 'DATE'
  | 'TIMEFRAME'
  | 'PERCENT'
  | 'QUANTITY'
  | 'ADDRESS'
  | 'EMAIL'
  | 'PHONE'
  | 'PAYMENT_CARD'
  | 'SSN_LAST4'
  | 'URL'
  | 'ID';

export interface ClaimAnchor {
  type: AnchorType;
  key: string;        // normalized canonical key (e.g., MONEY: "214.73", TIMEFRAME:"7-10_bd")
  raw?: string;       // original snippet
  span?: { start: number; end: number };
  confidence?: number;
}

export interface ClaimNode {
  id: string;                   // e.g., "c123"
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
  timestamp?: string;           // ISO
  
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
  amount?: number;              // Cents for money
  date?: string;                // ISO date
  duration?: number;            // Days/months
  percentage?: number;
  text?: string;                // Normalized text value
}

// =============================================================================
// EVIDENCE NODE
// =============================================================================

export type EvidenceKind = 'policy' | 'system_fact' | 'document' | 'kb' | 'tool_log' | 'transcript';

export interface EvidenceNode {
  id: string;                   // e.g., "e-policy-...", "e-fact-..."
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
  effectiveDate?: string;       // ISO date
  
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

// =============================================================================
// ACTION NODE
// =============================================================================

export interface ActionNode {
  id: string;                   // e.g., "a-..."
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

// =============================================================================
// TOPIC NODE (Optional, for visualization)
// =============================================================================

export interface TopicNode {
  id: string;                   // e.g., "t-billing-..."
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

// Union type for all nodes
export type GraphNode = ClaimNode | EvidenceNode | ActionNode | TopicNode;

// =============================================================================
// EDGE TYPES
// =============================================================================

export type EdgeType =
  | 'SUPPORT'         // claim -> evidence OR claim -> claim entailment
  | 'CONTRADICTION'   // claim -> claim contradiction on same slot
  | 'GROUNDING'       // claim -> transcript evidence (traceability)
  | 'ACTION_RESULT'   // claim -> action OR action -> evidence/outcome
  | 'CORRECTION';     // claim -> claim supersedes/corrects

// =============================================================================
// EDGE RATIONALE (Why this edge exists)
// =============================================================================

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

// =============================================================================
// EDGE PROVENANCE (Traceability)
// =============================================================================

export interface EdgeProvenance {
  /** Citation anchors for support/grounding */
  anchors?: EvidenceAnchor[];
  
  /** Span pairs showing what matched */
  spanPairs?: Array<{
    fromSpan: { start: number; end: number; text?: string };
    toSpan: { start: number; end: number; text?: string };
  }>;
  
  /** Source IDs (evidence IDs, log IDs) */
  sourceIds?: string[];
}

// =============================================================================
// GRAPH EDGE
// =============================================================================

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

// =============================================================================
// CANDIDATE BUDGETS (Config-driven)
// =============================================================================

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

// =============================================================================
// RUN DIAGNOSTICS (Replace "refusal")
// =============================================================================

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

// =============================================================================
// TRUTH STATES (Derived from graph, never assigned directly)
// =============================================================================

export type TruthState = 'SUPPORTED' | 'CONTRADICTED' | 'UNVERIFIED' | 'UNGROUNDED';

// =============================================================================
// CLAIM GRAPH (The complete graph structure)
// =============================================================================

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

// =============================================================================
// HELPER: Check if two slots match
// =============================================================================

export function slotsMatch(a: SubjectSlot, b: SubjectSlot): boolean {
  return a.slotType === b.slotType && a.entityKey === b.entityKey;
}

// =============================================================================
// HELPER: Check if two slots are compatible (for support edges)
// =============================================================================

export function slotsCompatible(a: SubjectSlot, b: SubjectSlot): boolean {
  // Same slot type is required
  if (a.slotType !== b.slotType) return false;
  
  // Entity keys can be different if they're in the same category
  // This allows "router_fee" to support "monthly_fee" claims
  return true;
}
