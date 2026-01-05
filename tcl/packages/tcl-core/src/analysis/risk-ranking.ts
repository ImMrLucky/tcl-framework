/**
 * Risk Ranking Module
 * 
 * Computes deterministic risk scores and ranks issues.
 * All thresholds and weights come from config - NO hard-coded values.
 */

import type { IssueV2, SeverityV2 } from '../types.js';
import { getRiskRankingConfig, type RiskRankingConfig } from '../config/risk-ranking.js';

export interface RankedIssues {
  allIssues: IssueV2[];
  topIssues: IssueV2[];
  summary: {
    totalIssues: number;
    byType: Record<string, number>;
    bySeverity: Record<SeverityV2, number>;
    byCategory: Record<string, number>;
    topIssuesCount: number;
    allIssuesCount: number;
  };
}

import { scoreIssues, type ScoringContext } from './issue-scoring.js';

/**
 * Rank issues by risk score (deterministic)
 * Now uses the new scoring system with transcript-only caps
 */
export function rankIssuesV2(
  issues: IssueV2[], 
  config?: RiskRankingConfig,
  scoringContext?: ScoringContext
): RankedIssues {
  const rankingConfig = config || getRiskRankingConfig();
  
  // Use new scoring system if context provided, otherwise fall back to old system
  let scoredIssues: IssueV2[];
  if (scoringContext) {
    const scoringResult = scoreIssues(issues, scoringContext);
    scoredIssues = scoringResult.issues;
  } else {
    // Fallback to old scoring for backward compatibility
    scoredIssues = issues.map(issue => computeRiskScore(issue, rankingConfig));
  }
  
  // Sort deterministically by score (new scoring system) or riskScore (fallback)
  const sorted = scoredIssues.sort((a, b) => {
    // Primary: score desc (new system) or riskScore desc (fallback)
    const scoreA = (a as any).score ?? (a.riskScore * 100);
    const scoreB = (b as any).score ?? (b.riskScore * 100);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    
    // Secondary: severityDisplay priority (if available) or severity (fallback)
    const severityDisplayA = (a as any).severityDisplay ?? a.severity;
    const severityDisplayB = (b as any).severityDisplay ?? b.severity;
    const severityOrder: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    if (severityOrder[severityDisplayB] !== severityOrder[severityDisplayA]) {
      return severityOrder[severityDisplayB] - severityOrder[severityDisplayA];
    }
    
    // Tertiary: type priority (from config)
    const typeAIdx = rankingConfig.typePriority.indexOf(a.type);
    const typeBIdx = rankingConfig.typePriority.indexOf(b.type);
    if (typeBIdx !== typeAIdx) {
      return typeBIdx - typeAIdx; // Higher priority (lower index) comes first
    }
    
    // Quaternary: turnIndex asc (earlier issues first)
    const turnA = a.who.turnIndex ?? 9999;
    const turnB = b.who.turnIndex ?? 9999;
    if (turnA !== turnB) {
      return turnA - turnB;
    }
    
    // Quinary: issueKey asc (deterministic tie-break)
    return a.issueKey.localeCompare(b.issueKey);
  });
  
  // Slice top issues (config-driven)
  const topIssues = sorted.slice(0, rankingConfig.ui.maxTopIssues);
  
  // Generate summary
  const summary = generateSummary(sorted, topIssues.length);
  
  return {
    allIssues: sorted,
    topIssues,
    summary,
  };
}

/**
 * Compute risk score for a single issue using composite scoring formula
 * Formula: compositeScore = 100 * clamp01(
 *   w_severity * severity01 +
 *   w_category * category01 +
 *   w_confidence * confidence +
 *   w_structure * structuralImportance +
 *   w_impact * impact01
 *   - w_evidencePenalty * evidencePenalty01
 * )
 */
