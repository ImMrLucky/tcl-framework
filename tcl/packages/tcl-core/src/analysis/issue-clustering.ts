/**
 * Issue Clustering Module
 * 
 * Aggregates atomic issues into clustered/root-cause issues.
 * Prevents "issue spam" by grouping related issues together.
 * 
 * C2-C3: Cluster scoring and aggregation
 */

import { createHash } from 'crypto';
import type { IssueV2, AggregatedIssue, EvalMode, SeverityV2 } from '../types.js';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface ClusteringResult {
  aggregatedIssues: AggregatedIssue[];
  clusterMap: Map<string, IssueV2[]>; // clusterId -> atomic issues
}

/**
 * C2-C3: Aggregate atomic issues into clustered issues
 * Groups issues by clusterKey and computes cluster scores
 */
export function aggregateIssues(
  atomicIssues: IssueV2[],
  evalMode: EvalMode
): ClusteringResult {
  // Group issues by clusterId
  const clusterMap = new Map<string, IssueV2[]>();
  
  for (const issue of atomicIssues) {
    if (!issue.clusterId) {
      // Skip issues without clusterId (shouldn't happen, but handle gracefully)
      continue;
    }
    
    if (!clusterMap.has(issue.clusterId)) {
      clusterMap.set(issue.clusterId, []);
    }
    clusterMap.get(issue.clusterId)!.push(issue);
  }
  
  // Create aggregated issues from clusters
  const aggregatedIssues: AggregatedIssue[] = [];
  
  for (const [clusterId, clusterIssues] of Array.from(clusterMap.entries())) {
    if (clusterIssues.length === 0) continue;
    
    // Sort by riskScore DESC to get the worst-case issue first
    const sorted = clusterIssues.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
    const baseIssue = sorted[0];
    
    // C3: Cluster scoring
    const clusterScore = computeClusterScore(clusterIssues, evalMode);
    
    // Aggregate evidence
    const allRefs = clusterIssues.flatMap(i => i.evidence.refs || []);
    const allEdges = clusterIssues.flatMap(i => i.evidence.edges || []);
    const allClaimIds = new Set<string>();
    clusterIssues.forEach(i => {
      if (i.what?.primaryClaimId) allClaimIds.add(i.what.primaryClaimId);
      if (i.what?.relatedClaimIds) i.what.relatedClaimIds.forEach(id => allClaimIds.add(id));
    });
    
    // Aggregate turn indices
    const turnIndices = clusterIssues
      .map(i => i.who?.turnIndex)
      .filter((idx): idx is number => idx !== undefined);
    const firstTurnIndex = turnIndices.length > 0 ? Math.min(...turnIndices) : 0;
    const lastTurnIndex = turnIndices.length > 0 ? Math.max(...turnIndices) : 0;
    
    // Determine severity from cluster score
    const severity = deriveSeverityFromScore(clusterScore.riskScore);
    
    // Create aggregated issue
    const aggregated: AggregatedIssue = {
      clusterId,
      clusterKey: baseIssue.clusterKey || clusterId,
      category: baseIssue.category,
      type: baseIssue.type,
      title: generateClusterTitle(baseIssue, clusterIssues.length),
      summary: generateClusterSummary(baseIssue, clusterIssues.length),
      severity,
      riskScore: clusterScore.riskScore,
      occurrences: clusterIssues.length,
      firstTurnIndex,
      lastTurnIndex,
      verification: evalMode,
      reviewRequired: clusterIssues.some(i => i.reviewRequired),
      evidence: {
        refs: deduplicateRefs(allRefs),
        edges: deduplicateEdges(allEdges),
        atomicIssueIds: clusterIssues.map(i => i.issueId),
        claimIds: Array.from(allClaimIds),
      },
      scoring: clusterScore,
    };
    
    aggregatedIssues.push(aggregated);
  }
  
  // Sort aggregated issues by riskScore DESC, then severity, then occurrences
  aggregatedIssues.sort((a, b) => {
    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore;
    }
    const severityOrder: Record<SeverityV2, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    if (severityOrder[b.severity] !== severityOrder[a.severity]) {
      return severityOrder[b.severity] - severityOrder[a.severity];
    }
    return b.occurrences - a.occurrences;
  });
  
  return {
    aggregatedIssues,
    clusterMap,
  };
}

