/**
 * Issue Derivation Module
 * 
 * Deterministic rules for deriving "Top Claim Issues" from spectral outputs.
 * 
 * This module ensures:
 * - Consistent issue type assignment based on truthState + edges
 * - Realistic severity scoring (0-100)
 * - Full traceability to evidence anchors
 * - Audit-grade reproducibility
 */

import { createHash } from "crypto";
import type { SpectralReport, Claim } from "../../types.js";
import type { ClaimWithAnchors, IssueDTO, IssueType, ParticipantRole } from "./types.js";

// =============================================================================
// ISSUE TYPE DERIVATION (Deterministic Rules)
// =============================================================================

/**
 * Derive issue type from spectral outputs
 * 
 * Rules (in priority order):
 * 1. If truthState == "Contradicted" => "contradiction"
 * 2. If truthState == "Ungrounded" => "ungrounded"
 * 3. If claim appears in topBadSupports => "inconsistent_support"
 * 4. If claim appears in topBadContradictions => "inconsistent_contradiction"
 * 5. If truthState == "Inconclusive" => "needs_review"
 * 6. Else: not an issue (return null)
 */
export function deriveIssueType(
  claimId: string,
  truthState: string,
  topBadContradictions: Array<{ claimAId?: string; claimBId?: string }>,
  topBadSupports: Array<{ claimAId?: string; claimBId?: string }>,
  claimModality?: string,  // NEW: Claim modality (promise, assert, etc.)
  speakerRole?: string     // NEW: Speaker role (agent, customer, etc.)
): IssueType | null {
  // Normalize truth state to uppercase for comparison
  const normalizedState = truthState?.toUpperCase();
  
  // Rule 1: Contradicted claims (handle both "Contradicted" and "CONTRADICTED")
  if (normalizedState === "CONTRADICTED") {
    return "contradiction";
  }
  
  // Rule 1.5: Risky commitments (agent promises/guarantees that are unverified)
  // HIGH PRIORITY: These are high-risk even in transcript-only mode
  const isAgent = speakerRole === 'agent' || speakerRole === 'AGENT';
  const isPromise = claimModality === 'promise';
  if (isAgent && isPromise && (normalizedState === "UNVERIFIED" || normalizedState === "UNGROUNDED")) {
    return "risky_commitment_unverified";
  }
  
  // Rule 2: Ungrounded claims (NO evidence at all)
  if (normalizedState === "UNGROUNDED") {
    return "ungrounded";
  }
  
  // Rule 2b: Unverified claims (has transcript evidence but no external verification)
  // IMPORTANT: UNVERIFIED is not inherently an issue - it's expected in transcript-only mode
  // Only flag as issue if claim is in bad edges OR is a risky commitment
  if (normalizedState === "UNVERIFIED") {
    // Check for risky commitments first (agent promises)
    if (isAgent && isPromise) {
      return "risky_commitment_unverified";
    }
    
    // Check if claim is in any problematic edges
    const inBadContradictions = topBadContradictions.some(
      e => e.claimAId === claimId || e.claimBId === claimId
    );
    const inBadSupports = topBadSupports.some(
      e => e.claimAId === claimId || e.claimBId === claimId
    );
    
    // Only flag UNVERIFIED claims that are in problematic edges
    if (inBadContradictions) {
      return "inconsistent_contradiction";
    }
    if (inBadSupports) {
      return "inconsistent_support";
    }
    
    // UNVERIFIED with no bad edges is NOT an issue - it's normal for transcript-only mode
    return null;
  }
  
  // Rule 3: Claims in bad supports (inconsistent support relationships)
  const inBadSupports = topBadSupports.some(
    e => e.claimAId === claimId || e.claimBId === claimId
  );
  if (inBadSupports) {
    return "inconsistent_support";
  }
  
  // Rule 4: Claims in bad contradictions (but not fully contradicted)
  const inBadContradictions = topBadContradictions.some(
    e => e.claimAId === claimId || e.claimBId === claimId
  );
  if (inBadContradictions) {
    return "inconsistent_contradiction";
  }
  
  // Rule 5: Inconclusive claims
  if (normalizedState === "INCONCLUSIVE") {
    return "needs_review";
  }
  
  // Rule 6: SUPPORTED claims are NOT issues - they're verified
  if (normalizedState === "SUPPORTED") {
    return null;
  }
  
  // Not an issue
  return null;
}