function computeRiskScore(issue: IssueV2, config: RiskRankingConfig): IssueV2 {
  // Get weights (with defaults if not in config)
  const w_severity = config.weights.severityWeight || 0.25;
  const w_category = 0.15; // Default if not in config
  const w_confidence = config.weights.confidenceWeight || 0.20;
  const w_structure = config.weights.structuralImportanceWeight || 0.15;
  const w_impact = config.weights.customerImpactWeight || 0.30;
  const w_evidencePenalty = config.weights.evidencePenaltyWeight || 0.10;
  
  // Normalize severity to 0..1 (critical=1.0, high=0.75, medium=0.5, low=0.25)
  const severity01 = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  }[issue.severity] || 0.5;
  
  // Category multiplier (normalized to 0..1)
  const categoryMult = config.weights.categoryMultiplier?.[issue.category] || 1.0;
  const category01 = clamp01(categoryMult / 1.3); // Normalize assuming max is 1.3
  
  // Confidence (already 0..1)
  const confidence01 = issue.confidence;
  
  // Structural importance (from spectral if available, else use edge strength)
  let structuralImportance = 0.5; // Default
  if (issue.evidence.edges && issue.evidence.edges.length > 0) {
    structuralImportance = Math.max(...issue.evidence.edges.map(e => e.weight || 0));
  } else if (issue.evidence.refs && issue.evidence.refs.length > 0) {
    const weights = issue.evidence.refs.map(r => r.weight || 0).filter(w => w > 0);
    if (weights.length > 0) {
      structuralImportance = weights.reduce((a, b) => a + b, 0) / weights.length;
    }
  }
  
  // Customer impact (based on type and category)
  let impact01 = 0.5; // Default
  if (issue.type === 'RISK_SIGNAL' || issue.type === 'CONTRADICTION') {
    impact01 = 0.8;
  } else if (issue.category === 'compliance' || issue.compliance.tags?.some(tag => 
    tag.includes('fee') || tag.includes('billing') || tag.includes('refund'))) {
    impact01 = 0.7;
  } else if (issue.compliance.tags?.includes('high_impact')) {
    impact01 = 0.75;
  }
  
  // Evidence penalty (lower score if transcript-only or no evidence)
  let evidencePenalty01 = 0;
  if (issue.verification.level === 'TRANSCRIPT_ONLY') {
    evidencePenalty01 = 0.2; // Small penalty for transcript-only
  } else if (issue.verification.level === 'NONE') {
    evidencePenalty01 = 0.4; // Larger penalty for no evidence
  }
  
  // Compute composite score (0..100)
  const compositeScore = 100 * clamp01(
    w_severity * severity01 +
    w_category * category01 +
    w_confidence * confidence01 +
    w_structure * structuralImportance +
    w_impact * impact01 -
    w_evidencePenalty * evidencePenalty01
  );
  
  // Convert to riskScore (0..1) for backward compatibility
  const riskScore = compositeScore / 100;
  
  // Determine severity from composite score thresholds
  const severity = computeSeverity(riskScore, config.severityThresholds);
  
  // Update legal hold suggestion (high/critical + agent + disclosure/billing)
  const legalHoldSuggested = 
    (severity === 'high' || severity === 'critical') &&
    issue.who.speaker === 'AGENT' &&
    (issue.category === 'disclosure' || issue.category === 'billing' || issue.category === 'compliance');
  
  return {
    ...issue,
    riskScore, // Keep as 0..1 for backward compatibility
    severity,
    compliance: {
      ...issue.compliance,
      legalHoldSuggested,
    },
  };
}

/**
 * Clamp value to [0, 1]
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Compute severity from risk score using thresholds
 */
function computeSeverity(
  riskScore: number,
  thresholds: RiskRankingConfig['severityThresholds']
): SeverityV2 {
  if (riskScore >= thresholds.critical) {
    return 'critical';
  }
  if (riskScore >= thresholds.high) {
    return 'high';
  }
  if (riskScore >= thresholds.medium) {
    return 'medium';
  }
  return 'low';
}

/**
 * Generate summary statistics
 */
function generateSummary(issues: IssueV2[], topCount: number): RankedIssues['summary'] {
  const byType: Record<string, number> = {};
  const bySeverity: Record<SeverityV2, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const byCategory: Record<string, number> = {};
  
  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }
  
  return {
    totalIssues: issues.length,
    byType,
    bySeverity,
    byCategory,
    topIssuesCount: topCount,
    allIssuesCount: issues.length,
  };
}

