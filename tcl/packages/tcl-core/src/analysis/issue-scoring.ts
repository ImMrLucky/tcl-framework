import type { IssueV2, ImpactV2, SeverityDisplayV2, VerificationLevelV2, RecommendedActionType } from '../types.js';
import { getIssueScoringConfig, type IssueScoringConfig } from '../config/issue-scoring.js';

export interface ScoringContext {
  mode: 'transcript_only' | 'with_evidence';
  numSources: number;
  graphStatus?: string;
  templateId?: string;
  isRegulatedTemplate?: boolean;
}

export interface ScoredIssue extends IssueV2 {
  impact: ImpactV2;
  severityDisplay: SeverityDisplayV2;
  score: number;
  scoreBreakdown: {
    impactScore: number;
    verificationScore: number;
    disputeScore: number;
    contradictionScore: number;
    commitmentScore: number;
    escalationScore: number;
    templateScore: number;
    penalties: {
      transcriptOnlyCapPenalty?: number;
      [key: string]: number | undefined;
    };
  };
  severityReason: string[];
  capsApplied: string[];
  recommendedAction: {
    actionType: RecommendedActionType;
    explanation: string;
    requiredEvidence?: string[];
  };
}

/**
 * Score issues with transcript-only caps and proper ranking
 */
export function scoreIssues(
  issues: IssueV2[],
  context: ScoringContext,
  config?: IssueScoringConfig
): { issues: ScoredIssue[]; diagnostics: any } {
  const scoringConfig = config || getIssueScoringConfig();
  const scoredIssues: ScoredIssue[] = [];

  for (const issue of issues) {
    const scored = scoreSingleIssue(issue, context, scoringConfig);
    scoredIssues.push(scored);
  }

  // Sort by score descending
  scoredIssues.sort((a, b) => b.score - a.score);

  return {
    issues: scoredIssues,
    diagnostics: {
      mode: context.mode,
      numIssues: scoredIssues.length,
      severityDistribution: {
        low: scoredIssues.filter(i => i.severityDisplay === 'low').length,
        medium: scoredIssues.filter(i => i.severityDisplay === 'medium').length,
        high: scoredIssues.filter(i => i.severityDisplay === 'high').length,
      },
      verificationDistribution: {
        EXTERNAL_VERIFIED: scoredIssues.filter(i => i.verification.level === 'EXTERNAL_VERIFIED').length,
        TRANSCRIPT_ONLY: scoredIssues.filter(i => i.verification.level === 'TRANSCRIPT_ONLY').length,
        NONE: scoredIssues.filter(i => i.verification.level === 'NONE').length,
      },
    },
  };
}