// =============================================================================
// SEVERITY SCORING (0-100)
// =============================================================================

/**
 * Compute severity score (0-100) from (impact × confidence × verifiability)
 * 
 * This prevents "everything is high" by requiring all three components.
 * 
 * Formula:
 *   impact = template-driven impact (compliance/financial harm) -> 0..1
 *   confidence = edge strength, classification confidence -> 0..1
 *   verifiability = evidence-backed > transcript-only -> 0..1
 *   severity = (impact × confidence × verifiability) × 100
 * 
 * This ensures:
 * - Transcript-only runs produce mostly medium issues unless contradictions/risky commitments
 * - High severity requires high impact AND high confidence AND verifiability
 */
export function computeSeverity(
  claimId: string,
  nodeBlameNorm: number,
  issueType: IssueType,
  role: ParticipantRole,
  topBadContradictions: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>,
  topBadSupports: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>,
  verificationLevel: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PROVIDED' | 'AUDIO_VERIFIED' | 'EXTERNAL_VERIFIED' | 'MISMATCH_FLAGGED' = 'TRANSCRIPT_ONLY'
): number {
  // Step 1: Compute impact (template-driven: compliance/financial harm)
  const impact = computeImpact(issueType, role, topBadContradictions, topBadSupports);
  
  // Step 2: Compute confidence (edge strength, classification confidence)
  const confidence = computeConfidence(nodeBlameNorm, topBadContradictions, topBadSupports, claimId);
  
  // Step 3: Compute verifiability (evidence-backed > transcript-only)
  const verifiability = computeVerifiability(verificationLevel);
  
  // Step 4: Severity = (impact × confidence × verifiability) × 100
  // This multiplicative formula ensures all three must be high for high severity
  const severity = (impact * confidence * verifiability) * 100;
  
  // Clamp to 0-100
  return Math.min(100, Math.max(0, Math.round(severity)));
}

/**
 * Compute impact score (0..1) based on template-driven rules
 * - Compliance flags → high impact (1.0)
 * - Financial harm (money, refunds, fees) → high impact (0.9)
 * - Contradictions → medium-high impact (0.7)
 * - Ungrounded → medium impact (0.5)
 * - Other → low impact (0.3)
 */
function computeImpact(
  issueType: IssueType,
  role: ParticipantRole,
  topBadContradictions: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>,
  topBadSupports: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>
): number {
  // Highest impact: risky commitments (agent promises/guarantees that are unverified)
  if (issueType === 'risky_commitment_unverified') {
    return 0.95; // Very high impact - these are high-risk even in transcript-only mode
  }
  
  // High impact: contradictions (especially agent contradictions)
  if (issueType === 'contradiction') {
    // Agent contradictions are higher impact
    if (role === 'agent') {
      return 0.9; // High impact for agent contradictions
    }
    return 0.7; // Medium-high for other contradictions
  }
  
  // High impact: ungrounded claims (especially agent)
  if (issueType === 'ungrounded') {
    if (role === 'agent') {
      return 0.8; // High impact for ungrounded agent claims
    }
    return 0.5; // Medium for other ungrounded
  }
  
  // Medium impact: inconsistent support
  if (issueType === 'inconsistent_support' || issueType === 'inconsistent_contradiction') {
    return 0.6;
  }
  
  // Low impact: needs review
  if (issueType === 'needs_review') {
    return 0.3;
  }
  
  // Default: medium
  return 0.5;
}

/**
 * Compute confidence score (0..1) from edge strength and classification confidence
 * - nodeBlameNorm: spectral node blame (0..1)
 * - Edge weights: average of incident edge weights
 */
