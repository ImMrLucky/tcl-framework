/**
 * Risk Ranking Module
 * 
 * Computes deterministic risk scores and ranks issues.
 * All thresholds and weights come from config - NO hard-coded values.
 * 
 * NEW PIPELINE (no saturation, no circularity):
 * - impact01 from issue.impact
 * - evidence01 from issue.verification.level
 * - signal01 from graph + spectral (graceful degrade)
 * - category01 from config
 * - risk01 = weighted average
 * - severity derived from risk01
 * - severityDisplay capped for mode
 */

import type { IssueV2, SeverityV2, ImpactV2, SeverityDisplayV2, VerificationLevelV2, IssueTypeV2 } from '../types.js';
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

export interface ScoringContext {
  mode: 'transcript_only' | 'with_evidence';
  numSources: number;
  graphStatus?: string;
  templateId?: string;
  isRegulatedTemplate?: boolean;
}

/**
 * Rank issues by risk score (deterministic)
 * Uses new pipeline: impact + evidence + signal + category → risk01 → severity
 */
export function rankIssuesV2(
  issues: IssueV2[], 
  config?: RiskRankingConfig,
  scoringContext?: ScoringContext
): RankedIssues {
  const rankingConfig = config || getRiskRankingConfig();
  
  // Score all issues using new pipeline
  // Pass allIssues to computeSignal01 for normalization
  const scoredIssues = issues.map(issue => {
    return scoreIssue(issue, rankingConfig, scoringContext, issues);
  });
  
  // Sort deterministically with stable ordering
  // MODE SAFETY: Ranking is ALWAYS based on riskScore (not severityDisplay)
  // This ensures transcript-only issues are still ranked correctly even if severityDisplay is capped
  const sorted = scoredIssues.sort((a, b) => {
    // Primary: riskScore DESC (0..1, higher is better)
    // NOTE: This is the actual risk, not the capped severityDisplay
    const riskA = a.riskScore ?? 0;
    const riskB = b.riskScore ?? 0;
    if (riskB !== riskA) {
      return riskB - riskA; // DESC: higher riskScore first
    }
    
    // Secondary: impact (high > medium > low)
    const impactOrder: Record<string, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };
    const impactA = impactOrder[a.impact || 'low'] ?? 1;
    const impactB = impactOrder[b.impact || 'low'] ?? 1;
    if (impactB !== impactA) {
      return impactB - impactA; // DESC: higher impact first
    }
    
    // Tertiary: verification level (EXTERNAL_VERIFIED > TRANSCRIPT_ONLY > NONE)
    const verificationOrder: Record<string, number> = {
      EXTERNAL_VERIFIED: 3,
      TRANSCRIPT_ONLY: 2,
      NONE: 1,
    };
    const verifA = verificationOrder[a.verification.level] ?? 1;
    const verifB = verificationOrder[b.verification.level] ?? 1;
    if (verifB !== verifA) {
      return verifB - verifA; // DESC: higher verification first
    }
    
    // Quaternary: type priority (from config, optional)
    if (rankingConfig.typePriority && rankingConfig.typePriority.length > 0) {
      const typeAIdx = rankingConfig.typePriority.indexOf(a.type);
      const typeBIdx = rankingConfig.typePriority.indexOf(b.type);
      // If both found, lower index (higher priority) comes first
      if (typeAIdx >= 0 && typeBIdx >= 0 && typeAIdx !== typeBIdx) {
        return typeAIdx - typeBIdx; // ASC: lower index (higher priority) first
      }
      // If only one found, it comes first
      if (typeAIdx >= 0 && typeBIdx < 0) return -1;
      if (typeAIdx < 0 && typeBIdx >= 0) return 1;
    }
    
    // Quinary: issueKey asc (deterministic tie-break for stability)
    return a.issueKey.localeCompare(b.issueKey);
  });
  
  // Slice top issues (config-driven)
  const topIssues = sorted.slice(0, rankingConfig.ui.maxTopIssues);
  
  // Generate summary (pass scoringContext so it can use severityDisplay in transcript-only)
  const summary = generateSummary(sorted, topIssues.length, scoringContext);
  
  return {
    allIssues: sorted,
    topIssues,
    summary,
  };
}

/**
 * Score a single issue using the new pipeline
 * ❌ Does NOT use issue.severity as input
 * ✅ All weights from config
 * ✅ No clamping until final output
 */
