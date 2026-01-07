/**
 * Issue DTOs
 * 
 * Explicit data transfer objects for IssueV2 API responses.
 * Maps to the IssueV2 interface expected by the UI.
 * 
 * IMPORTANT: Never spread raw issue objects into DTOs.
 * Always explicitly map fields to match UI contract.
 */

import type { IssueV2 } from '../../types.js';

/**
 * Extended IssueV2 with workflow fields (matches UI contract)
 */
export interface IssueV2Dto extends IssueV2 {
  // Workflow fields (optional, added by workflow system)
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
  assigneeUserId?: string | null;
  workflowUpdatedAt?: string | null;
  evaluationId?: string;
  evaluationCreatedAt?: string;
}

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
export function toIssueDto(
  rawIssue: any,
  evaluationId?: string,
  evaluationCreatedAt?: string
): IssueV2Dto {
  // Handle legacy issue formats
  const issueId = rawIssue.issueId || rawIssue.issue_id || rawIssue.id || '';
  const issueKey = rawIssue.issueKey || rawIssue.issue_key || issueId;
  
  // Extract severity (handle both old and new formats)
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
  if (rawIssue.severity) {
    severity = rawIssue.severity;
  } else if (rawIssue.risk?.severity) {
    severity = rawIssue.risk.severity;
  }
  
  // Extract severityDisplay (may be capped for transcript-only)
  const severityDisplay = rawIssue.severityDisplay || rawIssue.risk?.severityDisplay || severity;
  
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
  const dto: IssueV2Dto = {
    issueId,
    issueKey,
    runId: rawIssue.runId || rawIssue.run_id || '',
    conversationId: rawIssue.conversationId || rawIssue.conversation_id || '',
    type,
    category,
    severity: severity as 'low' | 'medium' | 'high' | 'critical',
    severityDisplay: severityDisplay as 'low' | 'medium' | 'high',
    impact: impact as 'low' | 'medium' | 'high',
    riskScore,
    score,
    confidence,
    reviewRequired: rawIssue.reviewRequired ?? rawIssue.compliance?.reviewRequired ?? false,
    verification: {
      level: rawIssue.verification?.level || rawIssue.verificationLevel || 'NONE',
      reasonCodes: rawIssue.verification?.reasonCodes || rawIssue.verification?.reasons || [],
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
export function toIssueDtoArray(
  rawIssues: any[],
  evaluationId?: string,
  evaluationCreatedAt?: string
): IssueV2Dto[] {
  return rawIssues.map(issue => toIssueDto(issue, evaluationId, evaluationCreatedAt));
}

