import { createHash } from "crypto";
import type { Claim, SpectralReport, ValidateOutput } from "../../types.js";
import type { ExtractedClaim, ClaimType } from "../../claim_extractor.js";
import { 
  extractRiskSignals, 
  computeRiskScore, 
  determineIssueType,
  getDefaultRiskConfig,
  type RiskSignals,
  type IssueType
} from "../../risk_scoring.js";

// ============================================================================
// TYPES: Defensible Issue Objects
// ============================================================================

/**
 * Defensible Issue Object
 * 
 * Each issue must answer:
 * - What: What exactly is inconsistent or unsupported?
 * - Who: Who made the claim?
 * - Where: Where did it occur (turn / timestamp)?
 * - Conflict: What does it conflict with?
 * - Risk: Why is this a risk?
 * - Confidence: How confident is this assessment?
 */
export interface DefensibleIssue {
  // Identity
  issueId: string;
  claimId: string;
  evaluationId?: string;
  
  // WHAT: What exactly is the problem?
  what: {
    claimText: string;
    claimSummary: string; // Truncated version for table display
    issueType: IssueType; // All issue types from risk_scoring.ts
    truthState: "Contradicted" | "Supported" | "Ungrounded" | "Inconclusive";
    description: string; // Short human-readable description
    whyFlagged: string; // Detailed explanation of why this was flagged
    claimType?: ClaimType; // Speech-act type (PROMISE, ASSERTION, etc.)
  };
  
  // WHO: Who made the claim?
  who: {
    speaker: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
    speakerLabel?: string; // "Agent Smith", "Customer", etc.
  };
  
  // WHERE: When/where did it occur?
  where: {
    turnStartIdx?: number;
    turnEndIdx?: number;
    timestampStartMs?: number;
    timestampEndMs?: number;
    excerpt?: string; // Context excerpt
  };
  
  // CONFLICT: What does it conflict with?
  conflictsWith: Array<{
    claimId: string;
    claimText: string;
    relationshipType: "contradiction" | "unsupported_by" | "circular_with";
    edgeWeight: number;
  }>;
  
  // RISK: Why is this a problem?
  risk: {
    severity: "critical" | "high" | "medium" | "low";
    category: string; // "compliance", "accuracy", "consistency", etc.
    explanation: string; // Why this matters
    policyRuleIds?: string[];
  };
  
  // CONFIDENCE: How certain is this assessment?
  confidence: {
    nodeBlameNorm: number; // 0-1, from spectral analysis
    importance: number; // Composite importance score
    nliScore?: number; // If NLI was used to detect
    groundingScore?: number; // Evidence grounding score
  };
  
  // AUDIT: Workflow status
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_POSITIVE";
  statusChangedAt?: string;
  statusChangedBy?: string;
  notes?: string;
}

/**
 * Immutable Evaluation Manifest
 * 
 * Once created, an evaluation is FROZEN and cannot be modified.
 * Any changes require creating a NEW evaluation with a new ID.
 * 
 * This manifest contains everything needed to:
 * - Reproduce the exact same analysis
 * - Verify the integrity of the evaluation
 * - Trace the provenance of all outputs
 * - Defend the results in an audit
 */
export interface ImmutableEvaluationManifest {
  // IDENTITY
  evaluationId: string;
  mode: "EVALUATION" | "SIMULATION"; // EVALUATION = immutable, SIMULATION = what-if
  parentEvaluationId?: string; // If SIMULATION, links to the original
  
  // PROVENANCE: When and by whom
  provenance: {
    createdAt: string; // ISO timestamp
    createdBy?: string; // User ID
    orgId: string;
    projectId: string;
    env: "sandbox" | "production";
  };
  
  // SOURCE: What was analyzed
  source: {
    conversationId: string;
    sourceType: "transcript" | "chat" | "document" | "api";
    sourceHash: string; // SHA256 of raw input
    sourceTitle?: string;
    externalId?: string; // External system reference
  };
  
  // FROZEN INPUTS: The exact claims and graph used
  frozenInputs: {
    inputHash: string; // SHA256 of canonical (claims + edges + grounded)
    claims: Array<{
      id: string;
      text: string;
      speaker: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
      turnStartIdx?: number;
      turnEndIdx?: number;
      timestampStartMs?: number;
      timestampEndMs?: number;
      tags: string[];
    }>;
    supports: Array<{
      claimA: string;
      claimB: string;
      weight: number;
      source: "nli" | "rule" | "manual";
    }>;
    contradictions: Array<{
      claimA: string;
      claimB: string;
      weight: number;
      source: "nli" | "rule" | "manual";
    }>;
    grounded: string[];
    groundingSources?: Array<{
      id: string;
      text: string;
      type: "policy" | "evidence" | "reference";
    }>;
  };
  
