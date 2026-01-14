/**
 * Issue DTOs
 *
 * Explicit data transfer objects for IssueV2 API responses.
 * Maps to the IssueV2 interface expected by the UI.
 *
 * IMPORTANT: Never spread raw issue objects into DTOs.
 * Always explicitly map fields to match UI contract.
 */
/**
 * Convert raw issue (from report or database) to IssueV2 DTO
 *
 * Handles legacy issue formats and ensures all required fields are present.
 *
 * @param rawIssue - Raw issue from report or database
 * @param evaluationId - Optional evaluation ID to attach
 * @param evaluationCreatedAt - Optional evaluation creation date
 * @returns IssueV2Dto (extends IssueV2 with workflow fields)
 */
export function toIssueDto(rawIssue, evaluationId, evaluationCreatedAt) {
    // Handle legacy issue formats
    const issueId = rawIssue.issueId || rawIssue.issue_id || rawIssue.id || '';
    const issueKey = rawIssue.issueKey || rawIssue.issue_key || issueId;
    // Extract severity (handle both old and new formats)
    let severity = 'medium';
    if (rawIssue.severity) {
        severity = rawIssue.severity;
    }
    else if (rawIssue.risk?.severity) {
        severity = rawIssue.risk.severity;
    }
    // Extract impact
    const impact = rawIssue.impact || rawIssue.risk?.impact || 'medium';
    // Extract category
    const category = rawIssue.category || rawIssue.risk?.category || 'other';
    // Extract type
    const type = rawIssue.type || rawIssue.what?.issueType || 'OTHER';
    // Extract riskScore and score
    const riskScore = rawIssue.riskScore ?? rawIssue.risk?.riskScore ?? rawIssue.confidence?.riskScore ?? 0;
    const score = rawIssue.score ?? (riskScore * 100);
    // Extract confidence
    const confidence = rawIssue.confidence?.confidence ?? rawIssue.confidence?.importance ?? 0.5;
    // Build DTO with explicit field mapping
    const dto = {
        issueId,
        issueKey,
        runId: rawIssue.runId || rawIssue.run_id || '',
        conversationId: rawIssue.conversationId || rawIssue.conversation_id || '',
        type,
        category,
        severity: severity,
        impact: impact,
        riskScore,
        score,
        confidence,
        reviewRequired: rawIssue.reviewRequired ?? rawIssue.compliance?.reviewRequired ?? false,
        verification: {
            level: rawIssue.verification?.level || rawIssue.verificationLevel || 'NONE',
            reasonCodes: rawIssue.verification?.reasonCodes || rawIssue.verification?.reasons || [],
        },
        scoring: rawIssue.scoring || {
            components: {
                impact01: 0,
                evidence01: 0,
                signal01: 0,
                category01: 0,
                verificationMultiplier: 1,
                risk01Raw: riskScore,
                risk01Final: riskScore,
            },
            weights: {
                impact: 0.4,
                evidence: 0.3,
                signal: 0.2,
                category: 0.1,
            },
            reasons: [],
        },
        who: {
            speaker: rawIssue.who?.speaker || rawIssue.speaker || 'UNKNOWN',
            turnIndex: rawIssue.who?.turnIndex ?? rawIssue.turnIndex,
        },
        what: {
            primaryClaimId: rawIssue.what?.primaryClaimId || rawIssue.claimId || rawIssue.primaryClaimId || '',
            relatedClaimIds: rawIssue.what?.relatedClaimIds || rawIssue.relatedClaimIds,
            claimText: rawIssue.what?.claimText || rawIssue.claimText,
            issueSummary: rawIssue.what?.issueSummary || rawIssue.what?.claimSummary || rawIssue.summary || '',
            issueDetail: rawIssue.what?.issueDetail || rawIssue.detail || rawIssue.description || '',
        },
        evidence: {
            refs: rawIssue.evidence?.refs || rawIssue.evidenceRefs || [],
            edges: rawIssue.evidence?.edges || rawIssue.edges,
        },
        compliance: {
            tags: rawIssue.compliance?.tags || rawIssue.tags || [],
            impactedPolicies: rawIssue.compliance?.impactedPolicies,
            legalHoldSuggested: rawIssue.compliance?.legalHoldSuggested ?? false,
            disclaimers: rawIssue.compliance?.disclaimers || [],
        },
        audit: {
            createdAt: rawIssue.audit?.createdAt || rawIssue.created_at || new Date().toISOString(),
            engineVersion: rawIssue.audit?.engineVersion || rawIssue.engine_version || '',
            scorerId: rawIssue.audit?.scorerId || rawIssue.scorer_id || '',
            modelFingerprint: rawIssue.audit?.modelFingerprint,
            configHash: rawIssue.audit?.configHash || rawIssue.config_hash,
            inputHash: rawIssue.audit?.inputHash || rawIssue.input_hash,
        },
    };
    // Add workflow fields if present
    if (rawIssue.status) {
        dto.status = rawIssue.status;
    }
    if (rawIssue.assigneeUserId !== undefined) {
        dto.assigneeUserId = rawIssue.assigneeUserId;
    }
    if (rawIssue.workflowUpdatedAt) {
        dto.workflowUpdatedAt = rawIssue.workflowUpdatedAt;
    }
    // Add evaluation metadata if provided
    if (evaluationId) {
        dto.evaluationId = evaluationId;
    }
    if (evaluationCreatedAt) {
        dto.evaluationCreatedAt = evaluationCreatedAt;
    }
    // Add scoring breakdown if present
    if (rawIssue.scoring) {
        dto.scoring = rawIssue.scoring;
    }
    return dto;
}
/**
 * Convert array of raw issues to IssueV2Dto array
 */
export function toIssueDtoArray(rawIssues, evaluationId, evaluationCreatedAt) {
    return rawIssues.map(issue => toIssueDto(issue, evaluationId, evaluationCreatedAt));
}