function computeConfidence(
  nodeBlameNorm: number,
  topBadContradictions: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>,
  topBadSupports: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>,
  claimId: string
): number {
  // Base confidence from node blame (spectral analysis)
  let confidence = nodeBlameNorm;
  
  // Boost confidence based on edge weights (stronger edges = higher confidence)
  let totalWeight = 0;
  let edgeCount = 0;
  
  for (const edge of [...topBadContradictions, ...topBadSupports]) {
    if (edge.claimAId === claimId || edge.claimBId === claimId) {
      const weight = edge.weight ?? edge.badness ?? 0.5;
      totalWeight += weight;
      edgeCount++;
    }
  }
  
  if (edgeCount > 0) {
    const avgWeight = totalWeight / edgeCount;
    // Blend node blame (60%) with edge weights (40%)
    confidence = (nodeBlameNorm * 0.6) + (avgWeight * 0.4);
  }
  
  // Ensure minimum confidence for detected issues
  if (confidence < 0.3 && (edgeCount > 0 || nodeBlameNorm > 0)) {
    confidence = 0.3; // Minimum confidence for detected issues
  }
  
  return Math.min(1, Math.max(0, confidence));
}

/**
 * Compute verifiability score (0..1) based on verification level
 * - EXTERNAL_VERIFIED: 1.0 (fully verified)
 * - AUDIO_VERIFIED: 0.8 (audio-derived transcript verified)
 * - TRANSCRIPT_PROVIDED: 0.6 (uploaded transcript, not audio-verified)
 * - TRANSCRIPT_ONLY: 0.4 (transcript-only, not verified)
 * - MISMATCH_FLAGGED: 0.3 (mismatch between uploaded and ASR transcript)
 */
function computeVerifiability(
  verificationLevel: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PROVIDED' | 'AUDIO_VERIFIED' | 'EXTERNAL_VERIFIED' | 'MISMATCH_FLAGGED'
): number {
  switch (verificationLevel) {
    case 'EXTERNAL_VERIFIED':
      return 1.0; // Fully verified with external evidence
    case 'AUDIO_VERIFIED':
      return 0.8; // Audio-derived transcript verified
    case 'TRANSCRIPT_PROVIDED':
      return 0.6; // Uploaded transcript, not audio-verified
    case 'TRANSCRIPT_ONLY':
      return 0.4; // Transcript-only, not verified
    case 'MISMATCH_FLAGGED':
      return 0.3; // Mismatch between uploaded and ASR transcript
    default:
      return 0.4; // Default to transcript-only
  }
}

/**
 * Get severity label from score
 */
