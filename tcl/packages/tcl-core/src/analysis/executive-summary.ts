/**
 * Executive Summary Module
 * 
 * E1-E3: Compute root-cause driven executive summary from aggregated issues
 * 
 * The summary should be derived from aggregatedIssues, not raw atomic issues.
 * This ensures the summary reflects root causes, not edge spam.
 */

import type { AggregatedIssue, ExecutiveSummary, EvalMode, SeverityV2 } from '../types.js';

export interface ExecutiveSummaryInput {
  aggregatedIssues: AggregatedIssue[];
  truthScore: number | null;
  coherenceScore: number | null;
  consistencyScore: number | null;
  evalMode: EvalMode;
}

/**
 * E1-E3: Compute executive summary from aggregated issues
 */
export function computeExecutiveSummary(input: ExecutiveSummaryInput): ExecutiveSummary {
  const { aggregatedIssues, truthScore, coherenceScore, consistencyScore, evalMode } = input;
  
  // E2: Compute overallRiskScore from aggregated issues
  const overallRiskScore = computeOverallRiskScore(aggregatedIssues, coherenceScore);
  
  // Count findings by severity (from aggregated issues, not atomic)
  const criticalFindings = aggregatedIssues.filter(i => i.severity === 'critical').length;
  const highFindings = aggregatedIssues.filter(i => i.severity === 'high').length;
  const mediumFindings = aggregatedIssues.filter(i => i.severity === 'medium').length;
  const lowFindings = aggregatedIssues.filter(i => i.severity === 'low').length;
  
  // E1: Top root causes from aggregated issues
  const topRootCauses = aggregatedIssues
    .slice(0, 5) // Top 5 clusters
    .map(issue => ({
      title: issue.title,
      severity: issue.severity,
      riskScore: issue.riskScore,
      occurrences: issue.occurrences,
    }));
  
  // E1: Recommended actions from aggregated issues
  const recommendedActions = generateRecommendedActions(aggregatedIssues, evalMode);
  
  // E3: Audit defensibility from mode + evidenceCoverage01
  const auditDefensibility = computeAuditDefensibility(evalMode);
  
  // E3: Disclaimers
  const disclaimers: string[] = [];
  if (evalMode.verificationLevel === 'TRANSCRIPT_ONLY') {
    disclaimers.push('This analysis is based on transcript content only and has not been externally verified against policy documents, billing records, or other external evidence sources.');
  }
  if (evalMode.evidenceCoverage01 < 0.5) {
    disclaimers.push(`Low evidence coverage (${Math.round(evalMode.evidenceCoverage01 * 100)}%): Some high-impact claims lack supporting evidence.`);
  }
  
  return {
    overallRiskScore,
    truthScore: truthScore ?? 0,
    coherenceScore: coherenceScore ?? 0,
    consistencyScore: consistencyScore ?? 0,
    verificationLevel: evalMode.verificationLevel,
    auditDefensibility,
    criticalFindings,
    highFindings,
    mediumFindings,
    lowFindings,
    topRootCauses,
    recommendedActions,
    disclaimers,
  };
}

/**
 * E2: Compute overallRiskScore from aggregated issues
 * overallRisk01 = clamp01(
 *   0.55 * topKWeightedRisk(aggregatedIssues, K=5) +
 *   0.25 * severityMass(aggregatedIssues) +
 *   0.20 * (1 - coherence01)
 * )
 */
