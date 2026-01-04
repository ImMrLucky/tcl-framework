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

/**
 * Rank issues by risk score (deterministic)
 */
export function rankIssuesV2(issues: IssueV2[], config?: RiskRankingConfig): RankedIssues {
  const rankingConfig = config || getRiskRankingConfig();
  
  // Compute risk scores for all issues
  const scoredIssues = issues.map(issue => computeRiskScore(issue, rankingConfig));
  
  // Sort deterministically
  const sorted = scoredIssues.sort((a, b) => {
    // Primary: riskScore desc
    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore;
    }
    
    // Secondary: severity priority (critical > high > medium > low)
    const severityOrder: Record<SeverityV2, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    if (severityOrder[b.severity] !== severityOrder[a.severity]) {
      return severityOrder[b.severity] - severityOrder[a.severity];
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
 * Compute risk score for a single issue
 * Formula: riskScore = clamp01(base * (0.6 + 0.4*edgeStrength) * speakerMult * verifyMult)
 */
function computeRiskScore(issue: IssueV2, config: RiskRankingConfig): IssueV2 {
  // Base score from type
  const typeBase = config.weights.typeBase[issue.type] || config.weights.typeBase.OTHER;
  
  // Edge strength: max(edge.weight) if present, else avg(evidence.weight), else confidence
  let edgeStrength = issue.confidence;
  if (issue.evidence.edges && issue.evidence.edges.length > 0) {
    edgeStrength = Math.max(...issue.evidence.edges.map(e => e.weight));
  } else if (issue.evidence.refs && issue.evidence.refs.length > 0) {
    const weights = issue.evidence.refs.map(r => r.weight || 0).filter(w => w > 0);
    if (weights.length > 0) {
      edgeStrength = weights.reduce((a, b) => a + b, 0) / weights.length;
    }
  }
  
  // Speaker multiplier
  const speakerMult = config.weights.speakerMultiplier[issue.who.speaker] || 1.0;
  
  // Verification multiplier
  const verifyMult = config.weights.verificationMultiplier[issue.verification.level] || 1.0;
  
  // Compute risk score
  const riskScore = clamp01(
    typeBase * (0.6 + 0.4 * edgeStrength) * speakerMult * verifyMult
  );
  
  // Determine severity from thresholds
  const severity = computeSeverity(riskScore, config.severityThresholds);
  
  // Update legal hold suggestion (high/critical + agent + disclosure/billing)
  const legalHoldSuggested = 
    (severity === 'high' || severity === 'critical') &&
    issue.who.speaker === 'AGENT' &&
    (issue.category === 'disclosure' || issue.category === 'billing');
  
  return {
    ...issue,
    riskScore,
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