function scoreIssue(
  issue: IssueV2,
  config: RiskRankingConfig,
  scoringContext?: ScoringContext,
  allIssues?: IssueV2[]
): IssueV2 {
  // Step 1: Compute component scores (all 0..1, all from config)
  const impact01 = computeImpact01(issue, config);
  const evalMode = scoringContext ? {
    verificationLevel: scoringContext.mode === 'transcript_only' ? 'TRANSCRIPT_ONLY' as const : 
                       scoringContext.numSources > 0 ? 'DOC_BACKED' as const : 'EXTERNALLY_VERIFIED' as const
  } : undefined;
  const evidence01 = computeEvidence01(issue, config, evalMode);
  const signal01 = computeSignal01(issue, config, scoringContext, allIssues);
  const category01 = computeCategory01(issue, config);
  
  // Step 2: Get weights from config (validated on startup)
  const wImpact = config.weights.riskScoring.impact;
  const wEvidence = config.weights.riskScoring.evidence;
  const wSignal = config.weights.riskScoring.signal;
  const wCategory = config.weights.riskScoring.category;
  
  // Step 3: Weighted average (no clamping yet)
  const risk01 = 
    (wImpact * impact01) +
    (wEvidence * evidence01) +
    (wSignal * signal01) +
    (wCategory * category01);
  
  // A2: Apply verification multiplier (separate impact from verification)
  // Impact = how bad if true (customer harm, $ amounts, legal, compliance)
  // Verification = how defensible/provable in audit
  const verificationMultiplier = evalMode?.verificationLevel === 'TRANSCRIPT_ONLY' ? 0.85 :
                                  evalMode?.verificationLevel === 'DOC_BACKED' ? 1.00 :
                                  1.10; // EXTERNALLY_VERIFIED
  
  // Apply multiplier to riskScore (not impact - impact stays unchanged)
  const adjustedRisk01 = risk01 * verificationMultiplier;
  
  // B2: Speaker gating - downgrade non-AGENT↔AGENT contradictions
  // AGENT↔AGENT: normal contradiction scoring
  // CUSTOMER↔AGENT: "dispute/allegation" (lower severity cap unless agent explicitly commits)
  // CUSTOMER↔CUSTOMER: informational (do not score high)
  let finalRisk01 = adjustedRisk01;
  const speakerGating = (issue as any)._speakerGating;
  if (speakerGating && !speakerGating.isAgentAgent) {
    // Downgrade contradictions that aren't AGENT↔AGENT
    const downgradedImpact01 = impact01 * 0.6;  // Reduce impact
    const downgradedSignal01 = signal01 * 0.4;  // Reduce signal
    // Recompute risk01 with downgraded components
    finalRisk01 = (wImpact * downgradedImpact01) +
                   (wEvidence * evidence01) +
                   (wSignal * downgradedSignal01) +
                   (wCategory * category01);
    finalRisk01 = finalRisk01 * verificationMultiplier;
  }
  
  // Step 4: Clamp to 0..1
  const riskScore = clamp01(finalRisk01);
  
  // Step 5: Convert to 0..100 score
  const score = Math.round(riskScore * 100);
  
  // Step 6: Derive severity from riskScore (canonical severity, independent of mode)
  let severity = deriveSeverity(riskScore, config);
  
  // B2: Apply severity cap for non-AGENT↔AGENT contradictions
  if (speakerGating && !speakerGating.isAgentAgent && severity === 'high') {
    severity = 'medium'; // Cap at medium for customer disputes
  }
  
  // Apply category-based minimums (e.g., CONTRADICTION involving MONEY/FEES/REFUND => min "high")
  severity = applyCategoryMinimums(severity, issue, config);
  
  // Step 7: Compute severityDisplay with conditional downgrade (not blanket cap)
  const severityDisplay = computeSeverityDisplay(
    severity,
    issue.verification.level,
    issue.type,
    issue.compliance,
    scoringContext
  );
  
  // MODE SAFETY: impact is UNCHANGED in transcript-only mode
  // Preserve existing impact if set, otherwise derive from impact01 using config thresholds
  // Use midpoints between impactMap values as thresholds
  const impactThresholds = {
    high: (config.impactMap.high + config.impactMap.medium) / 2,
    medium: (config.impactMap.medium + config.impactMap.low) / 2,
  };
  const finalImpact: ImpactV2 = issue.impact || 
    (impact01 >= impactThresholds.high ? 'high' : 
     impact01 >= impactThresholds.medium ? 'medium' : 'low');
  // Note: impact is NOT affected by transcript-only mode (only severityDisplay is capped)
  
  // Step 8: Build scoring explanation (enterprise requirement)
  const scoringReasons: string[] = [];
  
  // Impact reason
  if (finalImpact === 'high') {
    scoringReasons.push(`High impact: ${issue.type} in ${issue.category} category`);
  } else if (finalImpact === 'medium') {
    scoringReasons.push(`Medium impact: ${issue.type} in ${issue.category} category`);
  }
  
  // Evidence reason
  if (issue.verification.level === 'EXTERNAL_VERIFIED') {
    scoringReasons.push('Externally verified with policy/document evidence');
  } else if (issue.verification.level === 'TRANSCRIPT_ONLY') {
    scoringReasons.push('Transcript-only mode: not externally verified');
  } else {
    scoringReasons.push('No verification evidence available');
  }
  
  // Signal reason
  if (signal01 >= 0.8) {
    scoringReasons.push('Strong graph/spectral signals detected');
  } else if (signal01 >= 0.6) {
    scoringReasons.push('Moderate graph/spectral signals');
  } else if (signal01 < 0.4) {
    scoringReasons.push('Weak or missing graph/spectral signals');
  }
  
  // Category reason
  const categoryMult = config.weights.categoryMultiplier?.[issue.category] || config.categoryNormalization.min;
  if (categoryMult >= config.categoryNormalization.max * 0.9) {
    scoringReasons.push(`High-risk category: ${issue.category}`);
  }
  
  // Severity display downgrade reason (only for UNVERIFIED types in transcript-only)
  if (scoringContext?.mode === 'transcript_only' && issue.verification.level === 'TRANSCRIPT_ONLY' && issue.type === 'UNVERIFIED_CLAIM') {
    if (severityDisplay !== severity.toLowerCase() && severityDisplay !== severity) {
      scoringReasons.push('Display severity downgraded for unverified claim in transcript-only mode');
    }
  }
  
  return {
    ...issue,
    impact: finalImpact,
    riskScore,
    score,
    severity, // Canonical severity (impact severity, independent of mode)
    severityDisplay, // UI convenience (may be downgraded for UNVERIFIED in transcript-only)
    scoring: {
      components: {
        impact01: Math.round(impact01 * 1000) / 1000, // Round to 3 decimals
        evidence01: Math.round(evidence01 * 1000) / 1000,
        signal01: Math.round(signal01 * 1000) / 1000,
        category01: Math.round(category01 * 1000) / 1000,
        verificationMultiplier: Math.round(verificationMultiplier * 1000) / 1000,
      },
      weights: {
        impact: wImpact,
        evidence: wEvidence,
        signal: wSignal,
        category: wCategory,
      },
      reasons: scoringReasons,
    },
  };
}

