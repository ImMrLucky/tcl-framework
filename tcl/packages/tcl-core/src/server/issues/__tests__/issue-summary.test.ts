/**
 * Issue Summary Tests
 * 
 * Tests for computing IssueSummaryV2 from IssueV2 arrays.
 */

import { describe, it, expect } from 'vitest';
import { computeIssueSummaryV2, isIssueSummaryV2MissingOrIncomplete } from '../issue-summary.js';
import type { IssueV2 } from '../../../types.js';

describe('computeIssueSummaryV2', () => {
  it('should compute summary from issues with severityDisplay', () => {
    const issues: IssueV2[] = [
      {
        issueId: 'issue-1',
        issueKey: 'key-1',
        runId: 'run-1',
        conversationId: 'conv-1',
        type: 'CONTRADICTION',
        category: 'evidence',
        severity: 'high',
        severityDisplay: 'high',
        impact: 'high',
        riskScore: 0.8,
        score: 80,
        confidence: 0.9,
        reviewRequired: false,
        verification: { level: 'EXTERNAL_VERIFIED', reasonCodes: [] },
        who: { speaker: 'AGENT' },
        what: { primaryClaimId: 'claim-1', issueSummary: 'Test issue 1' },
        evidence: { refs: [] },
        compliance: { tags: [], disclaimers: [] },
        audit: { createdAt: '2026-01-06', engineVersion: '1.0.0', scorerId: 'scorer-1' },
      },
      {
        issueId: 'issue-2',
        issueKey: 'key-2',
        runId: 'run-1',
        conversationId: 'conv-1',
        type: 'UNVERIFIED_CLAIM',
        category: 'billing',
        severity: 'medium',
        severityDisplay: 'medium',
        impact: 'medium',
        riskScore: 0.5,
        score: 50,
        confidence: 0.7,
        reviewRequired: false,
        verification: { level: 'TRANSCRIPT_ONLY', reasonCodes: [] },
        who: { speaker: 'CUSTOMER' },
        what: { primaryClaimId: 'claim-2', issueSummary: 'Test issue 2' },
        evidence: { refs: [] },
        compliance: { tags: [], disclaimers: [] },
        audit: { createdAt: '2026-01-06', engineVersion: '1.0.0', scorerId: 'scorer-1' },
      },
      {
        issueId: 'issue-3',
        issueKey: 'key-3',
        runId: 'run-1',
        conversationId: 'conv-1',
        type: 'UNVERIFIED_CLAIM',
        category: 'billing',
        severity: 'medium',
        severityDisplay: 'medium',
        impact: 'medium',
        riskScore: 0.5,
        score: 50,
        confidence: 0.7,
        reviewRequired: false,
        verification: { level: 'TRANSCRIPT_ONLY', reasonCodes: [] },
        who: { speaker: 'CUSTOMER' },
        what: { primaryClaimId: 'claim-3', issueSummary: 'Test issue 3' },
        evidence: { refs: [] },
        compliance: { tags: [], disclaimers: [] },
        audit: { createdAt: '2026-01-06', engineVersion: '1.0.0', scorerId: 'scorer-1' },
      },
    ];

    const summary = computeIssueSummaryV2(issues);

    expect(summary.totalIssues).toBe(3);
    expect(summary.allIssuesCount).toBe(3);
    expect(summary.bySeverity.high).toBe(1);
    expect(summary.bySeverity.medium).toBe(2);
    expect(summary.bySeverity.low).toBe(0);
    expect(summary.bySeverity.critical).toBe(0);
    expect(summary.byType.CONTRADICTION).toBe(1);
    expect(summary.byType.UNVERIFIED_CLAIM).toBe(2);
    expect(summary.byCategory.evidence).toBe(1);
    expect(summary.byCategory.billing).toBe(2);
  });

  it('should use severity (impact severity) for summary counts, not severityDisplay', () => {
    const issues: IssueV2[] = [
      {
        issueId: 'issue-1',
        issueKey: 'key-1',
        runId: 'run-1',
        conversationId: 'conv-1',
        type: 'CONTRADICTION',
        category: 'evidence',
        severity: 'high', // This should be used (impact severity)
        severityDisplay: 'medium', // This is for UI display only, not for summary counts
        impact: 'high',
        riskScore: 0.8,
        score: 80,
        confidence: 0.9,
        reviewRequired: false,
        verification: { level: 'EXTERNAL_VERIFIED', reasonCodes: [] },
        who: { speaker: 'AGENT' },
        what: { primaryClaimId: 'claim-1', issueSummary: 'Test issue' },
        evidence: { refs: [] },
        compliance: { tags: [], disclaimers: [] },
        audit: { createdAt: '2026-01-06', engineVersion: '1.0.0', scorerId: 'scorer-1' },
      },
    ];

    const summary = computeIssueSummaryV2(issues);

    // Executive summary should count by severity (impact severity), not severityDisplay
    expect(summary.bySeverity.high).toBe(1);
    expect(summary.bySeverity.medium).toBe(0);
  });

  it('should fall back to severity when severityDisplay is missing', () => {
    const issues: IssueV2[] = [
      {
        issueId: 'issue-1',
        issueKey: 'key-1',
        runId: 'run-1',
        conversationId: 'conv-1',
        type: 'CONTRADICTION',
        category: 'evidence',
        severity: 'high', // Should be used when severityDisplay is missing
        impact: 'high',
        riskScore: 0.8,
        score: 80,
        confidence: 0.9,
        reviewRequired: false,
        verification: { level: 'EXTERNAL_VERIFIED', reasonCodes: [] },
        who: { speaker: 'AGENT' },
        what: { primaryClaimId: 'claim-1', issueSummary: 'Test issue' },
        evidence: { refs: [] },
        compliance: { tags: [], disclaimers: [] },
        audit: { createdAt: '2026-01-06', engineVersion: '1.0.0', scorerId: 'scorer-1' },
      },
    ];

    const summary = computeIssueSummaryV2(issues);

    expect(summary.bySeverity.high).toBe(1);
  });

  it('should handle empty issues array', () => {
    const summary = computeIssueSummaryV2([]);

    expect(summary.totalIssues).toBe(0);
    expect(summary.allIssuesCount).toBe(0);
    expect(summary.bySeverity.low).toBe(0);
    expect(summary.bySeverity.medium).toBe(0);
    expect(summary.bySeverity.high).toBe(0);
    expect(summary.bySeverity.critical).toBe(0);
  });

  it('should handle unknown severity values', () => {
    const issues: IssueV2[] = [
      {
        issueId: 'issue-1',
        issueKey: 'key-1',
        runId: 'run-1',
        conversationId: 'conv-1',
        type: 'CONTRADICTION',
        category: 'evidence',
        severity: 'unknown' as any, // Invalid severity
        impact: 'high',
        riskScore: 0.8,
        score: 80,
        confidence: 0.9,
        reviewRequired: false,
        verification: { level: 'EXTERNAL_VERIFIED', reasonCodes: [] },
        who: { speaker: 'AGENT' },
        what: { primaryClaimId: 'claim-1', issueSummary: 'Test issue' },
        evidence: { refs: [] },
        compliance: { tags: [], disclaimers: [] },
        audit: { createdAt: '2026-01-06', engineVersion: '1.0.0', scorerId: 'scorer-1' },
      },
    ];

    const summary = computeIssueSummaryV2(issues);

    // Unknown severity should default to medium
    expect(summary.bySeverity.medium).toBe(1);
  });
});

describe('isIssueSummaryV2MissingOrIncomplete', () => {
  it('should return true when summary is missing', () => {
    expect(isIssueSummaryV2MissingOrIncomplete(null, 5)).toBe(true);
    expect(isIssueSummaryV2MissingOrIncomplete(undefined, 5)).toBe(true);
  });

  it('should return true when bySeverity is missing', () => {
    expect(isIssueSummaryV2MissingOrIncomplete({ totalIssues: 5 }, 5)).toBe(true);
  });

  it('should return true when all severities are zero but issues exist', () => {
    const summary = {
      totalIssues: 5,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
    };
    expect(isIssueSummaryV2MissingOrIncomplete(summary, 5)).toBe(true);
  });

  it('should return false when summary is valid', () => {
    const summary = {
      totalIssues: 5,
      bySeverity: { low: 1, medium: 2, high: 2, critical: 0 },
    };
    expect(isIssueSummaryV2MissingOrIncomplete(summary, 5)).toBe(false);
  });

  it('should return false when no issues exist', () => {
    const summary = {
      totalIssues: 0,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
    };
    expect(isIssueSummaryV2MissingOrIncomplete(summary, 0)).toBe(false);
  });
});

