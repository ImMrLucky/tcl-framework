/**
 * Data types for the deterministic truth graph engine.
 */

export type Modality = 
  | "absolute"      // "You will never be charged" 
  | "conditional"   // "There may be a fee if..."
  | "informational" // "Your plan is..."
  | "question"      // "Can I cancel?"
  | "request"       // "Can you send me..."
  | "apology";      // "I apologize for..."

export type Polarity = "affirm" | "deny" | "unknown";

export type Speaker = "agent" | "customer" | "system";

/**
 * Claim kind for contradiction gating
 */
export type ClaimKind = 
  | "assertion"  // Factual statement that can be contradicted
  | "intent"     // "I want to...", "I'd like to..." - customer goals
  | "question"   // Ends with "?" or interrogative
  | "meta"       // References docs/agreements, conversation control
  | "emotion"    // Expresses feelings: frustrated, upset, confused
  | "promise"    // Agent commitment: "I will...", "I'll send..."
  | "unknown";   // Fallback

/**
 * Intent classification for request fulfillment
 */
export type Intent = 
  | "send_document"
  | "email"
  | "call_back"
  | "refund"
  | "cancel"
  | "change_plan"
  | "unknown";

/**
 * Enhanced Claim with deterministic classification.
 */
export interface EnhancedClaim {
  id: string;
  speaker: Speaker;
  text: string;
  turnIndex: number;
  timestamp?: string;
  
  // Deterministic classifications
  modality: Modality;
  polarity: Polarity;
  topics: string[];
  claimKind: ClaimKind;      // NEW: For contradiction gating
  intent?: Intent;            // NEW: For request fulfillment detection
  
  // Extracted entities
  entities: Array<{ type: string; value: string }>;
  numbers: Array<{ raw: string; value?: number; unit?: string }>;
  
  // Flags for rule engine
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
  bucket: string;           // e.g., "this_cycle", "last_cycle", "today", "promo_period"
  startEpoch?: number;      // Unix timestamp if explicit date
  endEpoch?: number;        // Unix timestamp if explicit date
  relative?: string;       // Original relative phrase for display
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
  
  // Original semantic content
  subject: string;         // e.g., "cancellation_fee"
  predicate: string;      // e.g., "exists", "amount", "applies"
  value: string | number | boolean | null;
  
  // NEW: Normalized fields for semantic comparison
  subjectNormalized: string;      // Normalized subject (synonym-resolved)
  predicateNormalized: string;    // Normalized predicate (synonym-resolved)
  valueType: ValueType;           // Semantic type of value
  normalizedValue: string | number | boolean | null;  // Normalized value for comparison
  polarity: Polarity;              // Separate from truthiness: 'affirm' | 'deny' | 'unknown'
  certainty: CertaintyLevel;      // Derived from modality: 'high' | 'medium' | 'low'
  
  // Context
  conditions: string[];    // e.g., ["promo_period", "before_end"]
  timeframe?: {
    start?: string;
    end?: string;
    relative?: string;     // e.g., "this cycle", "today"
  };
  timeframeNormalized?: TimeframeNormalized;  // NEW: Canonical timeframe for overlap detection
  
  // Source tracking
  sourceCertainty: "stated" | "inferred";  // Renamed from certainty to avoid conflict
  sourceSpan?: { start: number; end: number };
}

/**
 * Edge types for the truth graph.
 */
export type EdgeType = "support" | "contradiction" | "grounding" | "structure";

export type EdgeProvenance = "rules" | "retrieval" | "structure";

/**
 * Contradiction type for gating
 */
export type TruthEdgeContradictionType = 
  | "direct"         // Real semantic contradiction
  | "topic_mismatch" // Different topics, not a real contradiction  
  | "low_overlap"    // Insufficient topic overlap
  | "needs_review";  // Uncertain, flag for human review

/**
 * Rule-based edge with full provenance.
 */
export interface TruthEdge {
  id: string;
  type: EdgeType;
  srcId: string;           // claimId
  dstId: string;           // claimId or evidenceChunkId
  weight: number;          // 0..1, computed deterministically
  
  // Auditability
  reason: string;          // Human-readable explanation
  ruleId: string;          // Stable identifier for auditing
  provenance: EdgeProvenance;
  
  // NEW: Contradiction classification for gating
  contradictionType?: TruthEdgeContradictionType;
  overlapScore?: number;   // Topic overlap (0-1)
  reasonCodes?: string[];  // e.g., ["KIND_INTENT", "LOW_OVERLAP"]
  
  // Optional metadata for detailed analysis
  metadata?: {
    subject?: string;
    predicate?: string;
    polarityConflict?: boolean;
    modalityShift?: boolean;
    timeframeOverlap?: boolean;
    topic?: string;
    srcText?: string;
    dstText?: string;
    // NEW: Additional metadata fields
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
  // Nodes
  claims: EnhancedClaim[];
  facts: Fact[];
  evidenceChunks?: EvidenceChunk[];
  
  // Edges by type
  contradictionEdges: TruthEdge[];
  supportEdges: TruthEdge[];
  groundingEdges: TruthEdge[];
  structureEdges: TruthEdge[];
  
  // Metadata
  inputHash: string;
  configHash: string;
  codeVersion: string;
  generatedAt: string;
  
  // Stats
  stats: {
    claimCount: number;
    factCount: number;
    edgeCounts: Record<EdgeType, number>;
    rulesApplied: string[];
    processingTimeMs: number;
  };
}

