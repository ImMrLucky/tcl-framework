/**
 * Issue Types - Manager-grade QA deliverables
 * 
 * These are the PRIMARY outputs users consume.
 * Claims and edges are supporting evidence, not the main output.
 */

// ============================================================================
// CORE ENUMS
// ============================================================================

export type IssueCategory = 
  | "BILLING"
  | "DISCLOSURE"
  | "MISREPRESENTATION"
  | "PRIVACY"
  | "SECURITY"
  | "PROCESS"
  | "CUSTOMER_HARM"
  | "REGULATORY"
  | "PROMISE_BREACH"
  | "OTHER";

export type IssueSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IssueConfidence = "LOW" | "MEDIUM" | "HIGH";

export type EdgeType = "SUPPORT" | "CONTRADICTION" | "GROUNDING";

export type Speaker = "AGENT" | "CUSTOMER" | "SYSTEM";

// ============================================================================
// EVIDENCE SNIPPET
// ============================================================================

/**
 * A specific quote from the transcript with full context.
 * This is what managers see as "proof".
 */
export interface EvidenceSnippet {
  /** Speaker who said this */
  speaker: Speaker;
  /** Exact quote from transcript */
  quote: string;
  /** Turn index in conversation */
  turnIndex: number;
  /** Timestamp if available (ms from start) */
  timestampMs?: number;
  /** Link to the source claim */
  claimId: string;
  /** Optional notes (e.g., "Contradicts policy section 4.2") */
  notes?: string;
  /** Highlight spans within the quote */
  highlights?: Array<{ start: number; end: number; label?: string }>;
}

// ============================================================================
// ISSUE METRICS
// ============================================================================

/**
 * All metrics are DERIVED from data - no hard-coded values.
 * Used to justify ranking and severity.
 */
export interface IssueMetrics {
  /** Sum of contradiction edge scores within this issue */
  contradictionMass: number;
  /** Sum of support edge scores within this issue */
  supportMass: number;
  /** Sum of grounding edge scores (0 = ungrounded) */
  groundingMass: number;
  /** Graph centrality of claims in this issue */
  centrality: number;
  /** Scope: number of claims involved */
  claimCount: number;
  /** Scope: number of conversation turns spanned */
  turnSpan: number;
  /** Recency weight (higher = more recent in conversation) */
  recencyWeight: number;
  /** Final computed risk score (0-100) */
  riskScore: number;
  /** Rank among all issues (1 = highest risk) */
  rank: number;
  /** Human-readable drivers explaining the risk score */
  drivers: string[];
}

// ============================================================================
// ISSUE (THE CORE UNIT MANAGERS CONSUME)
// ============================================================================

/**
 * Issue / Problem Statement
 * 
 * This is the PRIMARY output. Each issue is a complete, actionable finding
 * that a QA manager can review, understand, and act on.
 */
export interface Issue {
  /** Unique identifier */
  id: string;
  
  // ---- HEADER ----
  /** Clear, specific title following format: "<Issue Type> about <Topic>" */
  title: string;
  /** Category for filtering and routing */
  category: IssueCategory;
  /** Severity level (config-driven, not hard-coded) */
  severity: IssueSeverity;
  /** Model confidence in this finding */
  confidence: IssueConfidence;
  
  // ---- NARRATIVE ----
  /** 1-3 sentence plain English summary: what happened, where, why it matters */
  problemStatement: string;
  /** Bullet points explaining why this is wrong */
  whyWrong: string[];
  /** Business impact / risk explanation */
  impact: string;
  /** Bullet points for recommended actions (coaching, compliance, policy) */
  recommendedAction: string[];
  /** Why the model has this confidence level */
  confidenceExplanation: string;
  
  // ---- EVIDENCE ----
  /** Primary evidence snippets (top 2-5 most relevant) */
  primaryEvidence: EvidenceSnippet[];
  /** Supporting evidence (additional context) */
  supportingEvidence: EvidenceSnippet[];
  
  // ---- LINKAGE ----
  /** IDs of claims involved in this issue */
  relatedClaimIds: string[];
  /** IDs of edges involved in this issue */
  relatedEdgeIds: string[];
  
  // ---- METRICS ----
  /** All derived metrics for this issue */
  metrics: IssueMetrics;
  
  // ---- TAGS & METADATA ----
  /** Topic tags for filtering (e.g., "Cancellation", "Promo period", "Refund") */
  tags: string[];
  /** When this issue was created */
  createdAt: string;
  
  // ---- FLAGS (for escalation rules) ----
  flags?: {
    sensitiveData?: boolean;
    financialImpact?: boolean;
    policyConflict?: boolean;
    regulatoryRisk?: boolean;
    explicitCommitment?: boolean;
  };
}

// ============================================================================
// EDGE (Enhanced for issue linkage)
// ============================================================================

/**
 * Edge between claims with full rationale.
 */
export interface Edge {
  id: string;
  type: EdgeType;
  fromClaimId: string;
  toClaimId: string;
  /** Score 0-1 */
  score: number;
  /** Short text explanation from model/rules */
  rationale: string;
  /** References to policy docs, KB chunks, etc. */
  evidenceRefIds?: string[];
}