function scoreSingleIssue(
  issue: IssueV2,
  context: ScoringContext,
  config: IssueScoringConfig
): ScoredIssue {
  // Step 1: Determine impact (not affected by mode)
  const impact = determineImpact(issue, config);
  
  // Step 2: Get verification level (already set in issue)
  const verificationLevel = issue.verification.level;
  
  // Step 3: Map impact and verification to 0..1 scale for weighted average
  const impact01 = impact === 'high' ? 1.0 : impact === 'medium' ? 0.6 : 0.3;
  const verification01 = verificationLevel === 'EXTERNAL_VERIFIED' ? 1.0 : 
                         verificationLevel === 'TRANSCRIPT_ONLY' ? 0.45 : 0.20;
  
  // Step 4: Compute boosts (as point additions, not multipliers)
  const disputeScore = computeDisputeBoost(issue, config);
  const contradictionScore = computeContradictionBoost(issue, config);
  const commitmentScore = computeCommitmentBoost(issue, config);
  const escalationScore = computeEscalationBoost(issue, config);
  const templateScore = computeTemplateBoost(issue, context, config);
  
  // Step 5: Compute penalties
  const penalties: Record<string, number> = {};
  let transcriptOnlyCapPenalty = 0;
  
  // Step 6: Determine severityDisplay with transcript-only cap
  let severityDisplay: SeverityDisplayV2 = impact === 'high' ? 'high' : impact === 'medium' ? 'medium' : 'low';
  const capsApplied: string[] = [];
  
  if (verificationLevel === 'TRANSCRIPT_ONLY' && context.mode === 'transcript_only') {
    // Apply transcript-only cap
    const maxSeverity = config.caps.transcriptOnlyMaxSeverityDisplay;
    
    // Check exceptions
    let exceptionAllowed = false;
    if (config.caps.transcriptOnlyHighExceptions.allowIfEscalation && escalationScore > 0) {
      exceptionAllowed = true;
      capsApplied.push('TRANSCRIPT_ONLY_EXCEPTION:escalation');
    }
    if (config.caps.transcriptOnlyHighExceptions.allowIfStrictContradiction && 
        issue.type === 'CONTRADICTION' && contradictionScore > 0) {
      // Check if it's a strict contradiction (same slot, entity, opposite polarity)
      const isStrict = checkStrictContradiction(issue, config);
      if (isStrict) {
        exceptionAllowed = true;
        capsApplied.push('TRANSCRIPT_ONLY_EXCEPTION:strict_contradiction');
      }
    }
    if (config.caps.transcriptOnlyHighExceptions.allowIfDisputedCommitment && 
        commitmentScore > 0 && disputeScore > 0) {
      exceptionAllowed = true;
      capsApplied.push('TRANSCRIPT_ONLY_EXCEPTION:disputed_commitment');
    }
    
    if (!exceptionAllowed && severityDisplay === 'high' && maxSeverity === 'medium') {
      severityDisplay = 'medium';
      transcriptOnlyCapPenalty = 0.2; // Penalty for capping
      capsApplied.push('TRANSCRIPT_ONLY_SEVERITY_CAP');
    }
  }
  
  penalties.transcriptOnlyCapPenalty = transcriptOnlyCapPenalty;
  
  // Step 7: Compute final score using weighted average (prevents saturation)
  const wImpact = config.weights?.baseWeights?.impact ?? 0.55;
  const wVerification = config.weights?.baseWeights?.verification ?? 0.30;
  const wConfidence = config.weights?.baseWeights?.confidence ?? 0.15;
  
  // Confidence already 0..1
  const confidence01 = Math.max(0, Math.min(1, issue.confidence ?? 0.5));
  
  // Weighted average base (0..1)
  const base01 = (wImpact * impact01) + (wVerification * verification01) + (wConfidence * confidence01);
  
  // Scale to 0..100
  let scaledScore = base01 * 100;
  
  // Add boosts as point additions (not multipliers)
  const totalBoosts = disputeScore + contradictionScore + commitmentScore + escalationScore + templateScore;
  scaledScore += totalBoosts;
  
  // Subtract penalties
  const penaltyTotal = Object.values(penalties).reduce((sum, p) => sum + (p || 0), 0);
  scaledScore -= penaltyTotal;
  
  // Final score clamped to 0..100
  const score = Math.max(0, Math.min(100, Math.round(scaledScore)));
  
  // Store raw values for breakdown (for debugging/audit)
  const impactScore = impact01;
  const verificationScore = verification01;
  
  // Step 8: Build severity reasons
  const severityReason: string[] = [];
  if (impact === 'high') {
    severityReason.push(`High impact: ${issue.type} in ${issue.category} category`);
  }
  if (verificationLevel === 'TRANSCRIPT_ONLY') {
    severityReason.push('Unverified (transcript-only mode)');
  }
  if (escalationScore > 0) {
    severityReason.push('Escalation signal detected');
  }
  if (contradictionScore > 0) {
    severityReason.push('Contradiction detected');
  }
  if (commitmentScore > 0) {
    severityReason.push('Agent commitment involved');
  }
  
  // Step 9: Determine recommended action
  const recommendedAction = determineRecommendedAction(issue, context, severityDisplay, verificationLevel);
  
  return {
    ...issue,
    impact,
    severityDisplay,
    score,
    scoreBreakdown: {
      impactScore,
      verificationScore,
      disputeScore,
      contradictionScore,
      commitmentScore,
      escalationScore,
      templateScore,
      penalties,
    },
    severityReason,
    capsApplied,
    recommendedAction,
    // Note: severity will be recomputed in risk-ranking.ts based on actual score
    // severityDisplay is what UI shows (capped in transcript-only)
    riskScore: score / 100,
  };
}

// Note: getMaxRawScore removed - we now use weighted average which naturally stays in 0..1 range

function determineImpact(issue: IssueV2, config: IssueScoringConfig): ImpactV2 {
  // Check type-based mapping first
  if (config.impactMapping[issue.type]) {
    return config.impactMapping[issue.type] as ImpactV2;
  }
  
  // Check category-based mapping
  if (config.categoryImpactMapping[issue.category]) {
    return config.categoryImpactMapping[issue.category] as ImpactV2;
  }
  
  // Default based on type
  if (issue.type === 'CONTRADICTION' || issue.type === 'COMMITMENT_INCONSISTENCY' || 
      issue.type === 'FEE_DISCLOSURE_RISK' || issue.type === 'DATA_INTEGRITY') {
    return 'high';
  }
  if (issue.type === 'POLICY' || issue.type === 'RISK_SIGNAL' || issue.type === 'NUMERIC_MISMATCH') {
    return 'medium';
  }
  
  return 'low';
}

