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
  topBadSupports: Array<{ claimAId?: string; claimBId?: string }>
): IssueType | null {
  // Rule 1: Contradicted claims
  if (truthState === "Contradicted") {
    return "contradiction";
  }
  
  // Rule 2: Ungrounded claims
  if (truthState === "Ungrounded") {
    return "ungrounded";
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
  if (truthState === "Inconclusive") {
    return "needs_review";
  }
  
  // Not an issue
  return null;
}

// =============================================================================
// SEVERITY SCORING (0-100)
// =============================================================================

/**
 * Compute severity score (0-100)
 * 
 * Formula:
 *   base = nodeBlameNorm[i] * 70
 *   edgeContribution = sum(incident bad edge badness) normalized to 0..30
 *   roleBonus = (role=agent && issueType in {contradiction, ungrounded}) ? 5 : 0
 *   final = clamp(base + edgeContribution + roleBonus, 0, 100)
 */
export function computeSeverity(
  claimId: string,
  nodeBlameNorm: number,
  issueType: IssueType,
  role: ParticipantRole,
  topBadContradictions: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>,
  topBadSupports: Array<{ claimAId?: string; claimBId?: string; badness?: number; weight?: number }>
): number {
  // Base score from node blame (0-70)
  const base = nodeBlameNorm * 70;
  
  // Calculate edge contribution
  let totalBadness = 0;
  let edgeCount = 0;
  
  for (const edge of [...topBadContradictions, ...topBadSupports]) {
    if (edge.claimAId === claimId || edge.claimBId === claimId) {
      totalBadness += edge.badness ?? edge.weight ?? 0.5;
      edgeCount++;
    }
  }
  
  // Normalize edge contribution to 0-30
  const avgBadness = edgeCount > 0 ? totalBadness / edgeCount : 0;
  const edgeContribution = Math.min(30, avgBadness * 30);
  
  // Role bonus for agent issues
  const roleBonus = (
    role === "agent" && 
    (issueType === "contradiction" || issueType === "ungrounded")
  ) ? 5 : 0;
  
  // Final score, clamped 0-100
  const final = Math.min(100, Math.max(0, Math.round(base + edgeContribution + roleBonus)));
  
  return final;
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
}

/**
 * Build IssueDTO array from spectral outputs and claims
 * 
 * This is the main function that produces the "Top Claim Issues" table data.
 */
export function buildIssueDTOs(input: BuildIssueDTOsInput): IssueDTO[] {
  const { claims, spectral, artifactId } = input;
  
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
    
    // Derive issue type
    const issueType = deriveIssueType(
      claim.id,
      truthState,
      topBadContradictions,
      topBadSupports
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
    
    // Compute severity
    const severity = computeSeverity(
      claim.id,
      blame,
      issueType,
      claim.role,
      topBadContradictions,
      topBadSupports
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
  inconsistent_support: "Inconsistent Support",
  inconsistent_contradiction: "Inconsistent Contradiction",
  needs_review: "Needs Review",
};