  // FROZEN CONFIG: The exact engine configuration used
  frozenConfig: {
    configHash: string; // SHA256 of config
    engineName: string;
    engineVersion: string;
    codeVersion: string;
    modelFingerprint: {
      claimExtractor: string;
      nliModel: string;
      embeddingModel?: string;
    };
    parameters: {
      wSupport: number;
      wContradiction: number;
      wCircularity: number;
      cycleMaxLen: number;
      alpha?: number;
      tau?: number;
    };
  };
  
  // FROZEN OUTPUTS: The exact spectral analysis results
  frozenOutputs: {
    spectral: {
      coherenceScore: number;
      contradictionEnergy: number;
      supportEnergy: number;
      circularityScore: number;
      spectralGap: number;
      cycleMass: number;
      heatTrace: number[];
      truthVector: number[];
      truthStates: string[];
      nodeBlame: number[];
      nodeBlameNorm: number[];
    };
    counts: {
      claims: number;
      contradicted: number;
      ungrounded: number;
      supported: number;
      inconclusive: number;
    };
    fingerprint: {
      coherenceScore: number;
      spectralGap: number;
      contradictionEnergy: number;
      circularityScore: number;
      heatTrace: number[];
    };
  };
  
  // ISSUES: The defensible issue objects
  issues: DefensibleIssue[];
  
  // METADATA
  latencyMs: number;
  expiresAt?: string; // Optional expiration for SIMULATION mode
}

/**
 * Build an immutable evaluation manifest
 */
export function buildImmutableManifest(
  evaluationId: string,
  conversationId: string,
  context: { orgId: string; projectId: string; env: string; userId?: string },
  claims: Array<{ id: string; text: string; speaker?: string; turnIndex?: number; timestampMs?: number; tags?: string[] }>,
  supports: Array<{ claimA: string; claimB: string; weight?: number; source?: string }>,
  contradictions: Array<{ claimA: string; claimB: string; weight?: number; source?: string }>,
  grounded: string[],
  config: { wSupport?: number; wContradiction?: number; wCircularity?: number; cycleMaxLen?: number; alpha?: number; tau?: number },
  spectral: SpectralReport,
  issues: DefensibleIssue[],
  latencyMs: number,
  options?: { mode?: "EVALUATION" | "SIMULATION"; parentEvaluationId?: string; sourceTitle?: string; externalId?: string }
): ImmutableEvaluationManifest {
  const inputHash = computeInputHash(claims, supports, contradictions, grounded);
  const configHash = computeConfigHash(config);
  
  // Compute source hash from claims text
  const sourceContent = claims.map(c => c.text).join("\n");
  const sourceHash = createHash('sha256').update(sourceContent).digest('hex');
  
  return {
    evaluationId,
    mode: options?.mode || "EVALUATION",
    parentEvaluationId: options?.parentEvaluationId,
    
    provenance: {
      createdAt: new Date().toISOString(),
      createdBy: context.userId,
      orgId: context.orgId,
      projectId: context.projectId,
      env: context.env as "sandbox" | "production"
    },
    
    source: {
      conversationId,
      sourceType: "transcript",
      sourceHash,
      sourceTitle: options?.sourceTitle,
      externalId: options?.externalId
    },
    
    frozenInputs: {
      inputHash,
      claims: claims.map(c => ({
        id: c.id,
        text: c.text,
        speaker: (c.speaker === "AGENT" || c.speaker === "Agent" ? "AGENT" :
                  c.speaker === "CUSTOMER" || c.speaker === "Customer" ? "CUSTOMER" :
                  c.speaker === "SYSTEM" || c.speaker === "System" ? "SYSTEM" : "UNKNOWN") as any,
        turnStartIdx: c.turnIndex,
        turnEndIdx: c.turnIndex,
        timestampStartMs: c.timestampMs,
        tags: c.tags || []
      })),
      supports: supports.map(s => ({
        claimA: s.claimA,
        claimB: s.claimB,
        weight: s.weight || 1.0,
        source: (s.source || "nli") as "nli" | "rule" | "manual"
      })),
      contradictions: contradictions.map(c => ({
        claimA: c.claimA,
        claimB: c.claimB,
        weight: c.weight || 1.0,
        source: (c.source || "nli") as "nli" | "rule" | "manual"
      })),
      grounded
    },
    
    frozenConfig: {
      configHash,
      engineName: "tcl-spectral",
      engineVersion: getEngineVersion(),
      codeVersion: getCodeVersion(),
      modelFingerprint: getModelFingerprint(),
      parameters: {
        wSupport: config.wSupport ?? 1.0,
        wContradiction: config.wContradiction ?? 1.0,
        wCircularity: config.wCircularity ?? 1.0,
        cycleMaxLen: config.cycleMaxLen ?? 4,
        alpha: config.alpha,
        tau: config.tau
      }
    },
    
    frozenOutputs: {
      spectral: {
        coherenceScore: spectral.coherenceScore || 0,
        contradictionEnergy: spectral.contradictionEnergy || 0,
        supportEnergy: spectral.supportEnergy || 0,
        circularityScore: spectral.circularityScore || 0,
        spectralGap: spectral.spectralGap || 0,
        cycleMass: spectral.cycleMass || 0,
        heatTrace: spectral.heatTrace || [],
        truthVector: spectral.truthVector || [],
        truthStates: spectral.truthStates || [],
        nodeBlame: spectral.nodeBlame || [],
        nodeBlameNorm: spectral.nodeBlameNorm || []
      },
      counts: {
        claims: claims.length,
        contradicted: issues.filter(i => i.what.truthState === "Contradicted").length,
        ungrounded: issues.filter(i => i.what.truthState === "Ungrounded").length,
        supported: claims.length - issues.length, // Approximate
        inconclusive: issues.filter(i => i.what.truthState === "Inconclusive").length
      },
      fingerprint: {
        coherenceScore: spectral.coherenceScore || 0,
        spectralGap: spectral.spectralGap || 0,
        contradictionEnergy: spectral.contradictionEnergy || 0,
        circularityScore: spectral.circularityScore || 0,
        heatTrace: spectral.heatTrace || []
      }
    },
    
    issues,
    latencyMs,
    expiresAt: options?.mode === "SIMULATION" 
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days for simulations
      : undefined
  };
}