function computeOverallRiskScore(
  aggregatedIssues: AggregatedIssue[],
  coherenceScore: number | null
): number {
  // Top K weighted risk (prioritizes top 5 clusters but avoids single giant value)
  const topK = aggregatedIssues.slice(0, 5);
  const topKWeightedRisk = topK.length > 0
    ? topK.reduce((sum, issue) => {
        // Weight by severity and occurrences (but cap to avoid single issue dominating)
        const weight = Math.min(1.0, 0.3 + (issue.occurrences / 10) * 0.2);
        return sum + (issue.riskScore * weight);
      }, 0) / topK.length
    : 0;
  
  // Severity mass: normalized count of high/critical clusters
  const highCriticalCount = aggregatedIssues.filter(
    i => i.severity === 'high' || i.severity === 'critical'
  ).length;
  const severityMass = aggregatedIssues.length > 0
    ? highCriticalCount / aggregatedIssues.length
    : 0;
  
  // Coherence penalty (1 - coherence01, but normalize to 0..1)
  const coherence01 = coherenceScore !== null ? (coherenceScore / 100) : 0.5;
  const coherencePenalty = 1 - coherence01;
  
  // E2: overallRisk01 = clamp01(0.55 * topKWeightedRisk + 0.25 * severityMass + 0.20 * coherencePenalty)
  const overallRisk01 = Math.max(0, Math.min(1,
    0.55 * topKWeightedRisk +
    0.25 * severityMass +
    0.20 * coherencePenalty
  ));
  
  // Convert to 0..100
  return Math.round(overallRisk01 * 100);
}

/**
 * Compute audit defensibility from mode + evidence coverage
 */
function computeAuditDefensibility(evalMode: EvalMode): "low" | "medium" | "high" {
  const level = evalMode.verificationLevel;
  if (level === 'EXTERNALLY_VERIFIED' && evalMode.evidenceCoverage01 >= 0.8) {
    return 'high';
  }
  if (level === 'DOC_BACKED' && evalMode.evidenceCoverage01 >= 0.6) {
    return 'medium';
  }
  if (level === 'TRANSCRIPT_ONLY' || evalMode.evidenceCoverage01 < 0.4) {
    return 'low';
  }
  return 'medium';
}

/**
 * Generate recommended actions from aggregated issues
 */
function generateRecommendedActions(
  aggregatedIssues: AggregatedIssue[],
  evalMode: EvalMode
): ExecutiveSummary['recommendedActions'] {
  const actions: ExecutiveSummary['recommendedActions'] = [];
  
  // Critical/high severity issues
  const criticalHighIssues = aggregatedIssues.filter(
    i => i.severity === 'critical' || i.severity === 'high'
  );
  
  if (criticalHighIssues.length > 0) {
    // Group by category
    const complianceIssues = criticalHighIssues.filter(i => i.category === 'compliance');
    const consistencyIssues = criticalHighIssues.filter(i => i.category === 'consistency');
    
    if (complianceIssues.length > 0) {
      const topCompliance = complianceIssues[0];
      actions.push({
        action: 'Immediate Compliance Review Required',
        reason: `${complianceIssues.length} compliance issue(s) detected, including ${topCompliance.type}`,
        linkedClusterId: topCompliance.clusterId,
      });
    }
    
    if (consistencyIssues.length > 0) {
      const topConsistency = consistencyIssues[0];
      actions.push({
        action: 'QA Review Recommended',
        reason: `${consistencyIssues.length} contradiction(s) detected indicating potential miscommunication or policy violation`,
        linkedClusterId: topConsistency.clusterId,
      });
    }
  }
  
  // Evidence coverage actions
  if (evalMode.verificationLevel === 'TRANSCRIPT_ONLY') {
    actions.push({
      action: 'Obtain External Evidence',
      reason: 'Analysis is based on transcript only. External verification against policies, billing records, or CRM data would strengthen audit defensibility.',
    });
  } else if (evalMode.evidenceCoverage01 < 0.6) {
    actions.push({
      action: 'Improve Evidence Coverage',
      reason: `Only ${Math.round(evalMode.evidenceCoverage01 * 100)}% of high-impact claims have supporting evidence. Additional documentation would improve audit readiness.`,
    });
  }
  
  // Review required actions
  const reviewRequiredIssues = aggregatedIssues.filter(i => i.reviewRequired);
  if (reviewRequiredIssues.length > 0) {
    actions.push({
      action: 'Schedule Quality Review',
      reason: `${reviewRequiredIssues.length} issue(s) flagged for manual review`,
    });
  }
  
  return actions;
}