/**
 * C3: Compute cluster score from atomic scores
 * base = max(atomicRiskScores) - preserve worst-case
 * repBoost = clamp01(Math.log1p(occurrences)/5) - small boost for repeated failure
 * clusterPenalty01 = 1 / (1 + 0.25*(occurrences-1)) - penalty for spam
 * riskScore = clamp01((base + 0.15*repBoost) * clusterPenalty01 * verificationMultiplier)
 */
function computeClusterScore(
  clusterIssues: IssueV2[],
  evalMode: EvalMode
): AggregatedIssue['scoring'] & { riskScore: number } {
  const occurrences = clusterIssues.length;
  
  // Base: max atomic risk score (preserve worst-case)
  const base = Math.max(...clusterIssues.map(i => i.riskScore || 0));
  
  // Rep boost: small boost for repeated failure
  const repBoost = clamp01(Math.log1p(occurrences) / 5);
  
  // Cluster penalty: prevents issue spam (1.0 for first, then decays)
  const clusterPenalty01 = 1 / (1 + 0.25 * (occurrences - 1));
  
  // Verification multiplier
  const verificationMultiplier = evalMode.verificationLevel === 'TRANSCRIPT_ONLY' ? 0.85 :
                                  evalMode.verificationLevel === 'DOC_BACKED' ? 1.00 :
                                  1.10; // EXTERNALLY_VERIFIED
  
  // Compute cluster risk score
  const riskScore = clamp01((base + 0.15 * repBoost) * clusterPenalty01 * verificationMultiplier);
  
  // Aggregate component scores (weighted average)
  const components = clusterIssues
    .map(i => i.scoring?.components)
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  
  const avgImpact01 = components.length > 0
    ? components.reduce((sum, c) => sum + (c.impact01 || 0), 0) / components.length
    : 0;
  const avgSignal01 = components.length > 0
    ? components.reduce((sum, c) => sum + (c.signal01 || 0), 0) / components.length
    : 0;
  const avgEvidence01 = components.length > 0
    ? components.reduce((sum, c) => sum + (c.evidence01 || 0), 0) / components.length
    : 0;
  const avgCategory01 = components.length > 0
    ? components.reduce((sum, c) => sum + (c.category01 || 0), 0) / components.length
    : 0;
  
  // Aggregate reasons
  const reasons = new Set<string>();
  clusterIssues.forEach(i => {
    if (i.scoring?.reasons) {
      i.scoring.reasons.forEach(r => reasons.add(r));
    }
  });
  
  return {
    riskScore, // Add riskScore to return value
    components: {
      impact01: Math.round(avgImpact01 * 1000) / 1000,
      signal01: Math.round(avgSignal01 * 1000) / 1000,
      evidence01: Math.round(avgEvidence01 * 1000) / 1000,
      category01: Math.round(avgCategory01 * 1000) / 1000,
      clusterPenalty01: Math.round(clusterPenalty01 * 1000) / 1000,
      verificationMultiplier: Math.round(verificationMultiplier * 1000) / 1000,
    },
    reasons: Array.from(reasons),
  };
}

function deriveSeverityFromScore(riskScore: number): SeverityV2 {
  if (riskScore >= 0.90) return 'critical';
  if (riskScore >= 0.75) return 'high';
  if (riskScore >= 0.45) return 'medium';
  return 'low';
}

function generateClusterTitle(baseIssue: IssueV2, occurrences: number): string {
  if (occurrences === 1) {
    return baseIssue.what?.issueSummary || `${baseIssue.type} issue`;
  }
  return `${baseIssue.type} issue (${occurrences} occurrences)`;
}

function generateClusterSummary(baseIssue: IssueV2, occurrences: number): string {
  if (occurrences === 1) {
    return baseIssue.what?.issueDetail || baseIssue.what?.issueSummary || '';
  }
  return `${baseIssue.what?.issueSummary || baseIssue.type} - This issue appears ${occurrences} times in the conversation, indicating a pattern of inconsistency or error.`;
}

function deduplicateRefs(refs: any[]): any[] {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = `${ref.sourceType}:${ref.sourceId}:${ref.quote?.substring(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateEdges(edges: any[]): any[] {
  const seen = new Set<string>();
  return edges.filter(edge => {
    const key = `${edge.kind}:${edge.claimA}:${edge.claimB || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