export function getSeverityLabel(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

// =============================================================================
// "WHY" EXPLANATION GENERATION
// =============================================================================

/**
 * Generate human-readable "why" explanation for an issue
 */
export function generateWhyExplanation(
  issueType: IssueType,
  claimText: string,
  conflicts: Array<{ claimId: string; claimText: string; type: "contradiction" | "support" }>
): string {
  switch (issueType) {
    case "contradiction":
      if (conflicts.length > 0) {
        const topConflict = conflicts.find(c => c.type === "contradiction");
        if (topConflict) {
          const conflictSummary = topConflict.claimText.length > 60
            ? topConflict.claimText.substring(0, 57) + "..."
            : topConflict.claimText;
          return `Conflicts with later statement: "${conflictSummary}"`;
        }
      }
      return "Directly contradicts another statement in the conversation.";
    
    case "ungrounded":
      return "No supporting evidence found in documents, policies, or verified sources.";
    
    case "inconsistent_support":
      return "Support relationship is inconsistent with other statements.";
    
    case "inconsistent_contradiction":
      return "Part of a contradictory relationship chain.";
    
    case "needs_review":
      return "Claim could not be fully verified; manual review recommended.";
    
    case "risky_commitment_unverified":
      return "Agent made a promise or guarantee that has not been verified against external evidence or policy.";
    
    default:
      return "Issue detected during analysis.";
  }
}

// =============================================================================
// ISSUE DTO BUILDER
// =============================================================================

export interface BuildIssueDTOsInput {
  /** Claims with evidence anchors */
  claims: ClaimWithAnchors[];
  /** Spectral report */
  spectral: SpectralReport;
  /** Artifact ID */
  artifactId: string;
  /** Verification level for verifiability computation */
  verificationLevel?: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PROVIDED' | 'AUDIO_VERIFIED' | 'EXTERNAL_VERIFIED' | 'MISMATCH_FLAGGED';
}

/**
 * Build IssueDTO array from spectral outputs and claims
 * 
 * This is the main function that produces the "Top Claim Issues" table data.
 */
export function buildIssueDTOs(input: BuildIssueDTOsInput): IssueDTO[] {
  const { claims, spectral, artifactId, verificationLevel = 'TRANSCRIPT_ONLY' } = input;
  
  const truthStates = spectral.truthStates || [];
  const nodeBlameNorm = spectral.nodeBlameNorm || [];
  const topBadContradictions = spectral.topBadContradictions || [];
  const topBadSupports = spectral.topBadSupports || [];
  
  // Build claim lookup
  const claimMap = new Map(claims.map(c => [c.id, c]));
  
  const issues: IssueDTO[] = [];
  
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    const truthState = truthStates[i] || "Inconclusive";
    const blame = nodeBlameNorm[i] || 0;
    
    // Derive issue type (pass modality and role for commitment detection)
    const claimModality = (claim as any).modality; // Claim modality from graph builder
    const speakerRole = claim.role; // Speaker role (agent, customer, etc.)
    const issueType = deriveIssueType(
      claim.id,
      truthState,
      topBadContradictions,
      topBadSupports,
      claimModality,
      speakerRole
    );
    
    // Skip non-issues
    if (!issueType) continue;
    
    // Get related edges
    const relatedEdges: IssueDTO["relatedEdges"] = [];
    
    for (const edge of topBadContradictions) {
      if (edge.claimAId === claim.id || edge.claimBId === claim.id) {
        relatedEdges.push({
          type: "contradiction",
          claimAId: edge.claimAId || "",
          claimBId: edge.claimBId || "",
          badness: (edge as any).badness ?? (edge as any).weight ?? 0.5,
        });
      }
    }
    
    for (const edge of topBadSupports) {
      if (edge.claimAId === claim.id || edge.claimBId === claim.id) {
        relatedEdges.push({
          type: "support",
          claimAId: edge.claimAId || "",
          claimBId: edge.claimBId || "",
          badness: (edge as any).badness ?? (edge as any).weight ?? 0.5,
        });
      }
    }
    
    // Build conflict list for "why" explanation
    const conflicts = relatedEdges.map(e => {
      const otherId = e.claimAId === claim.id ? e.claimBId : e.claimAId;
      const otherClaim = claimMap.get(otherId);
      return {
        claimId: otherId,
        claimText: otherClaim?.text || otherId,
        type: e.type,
      };
    });
    
    // Compute severity (using impact × confidence × verifiability formula)
    const severity = computeSeverity(
      claim.id,
      blame,
      issueType,
      claim.role,
      topBadContradictions,
      topBadSupports,
      verificationLevel
    );
    
    // Generate explanation
    const why = generateWhyExplanation(issueType, claim.text, conflicts);
    
    const issue: IssueDTO = {
      rank: 0, // Will be set after sorting
      issueType,
      severity,
      claimId: claim.id,
      claimText: claim.text,
      speakerRole: claim.role,
      speakerLabel: claim.speakerLabel,
      artifactId: claim.artifactId || artifactId,
      turnIndex: claim.turnIndex,
      lineStart: claim.lineStart,
      lineEnd: claim.lineEnd,
      startTimeMs: claim.startTimeMs,
      endTimeMs: claim.endTimeMs,
      why,
      relatedEdges,
      actions: ["view_evidence", "export_csv", "export_json", "add_to_audit_packet"],
    };
    
    issues.push(issue);
  }
  
  // Sort by severity (descending) and assign ranks
  issues.sort((a, b) => b.severity - a.severity);
  issues.forEach((issue, idx) => {
    issue.rank = idx + 1;
  });
  
  return issues;
}

