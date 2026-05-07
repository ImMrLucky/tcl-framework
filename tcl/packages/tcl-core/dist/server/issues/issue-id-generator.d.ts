import type { IssueV2 } from '../../types.js';
/**
 * Generate deterministic issue_id according to enterprise spec
 *
 * Formula: sha256(orgId + evaluationId + canonical(issueType, speaker, normalizedClaimText, offsets, topicId, ruleId?, evidenceRefIds?))
 *
 * This ensures the same issue maps to the same issue_id across exports and audit packs
 * for the same evaluation payload.
 */
export declare function generateDeterministicIssueId(params: {
    orgId: string;
    evaluationId: string;
    issueType: string;
    speaker?: string;
    claimText?: string;
    turnStartIdx?: number;
    turnEndIdx?: number;
    topicId?: string;
    ruleId?: string;
    evidenceRefIds?: string[];
    issueKey?: string;
    primaryClaimId?: string;
    relatedClaimIds?: string[];
}): string;
/**
 * Generate deterministic issue_id from IssueV2 object
 * Extracts all necessary fields from the issue object
 */
export declare function generateIssueIdFromIssue(issue: IssueV2, orgId: string, evaluationId: string): string;
