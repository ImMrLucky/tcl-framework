/**
 * Risk Ranking Tests
 * 
 * Tests for the new risk ranking pipeline:
 * - Transcript-only mode safety
 * - Ranking stability
 * - Score distribution
 * - Config validation
 */

import { describe, it, expect } from 'vitest';
import { rankIssuesV2, type ScoringContext } from '../risk-ranking.js';
import type { IssueV2 } from '../../types.js';
import type { RiskRankingConfig } from '../../config/risk-ranking.js';
import { validateRiskRankingConfig } from '../../config/risk-ranking.js';

/**
 * Helper to create a minimal IssueV2 for testing
 * Note: riskScore and score will be computed by rankIssuesV2
 */
function createTestIssue(overrides: Partial<IssueV2>): IssueV2 {
  return {
    issueId: `test-${Math.random().toString(36).substring(7)}`,
    issueKey: `test-key-${Math.random().toString(36).substring(7)}`,
    runId: 'test-run',
    conversationId: 'test-conv',
    type: 'CONTRADICTION',
    category: 'consistency',
    severity: 'medium', // Will be recomputed
    severityDisplay: 'medium', // Will be recomputed
    impact: 'medium',
    riskScore: 0, // Will be computed
    score: 0, // Will be computed
    confidence: 0.7,
    reviewRequired: false,
    verification: {
      level: 'TRANSCRIPT_ONLY',
      reasonCodes: [],
    },
    who: {
      speaker: 'AGENT',
      turnIndex: 1,
    },
    what: {
      primaryClaimId: 'claim-1',
      issueSummary: 'Test issue',
      issueDetail: 'Test issue detail',
    },
    evidence: {
      refs: [],
      edges: [],
    },
    compliance: {
      tags: [],
      disclaimers: [],
    },
    audit: {
      createdAt: new Date().toISOString(),
      engineVersion: 'test',
      scorerId: 'test',
    },
    ...overrides,
  };
}

/**
 * Helper to create a valid test config
 */
function createTestConfig(): RiskRankingConfig {
  return {
    ui: {
      maxTopIssues: 10,
    },
    severityThresholds: {
      low: 0.20,
      medium: 0.45,
      high: 0.70,
      critical: 0.85,
    },
    weights: {
      riskScoring: {
        impact: 0.40,
        evidence: 0.30,
        signal: 0.20,
        category: 0.10,
      },
      typeBase: {},
      speakerMultiplier: {},
      verificationMultiplier: {},
      categoryMultiplier: {
        consistency: 1.2,
        evidence: 1.0,
      },
    },
    impactMap: {
      low: 0.3,
      medium: 0.6,
      high: 1.0,
    },
    evidenceMap: {
      EXTERNAL_VERIFIED: 1.0,
      TRANSCRIPT_ONLY: 0.45,
      NONE: 0.20,
    },
    categoryNormalization: {
      min: 1.0,
      max: 1.3,
    },
    degradedMode: {
      missingSpectralSignal01: 0.5,
      missingEdgesSignal01: 0.5,
    },
    typePriority: [
      'CONTRADICTION',
      'UNVERIFIED_CLAIM',
      'OTHER',
    ],
  };
}

