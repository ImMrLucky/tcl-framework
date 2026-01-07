/**
 * Scoring Tests
 * 
 * Tests for production-grade scoring math (deterministic + calibrated).
 */

import { describe, it, expect } from 'vitest';
import { computeImpactSeverity } from '../impact-severity.js';
import { computeConfidence, computeConfidenceBand } from '../confidence.js';
import { computeRiskScore, computeRankScore } from '../risk-score.js';
import type { IssueSignals } from '../../contracts/issue.contract.js';

describe('computeImpactSeverity', () => {
  it('should return critical for critical compliance flags', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
      complianceFlags: ['PCI_CVV_STORAGE'],
    };

    const severity = computeImpactSeverity('UNVERIFIED_CLAIM', 'compliance', signals);
    expect(severity).toBe('critical');
  });

  it('should return high for money contradictions', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: true,
      hasSupportEdge: false,
      contradictionStrength: 0.8,
      amountsDetected: [100.50],
    };

    const severity = computeImpactSeverity('CONTRADICTION', 'billing', signals);
    expect(severity).toBe('high');
  });

  it('should return medium for high-impact types without money', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
    };

    const severity = computeImpactSeverity('CONTRADICTION', 'evidence', signals);
    expect(severity).toBe('medium');
  });

  it('should return medium for UNVERIFIED_CLAIM (medium-impact type)', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
    };

    const severity = computeImpactSeverity('UNVERIFIED_CLAIM', 'other', signals);
    // UNVERIFIED_CLAIM is a medium-impact type, so should return medium
    expect(severity).toBe('medium');
  });

  it('should return low for truly low-impact issues', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
    };

    // Use a type that's not in any impact rules
    const severity = computeImpactSeverity('OTHER', 'other', signals);
    expect(severity).toBe('low');
  });
});

describe('computeConfidence', () => {
  it('should return high confidence for EXTERNALLY_VERIFIED with support edge', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: true,
      supportStrength: 0.9,
    };

    const confidence = computeConfidence(signals, 'EXTERNALLY_VERIFIED', 'UNVERIFIED_CLAIM');
    expect(confidence).toBeGreaterThan(0.7);
    expect(confidence).toBeLessThanOrEqual(1.0);
  });

  it('should return medium confidence for DOC_BACKED with support edge', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: true,
      supportStrength: 0.8,
    };

    const confidence = computeConfidence(signals, 'DOC_BACKED', 'UNVERIFIED_CLAIM');
    expect(confidence).toBeGreaterThan(0.5);
    expect(confidence).toBeLessThanOrEqual(0.8);
  });

  it('should return medium/high confidence for TRANSCRIPT_ONLY with strong contradiction', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: true,
      hasSupportEdge: false,
      contradictionStrength: 0.8,
    };

    const confidence = computeConfidence(signals, 'TRANSCRIPT_ONLY', 'CONTRADICTION');
    expect(confidence).toBeGreaterThan(0.5);
  });

  it('should return low confidence for TRANSCRIPT_ONLY unverified claims', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
    };

    const confidence = computeConfidence(signals, 'TRANSCRIPT_ONLY', 'UNVERIFIED_CLAIM');
    expect(confidence).toBeLessThan(0.4);
  });
});

describe('computeConfidenceBand', () => {
  it('should return high for confidence >= 0.7', () => {
    expect(computeConfidenceBand(0.8)).toBe('high');
    expect(computeConfidenceBand(0.7)).toBe('high');
  });

  it('should return medium for confidence >= 0.4 and < 0.7', () => {
    expect(computeConfidenceBand(0.6)).toBe('medium');
    expect(computeConfidenceBand(0.4)).toBe('medium');
  });

  it('should return low for confidence < 0.4', () => {
    expect(computeConfidenceBand(0.3)).toBe('low');
    expect(computeConfidenceBand(0.0)).toBe('low');
  });
});

describe('computeRiskScore', () => {
  it('should compute risk score from severity, confidence, and signals', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
      spectralEnergy: 0.5,
      centrality: 0.3,
    };

    const riskScore = computeRiskScore('high', 0.8, signals);
    expect(riskScore).toBeGreaterThan(0);
    expect(riskScore).toBeLessThanOrEqual(1.0);
  });

  it('should apply spectral energy multiplier', () => {
    const signalsLow: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
      spectralEnergy: 0.0,
    };
    const signalsHigh: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
      spectralEnergy: 1.0,
    };

    const riskLow = computeRiskScore('high', 0.8, signalsLow);
    const riskHigh = computeRiskScore('high', 0.8, signalsHigh);
    expect(riskHigh).toBeGreaterThan(riskLow);
  });

  it('should clamp to [0..1]', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: false,
      hasSupportEdge: false,
      spectralEnergy: 10.0, // Extreme value
      centrality: 10.0,
    };

    const riskScore = computeRiskScore('critical', 1.0, signals);
    expect(riskScore).toBeLessThanOrEqual(1.0);
  });
});

describe('computeRankScore', () => {
  it('should compute rank score from risk score and signals', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: true,
      hasSupportEdge: false,
      contradictionStrength: 0.7,
      spectralEnergy: 0.6,
    };

    const rankScore = computeRankScore(0.8, signals);
    expect(rankScore).toBeGreaterThan(0);
    expect(rankScore).toBeLessThanOrEqual(1.0);
  });

  it('should weight risk score more than contradiction/spectral', () => {
    const signals: IssueSignals = {
      hasContradictionEdge: true,
      hasSupportEdge: false,
      contradictionStrength: 0.5,
      spectralEnergy: 0.5,
    };

    const rankScore = computeRankScore(0.8, signals);
    // Risk score (0.55 * 0.8 = 0.44) should dominate
    expect(rankScore).toBeGreaterThan(0.4);
  });
});

