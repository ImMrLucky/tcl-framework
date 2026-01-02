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
  
  // Extracted entities
  entities: Array<{ type: string; value: string }>;
  numbers: Array<{ raw: string; value?: number; unit?: string }>;
  
  // Flags for rule engine
  hasNegation: boolean;
  hasAbsoluteLanguage: boolean;
  hasConditionalLanguage: boolean;
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
  
  // Normalized semantic content
  subject: string;         // e.g., "cancellation_fee"
  predicate: string;       // e.g., "exists", "amount", "applies"
  value: string | number | boolean | null;
  
  // Context
  conditions: string[];    // e.g., ["promo_period", "before_end"]
  timeframe?: {
    start?: string;
    end?: string;
    relative?: string;     // e.g., "this cycle", "today"
  };
  
  // Source tracking
  certainty: "stated" | "inferred";
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