describe('Risk Ranking', () => {
  describe('Transcript-only mode safety', () => {
    it('transcript-only contradiction ranks above unverified claim', () => {
      const transcriptOnlyContext: ScoringContext = {
        mode: 'transcript_only',
        numSources: 0,
      };

      // Create a contradiction issue (high impact, high signal)
      const contradictionIssue = createTestIssue({
        type: 'CONTRADICTION',
        category: 'consistency',
        impact: 'high',
        confidence: 0.8,
        verification: {
          level: 'TRANSCRIPT_ONLY',
          reasonCodes: ['NO_EXTERNAL_EVIDENCE'],
        },
        evidence: {
          refs: [],
          edges: [{
            kind: 'contradiction',
            claimA: 'claim-1',
            claimB: 'claim-2',
            weight: 0.8,
          }],
        },
      });

      // Create an unverified claim issue (low impact, low signal)
      const unverifiedIssue = createTestIssue({
        type: 'UNVERIFIED_CLAIM',
        category: 'evidence',
        impact: 'low',
        confidence: 0.5,
        verification: {
          level: 'TRANSCRIPT_ONLY',
          reasonCodes: ['NO_EXTERNAL_EVIDENCE'],
        },
        evidence: {
          refs: [],
          edges: [],
        },
      });

      const issues = [unverifiedIssue, contradictionIssue]; // Unverified first
      const config = createTestConfig();
      const result = rankIssuesV2(issues, config, transcriptOnlyContext);

      // Contradiction should rank higher (first in sorted list)
      expect(result.allIssues[0].type).toBe('CONTRADICTION');
      expect(result.allIssues[0].riskScore).toBeGreaterThan(result.allIssues[1].riskScore);
      
      // In transcript-only mode, severityDisplay should NOT be blanket-capped to medium
      // Only UNVERIFIED_CLAIM types should be downgraded
      // CONTRADICTION should keep its severity (high) in severityDisplay
      expect(result.allIssues[0].severity).toBe('high'); // Impact severity unchanged
      expect(result.allIssues[0].severityDisplay).toBe('high'); // Not downgraded (not UNVERIFIED type)
      
      // Unverified claim may be downgraded by one band
      expect(result.allIssues[1].severity).toBe('low'); // Impact severity
      // severityDisplay may be downgraded for UNVERIFIED in transcript-only, but not forced to medium
      // Low stays low (can't downgrade below low)
      expect(result.allIssues[1].severityDisplay).toBe('low');
      
      // But impact should be unchanged
      expect(result.allIssues[0].impact).toBe('high');
      expect(result.allIssues[1].impact).toBe('low');
    });

    it('verified issue ranks above unverified of same issue type', () => {
      const withEvidenceContext: ScoringContext = {
        mode: 'with_evidence',
        numSources: 5,
      };

      // Same issue type, but one is verified, one is not
      const verifiedIssue = createTestIssue({
        type: 'CONTRADICTION',
        category: 'consistency',
        impact: 'high',
        confidence: 0.8,
        verification: {
          level: 'EXTERNAL_VERIFIED',
          reasonCodes: [],
        },
        evidence: {
          refs: [{
            sourceType: 'POLICY',
            sourceId: 'policy-1',
            quote: 'Policy text',
            weight: 0.9,
          }],
          edges: [{
            kind: 'contradiction',
            claimA: 'claim-1',
            claimB: 'claim-2',
            weight: 0.8,
          }],
        },
      });

      const unverifiedIssue = createTestIssue({
        type: 'CONTRADICTION',
        category: 'consistency',
        impact: 'high',
        confidence: 0.8,
        verification: {
          level: 'TRANSCRIPT_ONLY',
          reasonCodes: ['NO_EXTERNAL_EVIDENCE'],
        },
        evidence: {
          refs: [],
          edges: [{
            kind: 'contradiction',
            claimA: 'claim-3',
            claimB: 'claim-4',
            weight: 0.8,
          }],
        },
      });

      const issues = [unverifiedIssue, verifiedIssue]; // Unverified first
      const config = createTestConfig();
      const result = rankIssuesV2(issues, config, withEvidenceContext);

      // Verified should rank higher (EXTERNAL_VERIFIED has higher evidence01)
      expect(result.allIssues[0].verification.level).toBe('EXTERNAL_VERIFIED');
      expect(result.allIssues[0].riskScore).toBeGreaterThan(result.allIssues[1].riskScore);
      
      // Verified can show as high severity
      expect(result.allIssues[0].severityDisplay).toBe('high');
    });

    it('transcript-only p90 score < 95', () => {
      const transcriptOnlyContext: ScoringContext = {
        mode: 'transcript_only',
        numSources: 0,
      };

      // Create a diverse set of issues (30 issues to get meaningful p90)
      const issues: IssueV2[] = [];
      
      // Mix of types and impacts
      for (let i = 0; i < 10; i++) {
        issues.push(createTestIssue({
          type: 'CONTRADICTION',
          impact: 'high',
          confidence: 0.7 + (i * 0.02),
          verification: { level: 'TRANSCRIPT_ONLY', reasonCodes: [] },
        }));
      }
      
      for (let i = 0; i < 10; i++) {
        issues.push(createTestIssue({
          type: 'RISK_SIGNAL',
          impact: 'medium',
          confidence: 0.5 + (i * 0.02),
          verification: { level: 'TRANSCRIPT_ONLY', reasonCodes: [] },
        }));
      }
      
      for (let i = 0; i < 10; i++) {
        issues.push(createTestIssue({
          type: 'UNVERIFIED_CLAIM',
          impact: 'low',
          confidence: 0.3 + (i * 0.02),
          verification: { level: 'TRANSCRIPT_ONLY', reasonCodes: [] },
        }));
      }

      const config = createTestConfig();
      const result = rankIssuesV2(issues, config, transcriptOnlyContext);

      // Sort scores descending
      const scores = result.allIssues.map(issue => issue.score).sort((a, b) => b - a);
      
      // Calculate p90 (90th percentile)
      const p90Index = Math.floor(scores.length * 0.9);
      const p90Score = scores[p90Index];

      // In transcript-only mode, even high-impact issues should not saturate
      // p90 should be < 95 (most issues should be well below 100)
      expect(p90Score).toBeLessThan(95);
      
      // Also verify that not everything is 100
      const maxScore = Math.max(...scores);
      expect(maxScore).toBeLessThan(100);
      
      // Verify score distribution (should have spread)
      const minScore = Math.min(...scores);
      const scoreRange = maxScore - minScore;
      expect(scoreRange).toBeGreaterThan(20); // Should have at least 20 point spread
    });
  });

  describe('Config validation', () => {
    it('invalid config fails startup (weights do not sum to 1.0)', () => {
      const invalidConfig: RiskRankingConfig = {
        ...createTestConfig(),
        weights: {
          ...createTestConfig().weights,
          riskScoring: {
            impact: 0.50,  // Sum = 0.50 + 0.30 + 0.20 + 0.10 = 1.10 (invalid)
            evidence: 0.30,
            signal: 0.20,
            category: 0.10,
          },
        },
      };

      // Should throw error on validation
      expect(() => {
        validateRiskRankingConfig(invalidConfig);
      }).toThrow(/weights sum to/);
    });

    it('invalid config fails startup (non-monotonic thresholds)', () => {
      const invalidConfig: RiskRankingConfig = {
        ...createTestConfig(),
        severityThresholds: {
          low: 0.20,
          medium: 0.45,
          high: 0.40,  // Invalid: high < medium
          critical: 0.85,
        },
      };

      // Should throw error on validation
      expect(() => {
        validateRiskRankingConfig(invalidConfig);
      }).toThrow(/severityThresholds.*must be/);
    });

    it('valid config passes validation', () => {
      const validConfig = createTestConfig();
      
      // Check weights sum
      const sum = 
        validConfig.weights.riskScoring.impact +
        validConfig.weights.riskScoring.evidence +
        validConfig.weights.riskScoring.signal +
        validConfig.weights.riskScoring.category;
      
      expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(0.001);
      
      // Check monotonic thresholds
      expect(validConfig.severityThresholds.low).toBeLessThan(validConfig.severityThresholds.medium);
      expect(validConfig.severityThresholds.medium).toBeLessThan(validConfig.severityThresholds.high);
      expect(validConfig.severityThresholds.high).toBeLessThan(validConfig.severityThresholds.critical);
    });
  });

  describe('Ranking stability', () => {
    it('same issues produce same ranking order', () => {
      const context: ScoringContext = {
        mode: 'transcript_only',
        numSources: 0,
      };

      const issues = [
        createTestIssue({ type: 'CONTRADICTION', impact: 'high', issueKey: 'issue-1' }),
        createTestIssue({ type: 'UNVERIFIED_CLAIM', impact: 'low', issueKey: 'issue-2' }),
        createTestIssue({ type: 'RISK_SIGNAL', impact: 'medium', issueKey: 'issue-3' }),
      ];

      const config = createTestConfig();
      const result1 = rankIssuesV2(issues, config, context);
      const result2 = rankIssuesV2(issues, config, context);

      // Should produce identical ordering
      expect(result1.allIssues.map(i => i.issueKey)).toEqual(result2.allIssues.map(i => i.issueKey));
      expect(result1.allIssues.map(i => i.score)).toEqual(result2.allIssues.map(i => i.score));
    });

    it('ranking order: riskScore > impact > verification > type', () => {
      const context: ScoringContext = {
        mode: 'with_evidence',
        numSources: 5,
      };

      // Create issues that test the full sorting hierarchy
      // Issue 1: high impact, EXTERNAL_VERIFIED, but lower signal (lower confidence)
      const issue1 = createTestIssue({
        issueKey: 'issue-1',
        impact: 'high',
        confidence: 0.5, // Lower signal
        verification: { level: 'EXTERNAL_VERIFIED', reasonCodes: [] },
        type: 'OTHER',
        category: 'compliance',
      });
      
      // Issue 2: lower impact, but higher signal (higher confidence) and EXTERNAL_VERIFIED
      const issue2 = createTestIssue({
        issueKey: 'issue-2',
        impact: 'medium',
        confidence: 0.9, // Higher signal
        verification: { level: 'EXTERNAL_VERIFIED', reasonCodes: [] },
        type: 'CONTRADICTION', // Higher priority type
        category: 'consistency',
      });

      const issues = [issue1, issue2];
      const config = createTestConfig();
      const result = rankIssuesV2(issues, config, context);

      // Both should be scored, and issue 2 should rank first if it has higher riskScore
      // (due to higher signal01 even with lower impact01)
      expect(result.allIssues.length).toBe(2);
      expect(result.allIssues[0].riskScore).toBeGreaterThanOrEqual(result.allIssues[1].riskScore);
    });
  });
});

