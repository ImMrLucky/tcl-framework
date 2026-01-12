/**
 * Issue Cluster Collapse Module
 * 
 * Collapses atomic issues into grouped/clustered issues for "Top Issues (Grouped)" table.
 * Groups all issues with the same clusterId into a single rollup row.
 * 
 * Spec: Rename "Atomic vs Grouped" + Implement topIssuesV2 Cluster Collapsing
 */

import type { IssueV2, GroupedIssue, VerificationLevelV2, SeverityV2, SeverityDisplayV2 } from '../types.js';

/**
 * Collapse atomic issues into grouped clusters
 * Groups by clusterId and creates one GroupedIssue per cluster
 */
export function collapseIssuesToClusters(atomicIssues: IssueV2[]): GroupedIssue[] {
  // Group issues by clusterId
  const clusterMap = new Map<string, IssueV2[]>();
  
  for (const issue of atomicIssues) {
    if (!issue.clusterId) {
      // Skip issues without clusterId (they can't be grouped)
      continue;
    }
    
    if (!clusterMap.has(issue.clusterId)) {
      clusterMap.set(issue.clusterId, []);
    }
    clusterMap.get(issue.clusterId)!.push(issue);
  }
  
  // Create grouped issues from clusters
  const groupedIssues: GroupedIssue[] = [];
  
  for (const [clusterId, clusterIssues] of Array.from(clusterMap.entries())) {
    if (clusterIssues.length === 0) continue;
    
    // 1) riskScore: Use max riskScore in the cluster
    const maxRiskScore = Math.max(...clusterIssues.map(i => i.riskScore || 0));
    
    // 2) confidence: Use max confidence
    const maxConfidence = Math.max(...clusterIssues.map(i => i.confidence || 0));
    
    // 3) severity: Use the severity of the highest-risk member
    const highestRiskIssue = clusterIssues.reduce((max, issue) => 
      (issue.riskScore || 0) > (max.riskScore || 0) ? issue : max
    );
    const clusterSeverity: SeverityV2 = highestRiskIssue.severity || 'low';
    
    // severityDisplay: Use the severityDisplay of the highest-risk member
    const clusterSeverityDisplay: SeverityDisplayV2 = 
      (highestRiskIssue.severityDisplay || clusterSeverity) as SeverityDisplayV2;
    
    // 4) verification: If any atomic issue is externally verified, mark cluster as verified
    const verificationLevels: VerificationLevelV2[] = clusterIssues
      .map(i => i.verification?.level)
      .filter((level): level is VerificationLevelV2 => level !== undefined);
    
    // Order: EXTERNAL_VERIFIED > TRANSCRIPT_PROVABLE > TRANSCRIPT_ONLY > NONE
    const verificationOrder: Partial<Record<VerificationLevelV2, number>> = {
      'EXTERNAL_VERIFIED': 4,
      'TRANSCRIPT_PROVABLE': 3,
      'TRANSCRIPT_ONLY': 2,
      'NONE': 1,
    };
    
    const maxVerification = verificationLevels.reduce((max, level) => {
      const maxOrder = verificationOrder[max] || 0;
      const levelOrder = verificationOrder[level] || 0;
      return levelOrder > maxOrder ? level : max;
    }, 'NONE' as VerificationLevelV2);
    
    // Get reason codes from all issues
    const allReasonCodes = new Set<string>();
    clusterIssues.forEach(i => {
      if (i.verification?.reasonCodes) {
        i.verification.reasonCodes.forEach(code => allReasonCodes.add(code));
      }
    });
    
    // 5) Representative issue: Choose based on priority
    // Priority: compliance > policy > contradiction > unsupported
    const typePriority: Record<string, number> = {
      'PCI': 10,
      'SECURITY': 9,
      'PRIVACY': 8,
      'POLICY': 7,
      'CONTRADICTION': 6,
      'UNSUPPORTED_CLAIM': 5,
      'UNVERIFIED_CLAIM': 4,
      'DATA_INTEGRITY': 7,
      'FEE_DISCLOSURE_RISK': 6,
      'COMMITMENT_INCONSISTENCY': 5,
      'NUMERIC_MISMATCH': 4,
      'OTHER': 1,
    };
    
    const representativeIssue = clusterIssues.reduce((best, issue) => {
      const bestPriority = typePriority[best.type] || 0;
      const issuePriority = typePriority[issue.type] || 0;
      if (issuePriority > bestPriority) return issue;
      if (issuePriority === bestPriority && (issue.riskScore || 0) > (best.riskScore || 0)) return issue;
      return best;
    });
    
    // 6) Aggregate involvedClaimIds and turnIndexes
    const involvedClaimIds = new Set<string>();
    const involvedTurnIndexes = new Set<number>();
    
    clusterIssues.forEach(issue => {
      if (issue.what?.primaryClaimId) {
        involvedClaimIds.add(issue.what.primaryClaimId);
      }
      if (issue.what?.relatedClaimIds) {
        issue.what.relatedClaimIds.forEach(id => involvedClaimIds.add(id));
      }
      if (issue.who?.turnIndex !== undefined) {
        involvedTurnIndexes.add(issue.who.turnIndex);
      }
      // Also check evidence.verification.provenance.transcriptAnchors
      if (issue.evidence?.verification?.provenance?.transcriptAnchors) {
        issue.evidence.verification.provenance.transcriptAnchors.forEach(anchor => {
          if (anchor.turnIndex !== undefined) {
            involvedTurnIndexes.add(anchor.turnIndex);
          }
        });
      }
    });
    
    // 7) topEdges: Collect edges from all atomic issues and keep top 3 by weight
    const allEdges = clusterIssues.flatMap(i => i.evidence?.edges || []);
    const topEdges = allEdges
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 3);
    
    // Aggregate refs (quotes, doc refs)
    const allRefs = clusterIssues.flatMap(i => i.evidence?.refs || []);
    const topRefs = allRefs
      .filter(ref => ref.quote || ref.sourceId)
      .slice(0, 5); // Top 5 refs for display
    
    // Get best topicId and slotKey from cluster
    const topicIds = clusterIssues
      .map(i => i.topicId)
      .filter((id): id is string => id !== undefined && id !== 'unknown');
    const slotKeys = clusterIssues
      .map(i => i.slotKey)
      .filter((key): key is string => key !== undefined && key !== 'unknown');
    
    // Get audit info from representative issue
    const audit = representativeIssue.audit || {
      scorerId: 'unknown',
      createdAt: new Date().toISOString(),
      engineVersion: 'unknown',
    };
    
    // Build grouped issue
    const grouped: GroupedIssue = {
      clusterId,
      clusterKey: representativeIssue.clusterKey || clusterId,
      category: representativeIssue.category,
      type: representativeIssue.type,
      topicId: topicIds[0] || representativeIssue.topicId,
      slotKey: slotKeys[0] || representativeIssue.slotKey,
      severity: clusterSeverity,
      severityDisplay: clusterSeverityDisplay,
      riskScore: maxRiskScore,
      score: Math.round(maxRiskScore * 100),
      confidence: maxConfidence,
      impact: representativeIssue.impact,
      reviewRequired: clusterIssues.some(i => i.reviewRequired),
      verification: {
        level: maxVerification,
        reasonCodes: Array.from(allReasonCodes),
      },
      what: {
        issueSummary: representativeIssue.what?.issueSummary || 'No summary available',
        issueDetail: representativeIssue.what?.issueDetail,
        representativeClaimText: representativeIssue.what?.claimText,
        primaryClaimId: representativeIssue.what?.primaryClaimId || '',
        relatedClaimIds: Array.from(involvedClaimIds).filter(id => 
          id !== representativeIssue.what?.primaryClaimId
        ),
      },
      rollup: {
        atomicIssueCount: clusterIssues.length,
        atomicIssueIds: clusterIssues.map(i => i.issueId),
        issueKeys: clusterIssues.map(i => i.issueKey),
        involvedClaimIds: Array.from(involvedClaimIds),
        involvedTurnIndexes: Array.from(involvedTurnIndexes).sort((a, b) => a - b),
        topEdges: topEdges.length > 0 ? topEdges : undefined,
        refs: topRefs.length > 0 ? topRefs.map(ref => ({
          quote: ref.quote,
          sourceId: ref.sourceId,
          sourceType: ref.sourceType,
          turnIndex: ref.turnIndex,
        })) : undefined,
      },
      audit: {
        scorerId: audit.scorerId,
        createdAt: audit.createdAt,
        engineVersion: audit.engineVersion,
        inputHash: audit.inputHash,
        configHash: audit.configHash,
      },
    };
    
    groupedIssues.push(grouped);
  }
  
  // Sort grouped clusters by: severity > riskScore > confidence > atomicIssueCount
  groupedIssues.sort((a, b) => {
    // Primary: severity (high > medium > low)
    const severityOrder: Record<SeverityV2, number> = {
      'critical': 4,
      'high': 3,
      'medium': 2,
      'low': 1,
    };
    const severityA = severityOrder[a.severity] || 0;
    const severityB = severityOrder[b.severity] || 0;
    if (severityB !== severityA) {
      return severityB - severityA; // DESC
    }
    
    // Secondary: riskScore DESC
    if (b.riskScore !== a.riskScore) {
      return b.riskScore - a.riskScore; // DESC
    }
    
    // Tertiary: confidence DESC
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence; // DESC
    }
    
    // Quaternary: atomicIssueCount DESC (tie-breaker)
    return b.rollup.atomicIssueCount - a.rollup.atomicIssueCount; // DESC
  });
  
  return groupedIssues;
}

