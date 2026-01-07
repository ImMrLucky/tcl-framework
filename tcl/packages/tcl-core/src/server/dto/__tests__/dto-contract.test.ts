/**
 * DTO Contract Tests
 * 
 * Ensures DTOs do not leak internal engine fields and maintain API contract.
 */

import { describe, it, expect } from 'vitest';
import { toEvaluationDto, toEvaluationSlimDto } from '../evaluation.dto.js';
import { toIssueDto } from '../issue.dto.js';

describe('DTO Contract Tests', () => {
  describe('EvaluationDto', () => {
    it('should not leak internal engine fields', () => {
      const rawEvaluation = {
        id: 'eval-123',
        org_id: 'org-123',
        project_id: 'proj-123',
        env: 'sandbox',
        conversation_id: 'conv-123',
        scores: { spectral: { coherenceScore: 0.8 } },
        refusal: false,
        scorer_id: 'scorer-123',
        engine_version: '1.0.0',
        latency_ms: 100,
        created_at: '2026-01-06T00:00:00Z',
        report: {
          // Internal engine fields that should NOT appear in DTO
          _internalDebug: 'should not appear',
          _engineState: { foo: 'bar' },
          _intermediateResults: [],
          // Allowed fields
          summary: { totalIssues: 5 },
          issues: [],
          topIssuesV2: [],
          allIssuesV2: [],
          claims: [],
          graph: { contradictions: [], supports: [] },
          spectral: { coherenceScore: 0.8 },
          run: { evaluationId: 'eval-123', inputHash: 'hash', configHash: 'config' },
        },
      };

      const dto = toEvaluationDto(rawEvaluation, true);

      // Should not contain internal fields
      expect((dto as any)._internalDebug).toBeUndefined();
      expect((dto as any)._engineState).toBeUndefined();
      expect((dto as any)._intermediateResults).toBeUndefined();

      // Should contain allowed fields
      expect(dto.id).toBe('eval-123');
      expect(dto.report?.summary).toBeDefined();
      expect(dto.report?.issues).toBeDefined();
    });

    it('should exclude report in slim mode', () => {
      const rawEvaluation = {
        id: 'eval-123',
        org_id: 'org-123',
        project_id: 'proj-123',
        env: 'sandbox',
        conversation_id: 'conv-123',
        scores: {},
        refusal: false,
        scorer_id: null,
        engine_version: '1.0.0',
        latency_ms: 100,
        created_at: '2026-01-06T00:00:00Z',
        report: { issues: [], claims: [] },
      };

      const slimDto = toEvaluationSlimDto(rawEvaluation);

      // Should not contain report
      expect(slimDto.report).toBeUndefined();

      // Should contain other fields
      expect(slimDto.id).toBe('eval-123');
      expect(slimDto.scores).toBeDefined();
    });
  });

  describe('IssueV2Dto', () => {
    it('should not leak internal engine fields', () => {
      const rawIssue = {
        issueId: 'issue-123',
        issueKey: 'key-123',
        runId: 'run-123',
        conversationId: 'conv-123',
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
        who: { speaker: 'AGENT', turnIndex: 5 },
        what: { primaryClaimId: 'claim-1', issueSummary: 'Test issue' },
        evidence: { refs: [] },
        compliance: { tags: [], disclaimers: [] },
        audit: { createdAt: '2026-01-06', engineVersion: '1.0.0', scorerId: 'scorer-123' },
        // Internal engine fields that should NOT appear in DTO
        _internalDebug: 'should not appear',
        _engineState: { foo: 'bar' },
        _intermediateResults: [],
        _rawSpectralData: {},
      };

      const dto = toIssueDto(rawIssue);

      // Should not contain internal fields
      expect((dto as any)._internalDebug).toBeUndefined();
      expect((dto as any)._engineState).toBeUndefined();
      expect((dto as any)._intermediateResults).toBeUndefined();
      expect((dto as any)._rawSpectralData).toBeUndefined();

      // Should contain allowed fields
      expect(dto.issueId).toBe('issue-123');
      expect(dto.severity).toBe('high');
      expect(dto.what.issueSummary).toBe('Test issue');
    });

    it('should handle legacy issue formats', () => {
      const legacyIssue = {
        // Old format: severity in risk object
        risk: {
          severity: 'medium',
          category: 'billing',
        },
        // Old format: type in what object
        what: {
          issueType: 'UNVERIFIED_CLAIM',
          claimSummary: 'Legacy summary',
        },
        // Old format: speaker at root
        speaker: 'CUSTOMER',
        turnIndex: 10,
        // Missing fields
        issueId: 'legacy-123',
      };

      const dto = toIssueDto(legacyIssue);

      // Should map old format to new format
      expect(dto.severity).toBe('medium');
      expect(dto.category).toBe('billing');
      expect(dto.type).toBe('UNVERIFIED_CLAIM');
      expect(dto.what.issueSummary).toBe('Legacy summary');
      expect(dto.who.speaker).toBe('CUSTOMER');
      expect(dto.who.turnIndex).toBe(10);
    });

    it('should provide defaults for missing fields', () => {
      const minimalIssue = {
        issueId: 'minimal-123',
      };

      const dto = toIssueDto(minimalIssue);

      // Should have defaults
      expect(dto.severity).toBe('medium');
      expect(dto.verification.level).toBe('NONE');
      expect(dto.who.speaker).toBe('UNKNOWN');
      expect(dto.compliance.tags).toEqual([]);
    });
  });

  describe('DTO Field Validation', () => {
    it('should not spread raw objects into DTOs', () => {
      // This test ensures DTOs use explicit field mapping, not spreading
      const rawIssue = {
        issueId: 'test-123',
        _shouldNotAppear: 'leaked field',
        nested: {
          _shouldNotAppear: 'nested leaked field',
        },
      };

      const dto = toIssueDto(rawIssue);

      // If DTO uses spreading, these would appear
      expect((dto as any)._shouldNotAppear).toBeUndefined();
      expect((dto as any).nested).toBeUndefined();
    });
  });
});