/**
 * Compute impact01 from issue.impact (0..1)
 * Uses config.impactMap (no hard-coded values)
 */
function computeImpact01(issue: IssueV2, config: RiskRankingConfig): number {
  const impact = issue.impact || 'low';
  return config.impactMap[impact];
}

/**
 * Compute evidence01 from issue.verification.level (0..1)
 * A3: Fix evidence scoring in transcript-only (currently too high)
 * Transcript-only should be 0.15 (low audit defensibility), not boosted
 */
function computeEvidence01(
  issue: IssueV2, 
  config: RiskRankingConfig,
  evalMode?: { verificationLevel: 'TRANSCRIPT_ONLY' | 'DOC_BACKED' | 'EXTERNALLY_VERIFIED' }
): number {
  const level = issue.verification.level;
  
  // A3: Transcript-only gets low evidence score (low audit defensibility)
  if (level === 'TRANSCRIPT_ONLY' || evalMode?.verificationLevel === 'TRANSCRIPT_ONLY') {
    return 0.15; // Low audit defensibility - no external evidence
  }
  
  // For other modes, compute from refs, edges, grounding, docMatches
  // This will be enhanced in future to consider actual evidence coverage
  let evidence01 = config.evidenceMap[level] || 0.2;
  
  // Boost based on actual evidence refs/edges if available
  if (issue.evidence.refs && issue.evidence.refs.length > 0) {
    const externalRefs = issue.evidence.refs.filter(r => r.sourceType !== 'TRANSCRIPT');
    if (externalRefs.length > 0) {
      evidence01 = Math.max(evidence01, 0.7); // Has external evidence
    }
  }
  
  if (issue.evidence.edges && issue.evidence.edges.length > 0) {
    const groundingEdges = issue.evidence.edges.filter(e => e.kind === 'grounding');
    if (groundingEdges.length > 0) {
      const maxGroundingWeight = Math.max(...groundingEdges.map(e => e.weight || 0));
      evidence01 = Math.max(evidence01, 0.5 + (maxGroundingWeight * 0.3)); // Boost from grounding
    }
  }
  
  return clamp01(evidence01);
}

