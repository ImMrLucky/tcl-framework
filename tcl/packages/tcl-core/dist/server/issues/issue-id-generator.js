import { createHash } from 'crypto';
/**
 * Canonicalize/normalize text for deterministic hashing
 */
function canonicalizeText(text) {
    if (!text)
        return '';
    return text
        .trim()
        .replace(/\s+/g, ' ') // Collapse whitespace
        .toLowerCase();
}
/**
 * Generate deterministic issue_id according to enterprise spec
 *
 * Formula: sha256(orgId + evaluationId + canonical(issueType, speaker, normalizedClaimText, offsets, topicId, ruleId?, evidenceRefIds?))
 *
 * This ensures the same issue maps to the same issue_id across exports and audit packs
 * for the same evaluation payload.
 */
export function generateDeterministicIssueId(params) {
    const { orgId, evaluationId, issueType, speaker, claimText, turnStartIdx, turnEndIdx, topicId, ruleId, evidenceRefIds, issueKey, primaryClaimId, relatedClaimIds, } = params;
    // Canonicalize issue type
    const canonicalIssueType = canonicalizeText(issueType);
    // Canonicalize speaker
    const canonicalSpeaker = canonicalizeText(speaker);
    // Canonicalize claim text
    const canonicalClaimText = canonicalizeText(claimText);
    // Build offsets string (prefer turn indices, fallback to empty)
    const offsets = turnStartIdx !== undefined && turnEndIdx !== undefined
        ? `${turnStartIdx}-${turnEndIdx}`
        : '';
    // Canonicalize topic ID
    const canonicalTopicId = canonicalizeText(topicId);
    // Canonicalize rule ID
    const canonicalRuleId = canonicalizeText(ruleId);
    // Canonicalize evidence ref IDs (sorted, comma-separated)
    const canonicalEvidenceRefs = evidenceRefIds && evidenceRefIds.length > 0
        ? [...evidenceRefIds].sort().join(',')
        : '';
    // Build canonical string
    // Format: issueType|speaker|claimText|offsets|topicId|ruleId|evidenceRefs
    const canonicalParts = [
        canonicalIssueType,
        canonicalSpeaker,
        canonicalClaimText,
        offsets,
        canonicalTopicId,
        canonicalRuleId,
        canonicalEvidenceRefs,
    ].filter(part => part.length > 0).join('|');
    // If canonical parts are empty, use fallback fields
    let canonicalString = canonicalParts;
    if (!canonicalString && (issueKey || primaryClaimId)) {
        // Fallback: use issueKey or claimIds
        if (issueKey) {
            canonicalString = issueKey;
        }
        else if (primaryClaimId) {
            const claimIds = relatedClaimIds
                ? [primaryClaimId, ...relatedClaimIds].sort().join(',')
                : primaryClaimId;
            canonicalString = `${canonicalIssueType}|${claimIds}`;
        }
    }
    // Build final hash input: orgId + evaluationId + canonical
    const hashInput = `${orgId}:${evaluationId}:${canonicalString}`;
    // Generate SHA-256 hash
    const hash = createHash('sha256')
        .update(hashInput)
        .digest('hex');
    // Return full hash (64 chars) for maximum uniqueness
    // Can be shortened if needed, but full hash is better for enterprise use
    return hash;
}
/**
 * Generate deterministic issue_id from IssueV2 object
 * Extracts all necessary fields from the issue object
 */
export function generateIssueIdFromIssue(issue, orgId, evaluationId) {
    // Extract issue type - IssueV2 has 'type' property
    const issueType = issue.type || issue.what?.issueType || 'UNKNOWN';
    // Extract speaker
    const speaker = issue.who?.speaker || issue.who?.speakerLabel || 'UNKNOWN';
    // Extract claim text
    const claimText = issue.what?.claimText || '';
    // Extract turn indices (offsets)
    const turnStartIdx = issue.who?.turnIndex ?? issue.transcriptSpans?.[0]?.turnIndex;
    const turnEndIdx = issue.transcriptSpans?.[issue.transcriptSpans.length - 1]?.turnIndex;
    // Extract topic ID from tags or compliance tags
    const topicId = issue.compliance?.tags?.[0] || issue.tags?.[0] || undefined;
    // Extract rule ID from compliance.impactedPolicies
    const ruleId = issue.compliance?.impactedPolicies?.[0]?.policyId || undefined;
    // Extract evidence ref IDs
    const evidenceRefIds = issue.evidence?.evidenceRefs?.map((ref) => ref.evidenceId || ref.id || ref.sourceId)
        || issue.evidence?.refs?.map((ref) => ref.sourceId || ref.id || ref.evidenceId)
        || [];
    // Extract fallback fields
    const issueKey = issue.issueKey;
    const primaryClaimId = issue.what?.primaryClaimId;
    const relatedClaimIds = issue.what?.relatedClaimIds;
    return generateDeterministicIssueId({
        orgId,
        evaluationId,
        issueType,
        speaker,
        claimText,
        turnStartIdx,
        turnEndIdx,
        topicId,
        ruleId,
        evidenceRefIds,
        issueKey,
        primaryClaimId,
        relatedClaimIds,
    });
}