// =============================================================================
// CLAIM EXTRACTION WITH ANCHORS
// =============================================================================

/**
 * Extract claims from normalized turns and add evidence anchors
 */
export function extractClaimsWithAnchors(
  turns: Array<{
    turnIndex: number;
    participantId: string;
    role: string;
    speakerLabel: string;
    text: string;
    lineStart?: number;
    lineEnd?: number;
    startTimeMs?: number;
    endTimeMs?: number;
    charStart?: number;
    charEnd?: number;
  }>,
  artifactId: string,
  existingClaims?: Claim[]
): ClaimWithAnchors[] {
  const claimsWithAnchors: ClaimWithAnchors[] = [];
  
  // If we have existing claims (from LLM extraction), enhance them with anchors
  if (existingClaims && existingClaims.length > 0) {
    for (const claim of existingClaims) {
      // Find matching turn
      const turnIndex = (claim as any).meta?.turnIndex ?? 0;
      const turn = turns.find(t => t.turnIndex === turnIndex) || turns[0];
      
      claimsWithAnchors.push({
        id: claim.id,
        text: claim.text,
        turnIndex: turnIndex,
        participantId: turn?.participantId || "unknown",
        role: (turn?.role as ParticipantRole) || "unknown",
        speakerLabel: turn?.speakerLabel || (claim as any).meta?.speaker || "Unknown",
        artifactId,
        lineStart: turn?.lineStart,
        lineEnd: turn?.lineEnd,
        startTimeMs: turn?.startTimeMs,
        endTimeMs: turn?.endTimeMs,
        charStart: turn?.charStart,
        charEnd: turn?.charEnd,
        meta: {
          extractorVersion: "claims.v1",
          sentenceIndex: (claim as any).meta?.sentenceIndex ?? 0,
          confidence: claim.confidence,
        },
      });
    }
    
    return claimsWithAnchors;
  }
  
  // Fallback: create claims from turns (sentence splitting)
  let sentenceCounter = 0;
  
  for (const turn of turns) {
    // Simple sentence splitting
    const sentences = turn.text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);
    
    for (let sentenceIdx = 0; sentenceIdx < sentences.length; sentenceIdx++) {
      const sentence = sentences[sentenceIdx];
      
      // Generate deterministic claim ID
      const id = generateDeterministicClaimId(artifactId, turn.turnIndex, sentenceIdx, sentence);
      
      claimsWithAnchors.push({
        id,
        text: sentence,
        turnIndex: turn.turnIndex,
        participantId: turn.participantId,
        role: turn.role as ParticipantRole,
        speakerLabel: turn.speakerLabel,
        artifactId,
        lineStart: turn.lineStart,
        lineEnd: turn.lineEnd,
        startTimeMs: turn.startTimeMs,
        endTimeMs: turn.endTimeMs,
        charStart: turn.charStart,
        charEnd: turn.charEnd,
        meta: {
          extractorVersion: "claims.v1",
          sentenceIndex: sentenceIdx,
        },
      });
      
      sentenceCounter++;
    }
  }
  
  return claimsWithAnchors;
}

/**
 * Generate deterministic claim ID
 */
function generateDeterministicClaimId(
  artifactId: string,
  turnIndex: number,
  sentenceIndex: number,
  claimText: string
): string {
  const normalized = claimText.trim().toLowerCase().replace(/\s+/g, " ");
  const input = `${artifactId}:${turnIndex}:${sentenceIndex}:${normalized}`;
  const hash = createHash("sha256").update(input).digest("hex").substring(0, 12);
  return `c_${hash}`;
}

// =============================================================================
// ISSUE TYPE LABELS
// =============================================================================

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  contradiction: "Contradiction",
  ungrounded: "Ungrounded Claim",
  unverified: "Unverified (Transcript Only)",
  risky_commitment_unverified: "Risky Commitment (Unverified)",
  inconsistent_support: "Inconsistent Support",
  inconsistent_contradiction: "Inconsistent Contradiction",
  needs_review: "Needs Review",
};

