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
import type { SpectralReport, Claim } from "../../types.js";
import type { ClaimWithAnchors, IssueDTO, IssueType, ParticipantRole } from "./types.js";
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
export declare function deriveIssueType(claimId: string, truthState: string, topBadContradictions: Array<{
    claimAId?: string;
    claimBId?: string;
}>, topBadSupports: Array<{
    claimAId?: string;
    claimBId?: string;
}>): IssueType | null;
/**
 * Compute severity score (0-100)
 *
 * Formula:
 *   base = nodeBlameNorm[i] * 70
 *   edgeContribution = sum(incident bad edge badness) normalized to 0..30
 *   roleBonus = (role=agent && issueType in {contradiction, ungrounded}) ? 5 : 0
 *   final = clamp(base + edgeContribution + roleBonus, 0, 100)
 */
export declare function computeSeverity(claimId: string, nodeBlameNorm: number, issueType: IssueType, role: ParticipantRole, topBadContradictions: Array<{
    claimAId?: string;
    claimBId?: string;
    badness?: number;
    weight?: number;
}>, topBadSupports: Array<{
    claimAId?: string;
    claimBId?: string;
    badness?: number;
    weight?: number;
}>): number;
/**
 * Get severity label from score
 */
export declare function getSeverityLabel(score: number): "critical" | "high" | "medium" | "low";
/**
 * Generate human-readable "why" explanation for an issue
 */
export declare function generateWhyExplanation(issueType: IssueType, claimText: string, conflicts: Array<{
    claimId: string;
    claimText: string;
    type: "contradiction" | "support";
}>): string;
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
export declare function buildIssueDTOs(input: BuildIssueDTOsInput): IssueDTO[];
/**
 * Extract claims from normalized turns and add evidence anchors
 */
export declare function extractClaimsWithAnchors(turns: Array<{
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
}>, artifactId: string, existingClaims?: Claim[]): ClaimWithAnchors[];
export declare const ISSUE_TYPE_LABELS: Record<IssueType, string>;