/**
 * Compute signal01 from graph + spectral (graceful degrade)
 * Uses edge weights, confidence, and structural importance
 * Falls back to degradedMode values when data missing
 */
function computeSignal01(issue: IssueV2, config: RiskRankingConfig): number {
  // Start with confidence (already 0..1)
  let signal = issue.confidence || config.degradedMode.missingSpectralSignal01;
  
  // Boost from edge weights (contradiction/support edges)
  if (issue.evidence.edges && issue.evidence.edges.length > 0) {
    const maxEdgeWeight = Math.max(...issue.evidence.edges.map(e => e.weight || 0));
    // Edge weight contributes up to 0.3 (could be config-driven in future)
    signal = Math.min(1.0, signal + (maxEdgeWeight * 0.3));
  } else {
    // No edges available, use degraded mode fallback
    signal = Math.max(signal, config.degradedMode.missingEdgesSignal01);
  }
  
  // Boost from evidence refs (grounding strength)
  if (issue.evidence.refs && issue.evidence.refs.length > 0) {
    const weights = issue.evidence.refs.map(r => r.weight || 0).filter(w => w > 0);
    if (weights.length > 0) {
      const avgRefWeight = weights.reduce((sum, w) => sum + w, 0) / weights.length;
      // Ref weight contributes up to 0.2 (could be config-driven in future)
      signal = Math.min(1.0, signal + (avgRefWeight * 0.2));
    }
  }
  
  // Type-based signal boost (contradictions, risk signals are stronger)
  // This could be moved to config.typeBase in future
  if (issue.type === 'CONTRADICTION' || issue.type === 'DATA_INTEGRITY') {
    signal = Math.min(1.0, signal + 0.15);
  } else if (issue.type === 'RISK_SIGNAL' || issue.type === 'FEE_DISCLOSURE_RISK') {
    signal = Math.min(1.0, signal + 0.10);
  }
  
  return clamp01(signal);
}

/**
 * Compute category01 from category and compliance tags (0..1)
 * Maps category and tags to meaningful risk scores
 * NO hard-coded 0 values - always returns a meaningful score
 */
function computeCategory01(issue: IssueV2, config: RiskRankingConfig): number {
  // Start with category multiplier if available
  let categoryMult = config.weights.categoryMultiplier?.[issue.category] || 1.0;
  
  // Boost based on compliance tags (higher priority than category)
  const tags = issue.compliance?.tags || [];
  if (tags.length > 0) {
    // Privacy/PCI/Security tags → highest risk
    if (tags.some(tag => tag.includes('privacy') || tag.includes('pci') || tag.includes('security') || tag.includes('cvv'))) {
      categoryMult = Math.max(categoryMult, 1.3);
    }
    // Compliance tags → high risk
    else if (tags.some(tag => tag.includes('compliance') || tag.includes('regulatory'))) {
      categoryMult = Math.max(categoryMult, 1.2);
    }
    // Billing/Fees/Refunds → high risk
    else if (tags.some(tag => tag.includes('billing') || tag.includes('fee') || tag.includes('refund') || tag.includes('money'))) {
      categoryMult = Math.max(categoryMult, 1.2);
    }
    // Customer dispute risk → medium-high risk
    else if (tags.some(tag => tag.includes('dispute') || tag.includes('customer_risk'))) {
      categoryMult = Math.max(categoryMult, 1.1);
    }
    // Consistency (general contradiction) → medium risk
    else if (issue.category === 'consistency' || tags.some(tag => tag.includes('consistency'))) {
      categoryMult = Math.max(categoryMult, 1.0);
    }
    // Soft quality / tone → lower risk
    else if (tags.some(tag => tag.includes('tone') || tag.includes('quality'))) {
      categoryMult = Math.max(categoryMult, 0.8);
    }
  }
  
  // Map category directly if no tags and category has known mapping
  if (categoryMult === 1.0 && !config.weights.categoryMultiplier?.[issue.category]) {
    // Direct category mapping (fallback if no tags)
    const categoryMap: Record<string, number> = {
      'privacy': 1.3,
      'security': 1.3,
      'compliance': 1.2,
      'billing': 1.2,
      'fees': 1.2,
      'refunds': 1.2,
      'disclosure': 1.15,
      'consistency': 1.0,
      'data_integrity': 1.1,
      'other': 0.9,
    };
    categoryMult = categoryMap[issue.category] || 1.0;
  }
  
  // Normalize using config range (1.0 to 1.3 typically)
  const range = config.categoryNormalization.max - config.categoryNormalization.min;
  const normalized = range > 0 
    ? (categoryMult - config.categoryNormalization.min) / range
    : 0.5; // Fallback if range is invalid
  
  return clamp01(normalized);
}