function computeDisputeBoost(issue: IssueV2, config: IssueScoringConfig): number {
  // Check if customer disputes agent claim (same slot/entity)
  // This is a simplified check - in practice, you'd need to analyze the claims
  const hasDispute = issue.compliance.tags?.some(tag => 
    tag.includes('dispute') || tag.includes('denial') || tag.includes('challenge')
  );
  
  // Return as point boost (not multiplier)
  return hasDispute ? (config.weights.disputeBoostPoints ?? 6) : 0;
}

function computeContradictionBoost(issue: IssueV2, config: IssueScoringConfig): number {
  if (issue.type === 'CONTRADICTION' && issue.evidence.edges?.some(e => e.kind === 'contradiction')) {
    // Return as point boost
    return config.weights.contradictionBoostPoints ?? 3;
  }
  return 0;
}

function computeCommitmentBoost(issue: IssueV2, config: IssueScoringConfig): number {
  const hasCommitment = issue.compliance.tags?.some(tag => 
    tag.includes('commitment') || tag.includes('promise') || tag.includes('guarantee')
  );
  
  if (hasCommitment && (issue.type === 'COMMITMENT_INCONSISTENCY' || issue.type === 'CONTRADICTION')) {
    // Return as point boost
    return config.weights.commitmentBoostPoints ?? 4;
  }
  return 0;
}

function computeEscalationBoost(issue: IssueV2, config: IssueScoringConfig): number {
  const text = (issue.what.claimText || issue.what.issueSummary || '').toLowerCase();
  const hasEscalation = config.taxonomy.escalationKeywords.some(keyword => 
    text.includes(keyword.toLowerCase())
  );
  
  // Return as point boost
  return hasEscalation ? (config.weights.escalationBoostPoints ?? 8) : 0;
}

function computeTemplateBoost(issue: IssueV2, context: ScoringContext, config: IssueScoringConfig): number {
  if (context.isRegulatedTemplate && 
      (issue.category === 'compliance' || issue.category === 'disclosure')) {
    // Return as point boost
    return config.weights.regulatedTemplateBoostPoints ?? 4;
  }
  return 0;
}

function checkStrictContradiction(issue: IssueV2, config: IssueScoringConfig): boolean {
  // This is a simplified check - in practice, you'd need to check slotType, entityKey, polarity, topicId
  // For now, we'll check if it's a CONTRADICTION with high confidence
  if (issue.type === 'CONTRADICTION' && issue.confidence >= config.contradiction.minModelScore) {
    return true;
  }
  return false;
}

function determineRecommendedAction(
  issue: IssueV2,
  context: ScoringContext,
  severityDisplay: SeverityDisplayV2,
  verificationLevel: VerificationLevelV2
): {
  actionType: RecommendedActionType;
  explanation: string;
  requiredEvidence?: string[];
} {
  // Check for escalation
  const hasEscalation = issue.compliance.tags?.some(tag => tag.includes('escalation'));
  if (hasEscalation && severityDisplay === 'high') {
    return {
      actionType: 'LEGAL_ESCALATION',
      explanation: 'Escalation signal detected. Requires legal/compliance review.',
      requiredEvidence: ['transcript', 'customer_history'],
    };
  }
  
  // Check for billing issues
  if (issue.category === 'billing' && severityDisplay === 'high') {
    return {
      actionType: 'BILLING_FOLLOWUP',
      explanation: 'Billing-related issue requires verification against account records.',
      requiredEvidence: ['billing_ledger', 'account_statement'],
    };
  }
  
  // If transcript-only and high impact, need external evidence
  if (verificationLevel === 'TRANSCRIPT_ONLY' && severityDisplay === 'medium') {
    return {
      actionType: 'NEEDS_EXTERNAL_EVIDENCE',
      explanation: 'Issue identified in transcript but requires external verification.',
      requiredEvidence: ['policy_doc', 'system_facts'],
    };
  }
  
  // Default to QA review
  if (severityDisplay === 'high' || severityDisplay === 'medium') {
    return {
      actionType: 'QA_REVIEW',
      explanation: 'Issue requires QA review and potential agent coaching.',
    };
  }
  
  return {
    actionType: 'COACH_AGENT',
    explanation: 'Low-severity issue may benefit from agent coaching.',
  };
}