// ============================================================================
// FUNCTIONS: Hashing and Versioning
// ============================================================================

/**
 * Canonicalize and hash the input payload (claims + edges + grounded)
 */
export function computeInputHash(
  claims: Array<{ id: string; text: string }>,
  supports: Array<{ claimA: string; claimB: string; weight?: number }>,
  contradictions: Array<{ claimA: string; claimB: string; weight?: number }>,
  grounded: string[]
): string {
  // Sort claims by id for stable ordering
  const sortedClaims = [...claims].sort((a, b) => a.id.localeCompare(b.id));
  
  // Sort edges by (claimA, claimB, weight) for stable ordering
  const sortedSupports = [...supports].sort((a, b) => {
    if (a.claimA !== b.claimA) return a.claimA.localeCompare(b.claimA);
    if (a.claimB !== b.claimB) return a.claimB.localeCompare(b.claimB);
    return (a.weight || 0) - (b.weight || 0);
  });
  
  const sortedContradictions = [...contradictions].sort((a, b) => {
    if (a.claimA !== b.claimA) return a.claimA.localeCompare(b.claimA);
    if (a.claimB !== b.claimB) return a.claimB.localeCompare(b.claimB);
    return (a.weight || 0) - (b.weight || 0);
  });
  
  // Sort grounded claim IDs
  const sortedGrounded = [...grounded].sort();
  
  // Create canonical JSON (stable key ordering)
  const canonical = JSON.stringify({
    claims: sortedClaims,
    supports: sortedSupports,
    contradictions: sortedContradictions,
    grounded: sortedGrounded
  });
  
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Canonicalize and hash the config
 */
export function computeConfigHash(config: {
  wSupport?: number;
  wContradiction?: number;
  wCircularity?: number;
  cycleMaxLen?: number;
  alpha?: number;
  tau?: number;
  [key: string]: any;
}): string {
  // Sort keys for stable ordering
  const sortedConfig: Record<string, any> = {};
  const keys = Object.keys(config).sort();
  for (const key of keys) {
    if (config[key] !== undefined) {
      sortedConfig[key] = config[key];
    }
  }
  
  const canonical = JSON.stringify(sortedConfig);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Get engine version from environment or default
 */
export function getEngineVersion(): string {
  return process.env.ENGINE_VERSION || '0.3.0';
}

/**
 * Get code version (git commit SHA or build version)
 */
export function getCodeVersion(): string {
  return process.env.CODE_VERSION || process.env.GIT_SHA || 'unknown';
}

/**
 * Get model fingerprint
 */
export function getModelFingerprint(): {
  claimExtractor: string;
  nliModel: string;
  embeddingModel?: string;
} {
  return {
    claimExtractor: process.env.CLAIM_EXTRACTOR_VERSION || 'v1',
    nliModel: process.env.NLI_MODEL || 'transformers@roberta-large-mnli',
    embeddingModel: process.env.EMBEDDING_MODEL
  };
}

/**
 * Calculate importance score for an issue
 */
export function calculateImportance(params: {
  nodeBlameNorm?: number;
  truthState?: "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
  speaker?: string;
  hasPolicyTag?: boolean;
  claimConfidence?: number;
}): number {
  const { nodeBlameNorm = 0, truthState, speaker, hasPolicyTag = false, claimConfidence } = params;
  
  // Base importance - if no nodeBlameNorm, use truth state and other factors
  let baseImportance = nodeBlameNorm;
  
  // If nodeBlameNorm is 0 or undefined (spectral skipped), compute a base importance from truth state
  if (!nodeBlameNorm || nodeBlameNorm < 0.01) {
    // Use truth state as primary signal
    baseImportance = {
      "Contradicted": 0.85,    // High base importance
      "Ungrounded": 0.65,      // Medium-high base importance
      "Inconclusive": 0.35,    // Medium base importance
      "Supported": 0.15        // Low base importance (shouldn't be an issue)
    }[truthState || "Inconclusive"] || 0.35;
    
    // Reduce if claim has high confidence (more likely to be correct)
    if (claimConfidence !== undefined && claimConfidence > 0.8) {
      baseImportance *= 0.85;
    }
  }
  
  // Truth state multipliers (still apply as adjustment)
  const truthStateMultiplier = {
    "Contradicted": 1.35,
    "Ungrounded": 1.15,
    "Inconclusive": 1.05,
    "Supported": 0.75
  }[truthState || "Inconclusive"] || 1.0;
  
  // Agent multiplier - agent statements are more important for compliance
  const agentMultiplier = speaker === "AGENT" ? 1.15 : 1.0;
  
  // Policy multiplier - policy-related issues are more important
  const policyMultiplier = hasPolicyTag ? 1.25 : 1.0;
  
  // Calculate final importance, capped at 1.0
  const raw = baseImportance * truthStateMultiplier * agentMultiplier * policyMultiplier;
  return Math.min(1.0, raw);
}

/**
 * Generate a unique issue ID
 */
function generateIssueId(claimId: string, evaluationId?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `issue_${claimId}_${timestamp}_${random}`;
}

/**
 * Get severity based on truth state and issue type
 */
function getSeverity(
  truthState: string,
  issueType: string,
  nodeBlameNorm: number
): "critical" | "high" | "medium" | "low" {
  if (issueType === "POLICY_VIOLATION" && truthState === "Contradicted") {
    return "critical";
  }
  if (truthState === "Contradicted" || issueType === "POLICY_VIOLATION") {
    return "high";
  }
  if (truthState === "Ungrounded" || issueType === "POLICY_MISS" || nodeBlameNorm > 0.7) {
    return "medium";
  }
  return "low";
}

/**
 * Generate human-readable issue description (short summary)
 */
function generateIssueDescription(
  truthState: string,
  issueType: string,
  speaker: string,
  conflictsCount: number
): string {
  const speakerLabel = speaker === "AGENT" ? "Agent" : 
                       speaker === "CUSTOMER" ? "Customer" : "Speaker";
  
  switch (issueType) {
    case "CONTRADICTION":
      return `${speakerLabel} statement contradicts ${conflictsCount > 1 ? `${conflictsCount} other claims` : 'another claim'}`;
    case "UNSUPPORTED":
      return `${speakerLabel} claim has no supporting evidence in policy documents`;
    case "UNVERIFIED":
      return `${speakerLabel} claim cannot be verified (no external documents available)`;
    case "CIRCULAR":
      return `Circular reasoning detected - claims support each other without external evidence`;
    case "POLICY_VIOLATION":
      return `${speakerLabel} statement violates policy rules`;
    case "POLICY_MISS":
      return `Required policy disclosure may be missing`;
    case "VAGUE_LANGUAGE":
      return `${speakerLabel} used ambiguous language that could mislead`;
    case "LATE_DISCLAIMER":
      return `Important disclaimer provided late in the conversation`;
    case "PROMISE_RISK":
      return `${speakerLabel} made a commitment that should be verified`;
    case "ABSOLUTE_CLAIM":
      return `${speakerLabel} used absolute language (always, never, guaranteed)`;
    default:
      return `Issue detected requiring review`;
  }
}

/**
 * Generate a specific "Why Flagged" explanation that includes conflict details
 */
function generateWhyFlagged(
  issueType: string,
  speaker: string,
  claimText: string,
  conflicts: Array<{ claimId: string; claimText: string; relationshipType: string; edgeWeight: number }>
): string {
  const claimSummary = claimText.length > 80 ? claimText.substring(0, 77) + "..." : claimText;
  
  if (issueType === "CONTRADICTION" && conflicts.length > 0) {
    // Find the strongest contradiction
    const strongestConflict = conflicts
      .filter(c => c.relationshipType === "contradiction")
      .sort((a, b) => b.edgeWeight - a.edgeWeight)[0];
    
    if (strongestConflict) {
      const conflictText = strongestConflict.claimText.length > 100 
        ? strongestConflict.claimText.substring(0, 97) + "..." 
        : strongestConflict.claimText;
      return `Directly contradicted by: "${conflictText}"`;
    }
    return `Contradicts ${conflicts.length} other statement(s) in the conversation`;
  }
  
  if (issueType === "UNSUPPORTED") {
    return `No grounding in policy documents or verified sources`;
  }
  
  if (issueType === "UNVERIFIED") {
    return `Cannot be verified against policy/account documents (transcript-only mode)`;
  }
  
  if (issueType === "CIRCULAR") {
    return `Part of circular reasoning chain - claims mutually support without independent verification`;
  }
  
  if (issueType === "POLICY_VIOLATION") {
    return `Statement conflicts with established policy guidelines`;
  }
  
  if (issueType === "POLICY_MISS") {
    return `Required disclosure not provided to customer`;
  }
  
  if (issueType === "VAGUE_LANGUAGE") {
    return `Vague language increases risk of customer misunderstanding`;
  }
  
  if (issueType === "LATE_DISCLAIMER") {
    return `Important disclaimer/caveat provided late in conversation`;
  }
  
  if (issueType === "PROMISE_RISK") {
    return `Agent commitment requires verification and tracking`;
  }
  
  if (issueType === "ABSOLUTE_CLAIM") {
    return `Absolute language ("always", "never", "guaranteed") may be difficult to defend`;
  }
  
  return `Claim requires verification or supporting evidence`;
}

/**
 * Generate risk explanation
 */
function generateRiskExplanation(
  issueType: string,
  severity: string,
  speaker: string
): string {
  const agentContext = speaker === "AGENT" ? " by an agent" : "";
  
  switch (issueType) {
    case "CONTRADICTION":
      return `Contradictory statements${agentContext} can undermine customer trust, create liability exposure, and may indicate miscommunication or intentional misinformation.`;
    case "UNSUPPORTED":
      return `Unsupported claims${agentContext} may expose the organization to liability if later proven false. They cannot be defended in an audit or legal proceeding.`;
    case "UNVERIFIED":
      return `This claim cannot be verified against external documents. It is grounded only in the transcript. In transcript-only mode, this is expected for many claims.`;
    case "CIRCULAR":
      return `Circular reasoning creates an illusion of support without genuine evidence. This is particularly problematic in compliance contexts where claims must be independently verifiable.`;
    case "POLICY_VIOLATION":
      return `Policy violations${agentContext} can result in regulatory penalties, customer complaints, and organizational liability.`;
    case "POLICY_MISS":
      return `Missing required disclosures${agentContext} may constitute regulatory non-compliance and could expose the organization to penalties.`;
    case "VAGUE_LANGUAGE":
      return `Vague or ambiguous statements${agentContext} can lead to customer misunderstanding and disputes. Clear, specific language is preferred.`;
    case "LATE_DISCLAIMER":
      return `Disclaimers and caveats should be provided early in conversations. Late disclaimers may not adequately inform the customer before decisions are made.`;
    case "PROMISE_RISK":
      return `Agent commitments and promises require tracking to ensure fulfillment. Unfulfilled promises can damage customer relationships and create liability.`;
    case "ABSOLUTE_CLAIM":
      return `Statements using absolute language ("always", "never", "guaranteed") are difficult to defend if exceptions exist. More qualified language is advisable.`;
    default:
      return `This issue may affect the reliability and defensibility of the conversation record.`;
  }
}

/**
 * Build issues list from spectral output and claims
 * Creates fully defensible issue objects that answer all required questions
 * 
 * KEY CHANGES:
 * - Uses new risk_scoring.ts for computed severity (NO hard-coded values)
 * - Uses UNVERIFIED for transcript-only mode (no external docs)
 * - Filters out non-auditable claims (QUESTION, ACKNOWLEDGEMENT, FILLER)
 * - Severity varies based on actual signals, not hard-coded rules
 */
export function buildIssuesList(
  spectral: SpectralReport,
  claims: Array<Claim & { 
    meta?: { speaker?: string; turnIndex?: number; timestampMs?: number };
    // Extended claim fields from claim_extractor
    claimType?: ClaimType;
    isAuditable?: boolean;
    topicTags?: string[];
    hasAbsoluteLanguage?: boolean;
    hasMoney?: boolean;
  }>,
  destructiveClaims?: Array<{ claimId: string; importance: number; [key: string]: any }>,
  evaluationId?: string,
  options?: {
    hasExternalDocs?: boolean;
    contradictions?: Array<{ claimA: string; claimB: string; weight: number }>;
    supports?: Array<{ claimA: string; claimB: string; weight: number }>;
    grounding?: Array<{ claimId: string; sourceId: string; weight: number; quote?: string }>;
    totalTurns?: number;
  }
): DefensibleIssue[] {
  const issues: DefensibleIssue[] = [];
  const claimMap = new Map(claims.map(c => [c.id, c]));
  
  // Build claim text lookup for conflicts
  const claimTextMap = new Map(claims.map(c => [c.id, c.text]));
  
  // Get spectral data
  const truthStates = spectral.truthStates || [];
  const nodeBlameNorm = spectral.nodeBlameNorm || [];
  const topBadContradictions = spectral.topBadContradictions || [];
  const topBadSupports = spectral.topBadSupports || [];
  
  // Check if we have valid spectral data
  const hasSpectralData = truthStates.length > 0 || nodeBlameNorm.length > 0;
  
  // Config for risk scoring
  const riskConfig = getDefaultRiskConfig();
  
  // Check if we have external docs (affects issue type: UNSUPPORTED vs UNVERIFIED)
  const hasExternalDocs = options?.hasExternalDocs ?? false;
  const contradictionsFromGraph = options?.contradictions || [];
  const supportsFromGraph = options?.supports || [];
  const groundingFromGraph = options?.grounding || [];
  const totalTurns = options?.totalTurns || claims.length;
  
  // CRITICAL: Build grounding score lookup from actual graph edges (NOT hard-coded)
  // This maps each claimId to its max grounding weight from NLI scoring
  const groundingScoreByClaimId = new Map<string, number>();
  for (const gnd of groundingFromGraph) {
    const existing = groundingScoreByClaimId.get(gnd.claimId) || 0;
    groundingScoreByClaimId.set(gnd.claimId, Math.max(existing, gnd.weight));
  }
  console.log(`📊 Grounding scores from ${groundingFromGraph.length} edges:`, 
    Array.from(groundingScoreByClaimId.entries()).slice(0, 5));
  
  // Build support score lookup from actual graph edges
  const supportScoreByClaimId = new Map<string, number>();
  for (const sup of supportsFromGraph) {
    const existingA = supportScoreByClaimId.get(sup.claimA) || 0;
    const existingB = supportScoreByClaimId.get(sup.claimB) || 0;
    supportScoreByClaimId.set(sup.claimA, Math.max(existingA, sup.weight));
    supportScoreByClaimId.set(sup.claimB, Math.max(existingB, sup.weight));
  }
  
  // If we have destructive claims from the orchestrator, use those as a priority source
  const destructiveClaimIds = new Set((destructiveClaims || []).map(dc => dc.claimId));
  const destructiveImportanceMap = new Map((destructiveClaims || []).map(dc => [dc.claimId, dc.importance]));
  
  // Process each claim
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    
    // CRITICAL: Skip non-auditable claims (questions, acknowledgements, filler)
    // These should not appear as issues
    if (claim.isAuditable === false) {
      continue;
    }
    
    let truthState = (truthStates[i] || "Inconclusive") as "Contradicted" | "Supported" | "Ungrounded" | "Inconclusive";
    const blame = nodeBlameNorm[i] || 0;
    
    // When spectral is skipped, derive truth state from destructive claims and other signals
    if (!hasSpectralData) {
      if (destructiveClaimIds.has(claim.id)) {
        truthState = "Ungrounded";
      } else if (claim.confidence !== undefined && claim.confidence < 0.3) {
        truthState = "Ungrounded";
      } else if (claim.confidence !== undefined && claim.confidence < 0.5) {
        truthState = "Inconclusive";
      } else if (claim.confidence !== undefined && claim.confidence >= 0.7) {
        truthState = "Supported";
      }
    }
    
    // Build risk signals from claim data
    const extendedClaim: ExtractedClaim = {
      id: claim.id,
      text: claim.text,
      confidence: claim.confidence || 0,
      evidence: claim.evidence || [],
      meta: claim.meta,
      claimType: claim.claimType || "ASSERTION",
      isAuditable: claim.isAuditable ?? true,
      topicTags: claim.topicTags || [],
      hasAbsoluteLanguage: claim.hasAbsoluteLanguage || false,
      hasMoney: claim.hasMoney || false
    };
    
    // Find max contradiction score for this claim
    let maxContradictionScore = 0;
    let maxSupportScore = 0;
    for (const edge of topBadContradictions) {
      if (edge.claimAId === claim.id || edge.claimBId === claim.id) {
        maxContradictionScore = Math.max(maxContradictionScore, edge.weight || edge.badness || 0);
      }
    }
    for (const edge of topBadSupports) {
      if (edge.claimAId === claim.id || edge.claimBId === claim.id) {
        maxSupportScore = Math.max(maxSupportScore, edge.weight || edge.badness || 0);
      }
    }
    
    // Get actual grounding and support scores from graph edges (NOT hard-coded)
    const actualGroundingScore = groundingScoreByClaimId.get(claim.id) || 0;
    const actualSupportScore = supportScoreByClaimId.get(claim.id) || maxSupportScore;
    
    // Extract risk signals with REAL computed scores
    const riskSignals = extractRiskSignals(extendedClaim, {
      nliScores: {
        contradiction: maxContradictionScore,
        support: actualSupportScore,
        grounding: actualGroundingScore // Use ACTUAL grounding from graph edges
      },
      spectral: {
        nodeBlameNorm: blame,
        truthState
      },
      contradictions: contradictionsFromGraph
    });
    
    // Compute risk score (NO HARD-CODED VALUES)
    const riskResult = computeRiskScore(riskSignals, riskConfig);
    
    // Determine if this claim should be flagged based on risk score
    // IMPROVED: Only flag claims with actual issues, not just UNVERIFIED in transcript-only mode
    // 
    // A claim should be flagged if:
    // 1. Risk score exceeds medium threshold (real problems), OR
    // 2. It's contradicted (by spectral analysis), OR
    // 3. It has high blame from spectral analysis, OR
    // 4. It's in destructive claims AND has actual reasons (not just ranked)
    //
    // Claims that are just "UNVERIFIED" in transcript-only mode should NOT be flagged
    // unless they have other risk signals (promises, absolute language, etc.)
    
    const destructiveClaim = (destructiveClaims || []).find(dc => dc.claimId === claim.id);
    const hasDestructiveReasons = destructiveClaim && 
      Array.isArray(destructiveClaim.reasons) && 
      destructiveClaim.reasons.length > 0;
    
    const shouldFlag = 
      riskResult.riskScore >= riskConfig.severityThresholds.medium ||
      truthState === "Contradicted" ||
      truthState === "Ungrounded" ||
      blame > 0.3 ||
      hasDestructiveReasons;
    
    if (!shouldFlag) {
      continue;
    }
    
    // Determine speaker
    const speakerRaw = claim.meta?.speaker;
    const speaker: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN" = 
      speakerRaw === "Agent" || speakerRaw === "AGENT" ? "AGENT" :
      speakerRaw === "Customer" || speakerRaw === "CUSTOMER" ? "CUSTOMER" :
      speakerRaw === "System" || speakerRaw === "SYSTEM" ? "SYSTEM" : "UNKNOWN";
    
    // Determine issue type using new risk scoring module
    const circularityScore = spectral.circularityScore || 0;
    const cycleMass = spectral.cycleMass || 0;
    const isCircular = circularityScore > 30 && cycleMass > 0.1;
    
    const issueType = determineIssueType(riskSignals, {
      hasExternalDocs,
      turnIndex: claim.meta?.turnIndex,
      totalTurns,
      isCircular
    });
    
    // Find conflicting claims
    const conflicts: DefensibleIssue["conflictsWith"] = [];
    
    // Add contradictions
    for (const edge of topBadContradictions) {
      if (edge.claimAId === claim.id && edge.claimBId) {
        conflicts.push({
          claimId: edge.claimBId,
          claimText: claimTextMap.get(edge.claimBId) || edge.claimBId,
          relationshipType: "contradiction",
          edgeWeight: edge.weight || edge.badness || 0
        });
      } else if (edge.claimBId === claim.id && edge.claimAId) {
        conflicts.push({
          claimId: edge.claimAId,
          claimText: claimTextMap.get(edge.claimAId) || edge.claimAId,
          relationshipType: "contradiction",
          edgeWeight: edge.weight || edge.badness || 0
        });
      }
    }
    
    // Add unsupported relationships
    for (const edge of topBadSupports) {
      if (edge.claimAId === claim.id && edge.claimBId) {
        conflicts.push({
          claimId: edge.claimBId,
          claimText: claimTextMap.get(edge.claimBId) || edge.claimBId,
          relationshipType: "unsupported_by",
          edgeWeight: edge.weight || edge.badness || 0
        });
      } else if (edge.claimBId === claim.id && edge.claimAId) {
        conflicts.push({
          claimId: edge.claimAId,
          claimText: claimTextMap.get(edge.claimAId) || edge.claimAId,
          relationshipType: "unsupported_by",
          edgeWeight: edge.weight || edge.badness || 0
        });
      }
    }
    
    // Use computed importance from risk score, or destructive claims if available
    let importance = destructiveImportanceMap.get(claim.id);
    if (importance === undefined) {
      importance = riskResult.riskScore; // Use risk score as importance
    }
    
    // Severity comes from computed risk score (NOT hard-coded)
    const severity = riskResult.severity;
    
    // Generate claim summary (truncated for table display)
    const claimSummary = claim.text.length > 80 
      ? '"' + claim.text.substring(0, 77) + '..."'
      : '"' + claim.text + '"';
    
    // Use computed explanation from risk scoring
    const whyFlagged = riskResult.explanation || generateWhyFlagged(issueType, speaker, claim.text, conflicts);
    
    // Build the defensible issue
    const issue: DefensibleIssue = {
      issueId: generateIssueId(claim.id, evaluationId),
      claimId: claim.id,
      evaluationId,
      
      what: {
        claimText: claim.text,
        claimSummary,
        issueType,
        truthState,
        description: generateIssueDescription(truthState, issueType, speaker, conflicts.length),
        whyFlagged,
        claimType: claim.claimType
      },
      
      who: {
        speaker,
        speakerLabel: speaker === "AGENT" ? "Agent" : 
                      speaker === "CUSTOMER" ? "Customer" : 
                      speaker === "SYSTEM" ? "System" : "Unknown"
      },
      
      where: {
        turnStartIdx: claim.meta?.turnIndex,
        turnEndIdx: claim.meta?.turnIndex,
        timestampStartMs: claim.meta?.timestampMs,
        excerpt: claim.text.substring(0, 300)
      },
      
      conflictsWith: conflicts,
      
      risk: {
        severity,
        category: issueType === "CONTRADICTION" ? "accuracy" :
                  issueType === "UNSUPPORTED" || issueType === "UNVERIFIED" ? "evidence" :
                  issueType === "CIRCULAR" ? "reasoning" :
                  issueType === "PROMISE_RISK" || issueType === "ABSOLUTE_CLAIM" ? "commitment" :
                  "compliance",
        explanation: generateRiskExplanation(issueType, severity, speaker),
        policyRuleIds: undefined
      },
      
      confidence: {
        nodeBlameNorm: blame,
        importance,
        nliScore: maxContradictionScore > 0 ? maxContradictionScore : undefined,
        groundingScore: actualGroundingScore // Use ACTUAL grounding from graph edges
      },
      
      status: "OPEN"
    };
    
    issues.push(issue);
  }
  
  // Sort by importance (risk score) descending
  issues.sort((a, b) => b.confidence.importance - a.confidence.importance);
  
  return issues;
}

/**
 * Legacy buildIssuesList for backward compatibility
 * Returns simpler issue objects for existing code
 */
export function buildIssuesListLegacy(
  spectral: SpectralReport,
  claims: Array<Claim & { meta?: { speaker?: string; turnIndex?: number } }>,
  destructiveClaims?: Array<{ claimId: string; importance: number; [key: string]: any }>
): Array<{
  claimId: string;
  truthState: "Contradicted" | "Supported" | "Ungrounded" | "Inconclusive";
  nodeBlameNorm: number;
  importance: number;
  issueType: "CONTRADICTION" | "UNSUPPORTED" | "POLICY_MISS" | "POLICY_VIOLATION";
  speaker: "AGENT" | "CUSTOMER" | "UNKNOWN";
  turnStartIdx?: number;
  turnEndIdx?: number;
  primaryEvidence?: {
    turnIdx: number;
    speaker: string;
    excerpt: string;
  };
  relatedEdges: {
    topBadContradictions: any[];
    topBadSupports: any[];
  };
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_POSITIVE";
}> {
  // Use the new function and convert to legacy format
  const defensibleIssues = buildIssuesList(spectral, claims, destructiveClaims);
  
  return defensibleIssues.map(issue => ({
    claimId: issue.claimId,
    truthState: issue.what.truthState,
    nodeBlameNorm: issue.confidence.nodeBlameNorm,
    importance: issue.confidence.importance,
    issueType: issue.what.issueType === "CIRCULAR" ? "UNSUPPORTED" : issue.what.issueType as any,
    speaker: issue.who.speaker === "SYSTEM" ? "UNKNOWN" : issue.who.speaker as any,
    turnStartIdx: issue.where.turnStartIdx,
    turnEndIdx: issue.where.turnEndIdx,
    primaryEvidence: issue.where.turnStartIdx !== undefined ? {
      turnIdx: issue.where.turnStartIdx,
      speaker: issue.who.speaker,
      excerpt: issue.where.excerpt || ""
    } : undefined,
    relatedEdges: {
      topBadContradictions: issue.conflictsWith
        .filter(c => c.relationshipType === "contradiction")
        .map(c => ({ claimAId: issue.claimId, claimBId: c.claimId, weight: c.edgeWeight })),
      topBadSupports: issue.conflictsWith
        .filter(c => c.relationshipType === "unsupported_by")
        .map(c => ({ claimAId: issue.claimId, claimBId: c.claimId, weight: c.edgeWeight }))
    },
    status: issue.status
  }));
}