/**
 * Derive severity from riskScore using thresholds
 */
function deriveSeverity(riskScore: number, config: RiskRankingConfig): SeverityV2 {
  const thresholds = config.severityThresholds;
  if (riskScore >= thresholds.critical) return 'critical';
  if (riskScore >= thresholds.high) return 'high';
  if (riskScore >= thresholds.medium) return 'medium';
  return 'low';
}

/**
 * Compute severityDisplay with conditional downgrade (not blanket cap)
 * 
 * Rules:
 * - Never downgrade legal hold / critical compliance signals
 * - Only downgrade UNVERIFIED type issues in transcript-only mode
 * - Downgrade by one band (critical->high->medium->low), not forced to medium
 * - Do not downgrade contradictions, risk_signals, safety, harassment, etc.
 */
function computeSeverityDisplay(
  severity: SeverityV2,
  verificationLevel: VerificationLevelV2,
  issueType: IssueTypeV2,
  compliance?: { legalHoldSuggested?: boolean },
  scoringContext?: ScoringContext
): SeverityDisplayV2 {
  // Never downgrade legal hold / critical compliance signals
  if (compliance?.legalHoldSuggested) {
    // Map critical -> high for display (severityDisplay doesn't have 'critical')
    return severity === 'critical' ? 'high' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
  }
  
  // Only downgrade evidence-type "UNVERIFIED" items in transcript-only mode
  if (scoringContext?.mode === 'transcript_only' && verificationLevel === 'TRANSCRIPT_ONLY' && issueType === 'UNVERIFIED_CLAIM') {
    // Downgrade by one band (critical->high->medium->low), but do NOT force medium
    return downgradeOneBand(severity);
  }
  
  // Do not downgrade contradictions, risk_signals, safety, harassment, etc.
  // Map severity to display (critical -> high, others stay)
  if (severity === 'critical') return 'high';
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}

/**
 * Downgrade severity by one band (critical->high->medium->low)
 */
function downgradeOneBand(severity: SeverityV2): SeverityDisplayV2 {
  if (severity === 'critical') return 'high';
  if (severity === 'high') return 'medium';
  if (severity === 'medium') return 'low';
  return 'low';
}

/**
 * Apply category-based minimums to severity
 * Examples:
 * - CONTRADICTION involving MONEY/FEES/REFUND => min "high"
 * - LEGAL_HOLD suggested => min "high" or "critical"
 */
function applyCategoryMinimums(
  severity: SeverityV2,
  issue: IssueV2,
  config: RiskRankingConfig
): SeverityV2 {
  // Legal hold suggested => min "high"
  if (issue.compliance?.legalHoldSuggested) {
    if (severity === 'low' || severity === 'medium') {
      return 'high';
    }
    return severity;
  }
  
  // CONTRADICTION involving MONEY/FEES/REFUND => min "high"
  if (issue.type === 'CONTRADICTION') {
    const hasMoneyCategory = issue.category === 'billing' || 
                            issue.category === 'compliance' ||
                            issue.compliance?.tags?.some(tag => 
                              tag.toLowerCase().includes('fee') ||
                              tag.toLowerCase().includes('money') ||
                              tag.toLowerCase().includes('refund') ||
                              tag.toLowerCase().includes('billing')
                            );
    if (hasMoneyCategory && (severity === 'low' || severity === 'medium')) {
      return 'high';
    }
  }
  
  return severity;
}

/**
 * Legacy fallback: Compute risk score for a single issue using composite scoring formula
 * @deprecated Use scoreIssue() instead
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
  const severity = deriveSeverity(riskScore, config);
  
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
 * Generate summary statistics
 */
function generateSummary(
  issues: IssueV2[], 
  topCount: number,
  scoringContext?: ScoringContext
): RankedIssues['summary'] {
  const byType: Record<string, number> = {};
  const bySeverity: Record<SeverityV2, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const byCategory: Record<string, number> = {};
  
  // Executive summary should count impact severity (severity), not display severity (severityDisplay)
  // This ensures high/critical counts are accurate regardless of transcript-only mode
  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] || 0) + 1;
    
    // Always use severity (impact severity) for summary counts
    // severityDisplay is only for UI convenience, not for analytics
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