// ============================================================================
// CLAIM (Enhanced for issue clustering)
// ============================================================================

/**
 * Claim with enhanced fields for clustering.
 */
export interface ClaimForClustering {
  id: string;
  speaker: Speaker;
  text: string;
  turnIndex: number;
  startMs?: number;
  endMs?: number;
  topics?: string[];
  entities?: Array<{ type: string; value: string }>;
  /** Normalized text for similarity comparison */
  normalizedText?: string;
  /** Embedding vector (if computed) */
  embedding?: number[];
}

// ============================================================================
// RUN SUMMARY (Executive view)
// ============================================================================

/**
 * Executive summary for the run.
 */
export interface RunSummary {
  /** Total issues found */
  totalIssues: number;
  /** Count by severity */
  bySeverity: Record<IssueSeverity, number>;
  /** Count by category */
  byCategory: Record<IssueCategory, number>;
  /** Primary risk categories (top 3) */
  primaryRiskCategories: IssueCategory[];
  /** Is this run audit-ready? (all hashes present, reproducible) */
  auditReady: boolean;
  /** Why not audit ready (if applicable) */
  auditReadyReason?: string;
}

// ============================================================================
// REPRODUCIBILITY
// ============================================================================

/**
 * All hashes and versions needed to reproduce a run.
 */
export interface RunReproducibility {
  /** Run unique ID */
  runId: string;
  /** Hash of normalized transcript input */
  inputHash: string;
  /** Hash of risk.model config + thresholds */
  configHash: string;
  /** Git commit hash (injected at build) */
  codeVersion: string;
  /** ProtectQA engine version */
  engineVersion: string;
  /** Model fingerprint (name + version + checksum) */
  modelFingerprint: string;
  /** Timestamp */
  createdAt: string;
}

// ============================================================================
// ISSUE NARRATIVE (QA Manager Grade - New Spec)
// ============================================================================

/**
 * IssueNarrative - The new QA-manager-grade finding format.
 * Replaces the generic Issue type with specific fields for audit-ready findings.
 */
/** Support basis for a claim - where is it supported from? */
export type SupportBasis = 'TRANSCRIPT' | 'EXTERNAL' | 'NONE';

/** Verification level based on available evidence */
export type VerificationLevel = 'TRANSCRIPT_ONLY' | 'EXTERNALLY_VERIFIED';

export interface IssueNarrative {
  issueId: string;
  category: string;              // e.g., BILLING
  subcategory?: string;          // e.g., Cancellation Fees
  title: string;                 // human-friendly (no "discrepancy about X and Y")
  severity: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
  confidence: "LOW"|"MEDIUM"|"HIGH";
  status: "OPEN"|"RESOLVED"|"DISMISSED";
  
  // FIX C: Support basis and verification level
  /** Where the claims are supported from */
  supportBasis: SupportBasis;
  /** Verification level based on available evidence */
  verificationLevel: VerificationLevel;
  
  scope: {
    turnRange: [number, number];
    claimIds: string[];
    speakerFocus: "AGENT"|"SYSTEM"|"CUSTOMER"; // default "AGENT"
  };
  
  whatIsWrong: string;           // 1–3 sentences, specific
  whyWrong: string[];            // bullet reasons (policy/logic)
  whyItMatters: string[];        // business impact bullets
  
  recommendedActions: Array<{
    type: "COACHING"|"PROCESS"|"COMPLIANCE"|"SYSTEM_FIX";
    action: string;
  }>;
  
  evidenceQuotes: Array<{
    quoteId: string;
    claimId: string;
    speaker: "Agent"|"Customer"|"System";
    turnIndex: number;
    lineSpan?: [number, number];
    text: string;                // exact quote (not truncated)
    evidenceRef?: { type:"Call"|"Policy"|"KB"; ref: string; };
  }>;
  
  contradictionPairs?: Array<{
    claimAId: string;
    claimBId: string;
    score: number;
    explanation: string;         // auto-generated: "These cannot both be true because…"
    quoteIds: [string, string];  // references into evidenceQuotes
  }>;
  
  traceability: {
    topEdges: Array<{
      type: "support"|"contradiction"|"grounding";
      fromClaimId: string;
      toClaimId: string;
      weight: number;
      reason?: string;
    }>;
  };
  
  scoring: {
    riskScore: number;           // 0–100 (configurable mapping)
    impactScore: number;         // 0–100
    fixabilityScore: number;     // 0–100
    compositeScore: number;      // used for ranking
    rationale: string[];         // bullet explanation of score drivers
  };
}

// ============================================================================
// FULL RUN OUTPUT
// ============================================================================

/**
 * Complete output for a run - what gets exported.
 */
export interface IssueAnalysisOutput {
  /** Executive summary */
  summary: RunSummary;
  /** Ranked list of issues (primary output) */
  issues: Issue[];
  /** Ranked list of issue narratives (new QA-manager-grade format) */
  narratives?: IssueNarrative[];
  /** All claims (supporting data) */
  claims: ClaimForClustering[];
  /** All edges (supporting data) */
  edges: Edge[];
  /** Reproducibility metadata */
  reproducibility: RunReproducibility;
  /** Processing time in ms */
  processingTimeMs: number;
}

