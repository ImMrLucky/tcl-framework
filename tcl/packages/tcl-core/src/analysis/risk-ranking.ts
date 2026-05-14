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
  
  // STEP 0: Pre-compute normalization factors from all issues
  // This allows us to normalize edge weights and signals within the conversation
  const normalizationFactors = computeNormalizationFactors(issues);
  
  // Score all issues with normalization
  const scoredIssues = issues.map(issue => {
    return scoreIssue(issue, rankingConfig, scoringContext, issues, normalizationFactors);
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
/**
 * Compute normalization factors from all issues to create score spread
 * This prevents all issues from clustering at the same score
 */
function computeNormalizationFactors(issues: IssueV2[]): {
  maxEdgeWeight: number;
  minEdgeWeight: number;
  avgEdgeWeight: number;
  edgeWeightStdDev: number;
  maxConfidence: number;
  minConfidence: number;
  avgConfidence: number;
} {
  const edgeWeights: number[] = [];
  const confidences: number[] = [];
  
  for (const issue of issues) {
    // Collect edge weights
    if (issue.evidence.edges && issue.evidence.edges.length > 0) {
      for (const edge of issue.evidence.edges) {
        if (edge.weight && edge.weight > 0) {
          edgeWeights.push(edge.weight);
        }
      }
    }
    
    // Collect confidences
    if (issue.confidence && issue.confidence > 0) {
      confidences.push(issue.confidence);
    }
  }
  
  const computeStats = (values: number[]) => {
    if (values.length === 0) return { max: 1, min: 0, avg: 0.5, stdDev: 0.2 };
    const max = Math.max(...values);
    const min = Math.min(...values);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return { max, min, avg, stdDev };
  };
  
  const edgeStats = computeStats(edgeWeights);
  const confStats = computeStats(confidences);
  
  return {
    maxEdgeWeight: edgeStats.max,
    minEdgeWeight: edgeStats.min,
    avgEdgeWeight: edgeStats.avg,
    edgeWeightStdDev: edgeStats.stdDev,
    maxConfidence: confStats.max,
    minConfidence: confStats.min,
    avgConfidence: confStats.avg,
  };
}

function scoreIssue(
  issue: IssueV2,
  config: RiskRankingConfig,
  scoringContext?: ScoringContext,
  allIssues?: IssueV2[],
  normalizationFactors?: ReturnType<typeof computeNormalizationFactors>
): IssueV2 {
  // Step 1: Compute component scores (all 0..1, all from config)
  const impact01 = computeImpact01(issue, config);
  const evalMode = scoringContext ? {
    verificationLevel: scoringContext.mode === 'transcript_only' ? 'TRANSCRIPT_ONLY' as const : 
                       scoringContext.numSources > 0 ? 'DOC_BACKED' as const : 'EXTERNALLY_VERIFIED' as const,
    provenance: (scoringContext as any).provenance, // Rule 7: Pass provenance for transcript quality multiplier
  } : undefined;
  const evidence01 = computeEvidence01(issue, config, evalMode);
  const signal01 = computeSignal01(issue, config, allIssues, normalizationFactors);
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
  
  // Initialize scoring reasons early (used in mode caps)
  const scoringReasons: string[] = [];
  
  // A2: Apply verification multiplier (separate impact from verification)
  // Impact = how bad if true (customer harm, $ amounts, legal, compliance)
  // Verification = how defensible/provable in audit
  // C1: Use config.verificationMultiplier instead of hard-coded values
  const verificationLevelKey = evalMode?.verificationLevel === 'TRANSCRIPT_ONLY' ? 'TRANSCRIPT_ONLY' :
                                evalMode?.verificationLevel === 'DOC_BACKED' || evalMode?.verificationLevel === 'EXTERNALLY_VERIFIED' ? 'EXTERNAL_VERIFIED' :
                                'NONE';
  const verificationMultiplier = config.verificationMultiplier?.[verificationLevelKey] ?? 
                                 (verificationLevelKey === 'TRANSCRIPT_ONLY' ? 0.85 :
                                  verificationLevelKey === 'EXTERNAL_VERIFIED' ? 1.0 : 0.7);
  
  // B1: Apply mode caps ONLY for specific issue types (not contradictions)
  let cappedRisk01 = risk01;
  const modeCaps = config.modeCaps?.transcript_only;
  const modeCapsApplied: string[] = [];
  if (scoringContext?.mode === 'transcript_only' && modeCaps && modeCaps.applyToTypes.includes(issue.type)) {
    if (risk01 > modeCaps.maxRisk01) {
      cappedRisk01 = modeCaps.maxRisk01;
      modeCapsApplied.push(`transcript_only_cap_${issue.type}`);
      scoringReasons.push(`Transcript-only cap applied to ${issue.type}: risk01 reduced from ${risk01.toFixed(3)} to ${cappedRisk01.toFixed(3)}`);
    }
  }
  
  // Apply multiplier to riskScore (not impact - impact stays unchanged)
  const adjustedRisk01 = cappedRisk01 * verificationMultiplier;
  
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
  let riskScore = clamp01(finalRisk01);

  // Step 6: Derive severity from riskScore (canonical severity, independent of mode)
  let severity = deriveSeverity(riskScore, config);

  // B2: Apply severity cap for non-AGENT↔AGENT contradictions
  if (speakerGating && !speakerGating.isAgentAgent && severity === 'high') {
    severity = 'medium'; // Cap at medium for customer disputes
  }

  // Apply category-based minimums (e.g., CONTRADICTION involving MONEY/FEES/REFUND => min "high")
  let canonicalSeverity = applyCategoryMinimums(severity, issue, config);

  // Domain packs attach explicit regulatory severities; do not let score-only derivation erase them.
  const reasonsJoin = (issue.scoring?.reasons ?? []).join(" ");
  if (/DOMAIN_PACK:/i.test(reasonsJoin)) {
    const order: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const fromScore = order[canonicalSeverity] ?? 0;
    const fromRule = order[issue.severity] ?? 0;
    if (fromRule > fromScore) {
      canonicalSeverity = issue.severity;
    }
  }

  // Coherence guard: keep the displayed numeric score in the same band as the
  // canonical severity badge. Without this, category/domain-pack minimums can
  // upgrade an issue to "high" while its raw riskScore stays in the medium band
  // (e.g. a CONTRADICTION with category=compliance ending up at riskScore=0.51 +
  // severity=high). The UI shows "Score: 51" next to a HIGH chip, which reads as
  // contradictory. Lift riskScore to the floor for the canonical severity band.
  const severityFloors: Record<SeverityV2, number> = {
    low: 0,
    medium: config.severityThresholds.medium,
    high: config.severityThresholds.high,
    critical: config.severityThresholds.critical,
  };
  const floor = severityFloors[canonicalSeverity] ?? 0;
  if (riskScore < floor) {
    riskScore = floor;
  }

  // Step 5: Convert to 0..100 score (computed after any severity-driven lift so
  // the numeric badge and the severity chip agree).
  const score = Math.round(riskScore * 100);

  // Step 7: Display severity (may differ from canonical for transcript-only UNVERIFIED, etc.)
  const severityDisplay = computeSeverityDisplay(
    canonicalSeverity,
    issue.verification.level,
    issue.type,
    issue.compliance,
    scoringContext,
    issue
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
  // Note: impact is NOT affected by transcript-only mode (only severity may be downgraded)
  
  // Step 8: Build scoring explanation (enterprise requirement)
  // scoringReasons already initialized above
  
  // B2: Add reason if high impact but UI severity display is capped
  if (finalImpact === 'high' && severityDisplay !== 'high') {
    scoringReasons.push(`High impact but ${severityDisplay} display severity due to ${issue.verification.level === 'TRANSCRIPT_ONLY' ? 'transcript-only evidence level' : 'evidence limitations'}`);
  }
  
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
  
  // Severity downgrade reason (only for UNVERIFIED types in transcript-only)
  if (scoringContext?.mode === 'transcript_only' && issue.verification.level === 'TRANSCRIPT_ONLY' && issue.type === 'UNVERIFIED_CLAIM') {
    if (severityDisplay !== canonicalSeverity) {
      scoringReasons.push('Display severity downgraded for unverified claim in transcript-only mode');
    }
  }
  
  // B4: Return only canonical scoring structure (no scoreBreakdown)
  return {
    ...issue,
    impact: finalImpact,
    riskScore,
    score,
    severity: canonicalSeverity,
    severityDisplay,
    scoring: {
      components: {
        impact01: Math.round(impact01 * 1000) / 1000, // Round to 3 decimals
        evidence01: Math.round(evidence01 * 1000) / 1000,
        signal01: Math.round(signal01 * 1000) / 1000,
        category01: Math.round(category01 * 1000) / 1000,
        verificationMultiplier: Math.round(verificationMultiplier * 1000) / 1000,
        risk01Raw: Math.round(risk01 * 1000) / 1000,
        risk01Final: Math.round(adjustedRisk01 * 1000) / 1000,
      },
      weights: {
        impact: wImpact,
        evidence: wEvidence,
        signal: wSignal,
        category: wCategory,
      },
      reasons: scoringReasons,
      modeCapsApplied: modeCapsApplied.length > 0 ? modeCapsApplied : undefined,
    },
  };
}

/**
 * Compute impact01 from issue.impact (0..1)
 * Uses config.impactMap (no hard-coded values)
 */
/**
 * 8.1: Compute impact01 using continuous features to reduce plateaus
 * Impact should vary based on issue type, category, and specific signals
 */
function computeImpact01(issue: IssueV2, config: RiskRankingConfig): number {
  const impact = issue.impact || 'low';
  return config.impactMap[impact];
}

/**
 * Compute evidence01 (verification confidence) from issue.verification.level (0..1)
 * Rule 7: Incorporates transcript provenance correctly
 * 
 * verification01 = baseTranscriptConfidence × corroboration01 × transcriptQualityMultiplier
 * 
 * Where:
 * - baseTranscriptConfidence is higher when transcript came from audio transcription
 * - corroboration01 comes from support/confirmation/summaries and contradiction provability
 * - transcriptQualityMultiplier comes from ASR/diarization confidence (bounded 0.6-1.15)
 */
/**
 * E1: Compute evidence01 using evidenceMap (config-driven)
 * E1: Update evidenceMap - EXTERNAL_VERIFIED: 1.0, TRANSCRIPT_ONLY: 0.6, NONE: 0.2
 * Key: TRANSCRIPT_ONLY must be meaningfully higher than NONE.
 */
function computeEvidence01(
  issue: IssueV2, 
  config: RiskRankingConfig,
  evalMode?: { 
    verificationLevel: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PROVABLE' | 'DOC_BACKED' | 'EXTERNALLY_VERIFIED';
    provenance?: { ingestionMode: string; transcriptSource: string; transcriptQuality?: { asrConfidence01?: number; diarizationConfidence01?: number } };
  }
): number {
  const level = issue.verification.level; // VerificationLevelV2: "EXTERNAL_VERIFIED" | "TRANSCRIPT_ONLY" | "TRANSCRIPT_PROVABLE" | "NONE"
  
  // E1: Use evidenceMap from config (no hard-coded values)
  // Map TRANSCRIPT_PROVABLE to TRANSCRIPT_ONLY for evidence scoring
  const evidenceMapKey = level === 'TRANSCRIPT_PROVABLE' ? 'TRANSCRIPT_ONLY' : level;
  let baseEvidence01: number;
  if (evidenceMapKey === 'EXTERNAL_VERIFIED') {
    baseEvidence01 = config.evidenceMap.EXTERNAL_VERIFIED;
  } else if (evidenceMapKey === 'TRANSCRIPT_ONLY') {
    baseEvidence01 = config.evidenceMap.TRANSCRIPT_ONLY;
  } else {
    baseEvidence01 = config.evidenceMap.NONE;
  }
  
  // Apply transcript quality multiplier if available (bounded 0.9-1.1 for transcript-only)
  let qualityMultiplier = 1.0;
  if (level === 'TRANSCRIPT_ONLY' && evalMode?.provenance?.transcriptQuality) {
    const quality = evalMode.provenance.transcriptQuality;
    const asrConf = quality.asrConfidence01 ?? 0.8;
    const diarConf = quality.diarizationConfidence01 ?? 0.8;
    const avgQuality = (asrConf + diarConf) / 2;
    // Small multiplier: 0.9 (low quality) to 1.1 (high quality)
    qualityMultiplier = 0.9 + (avgQuality * 0.2);
    qualityMultiplier = Math.max(0.9, Math.min(1.1, qualityMultiplier));
  }
  
  // Corroboration: from support edges (claim-to-claim or claim-to-evidence)
  let corroboration01 = 1.0;
  if (issue.evidence.edges && issue.evidence.edges.length > 0) {
    const supportEdges = issue.evidence.edges.filter(e => e.kind === 'support');
    if (supportEdges.length > 0) {
      const maxSupportWeight = Math.max(...supportEdges.map(e => e.weight || 0));
      // Up to 15% boost from support edges
      corroboration01 = Math.min(1.0, 1.0 + (maxSupportWeight * 0.15));
    }
  }
  
  // Boost from external evidence refs (only for EXTERNAL_VERIFIED)
  if (level === 'EXTERNAL_VERIFIED' && issue.evidence.refs && issue.evidence.refs.length > 0) {
    const externalRefs = issue.evidence.refs.filter(r => r.sourceType !== 'TRANSCRIPT');
    if (externalRefs.length > 0) {
      corroboration01 = Math.min(1.0, corroboration01 + 0.2); // Additional boost for external evidence
    }
  }
  
  // Compute evidence01
  const evidence01 = baseEvidence01 * qualityMultiplier * corroboration01;
  
  return clamp01(evidence01);
}

/**
 * Compute signal01 from graph + spectral (graceful degrade)
 * Uses edge weights, confidence, and structural importance
 * Falls back to degradedMode values when data missing
 */
/**
 * Compute signal01 from graph + spectral (graceful degrade)
 * 8.1: Use continuous features in scoring inputs to reduce "same score plateaus"
 * Uses edge weights, confidence, anchor strength, and structural importance
 * Normalizes edge weights within conversation to create score spread
 */
function computeSignal01(
  issue: IssueV2, 
  config: RiskRankingConfig,
  allIssues?: IssueV2[],
  normalizationFactors?: ReturnType<typeof computeNormalizationFactors>
): number {
  // Start with confidence (already 0..1)
  // Use actual confidence, not degraded fallback (creates plateaus)
  let signal = issue.confidence || 0.4; // Lower default to allow edge weights to differentiate
  
  // 8.1: Edge weight (continuous feature) - NORMALIZED within conversation
  let edgeWeight01 = 0;
  if (issue.evidence.edges && issue.evidence.edges.length > 0) {
    const maxEdgeWeight = Math.max(...issue.evidence.edges.map(e => e.weight || 0));
    
    // Normalize edge weight within conversation to create spread
    if (normalizationFactors && normalizationFactors.maxEdgeWeight > normalizationFactors.minEdgeWeight) {
      // Min-max normalization: (value - min) / (max - min)
      const normalized = (maxEdgeWeight - normalizationFactors.minEdgeWeight) / 
                        (normalizationFactors.maxEdgeWeight - normalizationFactors.minEdgeWeight);
      edgeWeight01 = normalized;
    } else {
      // Fallback: use raw weight if no normalization data
      edgeWeight01 = maxEdgeWeight;
    }
    
    // Edge weight contributes significantly (up to 0.4) to differentiate issues
    signal = Math.min(1.0, signal + (edgeWeight01 * 0.4));
  } else {
    // No edges: penalize but don't use uniform degraded mode
    // Use a lower base that varies by issue type
    const baseSignal = issue.type === 'CONTRADICTION' ? 0.35 : 
                      issue.type === 'DATA_INTEGRITY' ? 0.40 :
                      0.30;
    signal = Math.max(signal, baseSignal);
  }
  
  // 8.1: Anchor match strength (for contradictions) - continuous boost
  // Note: anchors are on ClaimNode, not IssueV2, so we infer from clusterKey
  // If clusterKey contains anchor info (e.g., "MONEY:214.73"), boost signal
  let anchorMatchStrength01 = 0;
  if (issue.type === 'CONTRADICTION' && issue.clusterKey) {
    const hasAnchorInKey = /(MONEY|DATE|TIMEFRAME|PAYMENT_CARD|SSN_LAST4):/.test(issue.clusterKey);
    if (hasAnchorInKey) {
      // Extract anchor value if present (e.g., "MONEY:214.73" -> 0.4 boost)
      // Stronger anchors (money, payment card) get higher boost
      const anchorMatch = issue.clusterKey.match(/(MONEY|PAYMENT_CARD|SSN_LAST4):/);
      if (anchorMatch) {
        const anchorType = anchorMatch[1];
        anchorMatchStrength01 = anchorType === 'MONEY' || anchorType === 'PAYMENT_CARD' ? 0.5 : 0.3;
        signal = Math.min(1.0, signal + (anchorMatchStrength01 * 0.15)); // Up to 0.075 boost
      }
    }
  }
  
  // 8.1: Cluster size (reversal count - how many contradictions in same cluster)
  // Count issues in same cluster to boost signal
  let clusterSize01 = 0;
  if (allIssues && issue.clusterId) {
    const clusterIssues = allIssues.filter(i => i.clusterId === issue.clusterId);
    const occurrences = clusterIssues.length;
    // Normalize occurrences (log scale to prevent saturation)
    clusterSize01 = Math.min(1.0, Math.log1p(occurrences) / Math.log(11)); // log(11) ≈ 2.4, so 10 occurrences ≈ 0.96
    signal = Math.min(1.0, signal + (clusterSize01 * 0.12)); // Up to 0.12 boost
  } else if ((issue as any).occurrences) {
    // Fallback: use occurrences if available (from aggregated issues)
    clusterSize01 = Math.min(1.0, Math.log1p((issue as any).occurrences) / Math.log(11));
    signal = Math.min(1.0, signal + (clusterSize01 * 0.12));
  }
  
  // Boost from evidence refs (grounding strength) - use actual weights
  if (issue.evidence.refs && issue.evidence.refs.length > 0) {
    const weights = issue.evidence.refs.map(r => r.weight || 0).filter(w => w > 0);
    if (weights.length > 0) {
      const avgRefWeight = weights.reduce((sum, w) => sum + w, 0) / weights.length;
      // Ref weight contributes up to 0.15 (reduced from 0.2 to allow edge weight to dominate)
      signal = Math.min(1.0, signal + (avgRefWeight * 0.15));
    }
  }
  
  // Type-based signal boost (contradictions, risk signals are stronger)
  // Use config.typeBase if available, otherwise use smaller boosts
  const typeBase = config.weights.typeBase?.[issue.type] || 0.5;
  if (typeBase > 0.5) {
    // Normalize typeBase to 0..1 contribution (typeBase is 0.3-0.8, so normalize to 0..0.2 boost)
    const typeBoost = ((typeBase - 0.3) / 0.5) * 0.2; // Maps 0.3->0, 0.8->0.2
    signal = Math.min(1.0, signal + typeBoost);
  }
  
  return clamp01(signal);
}

/**
 * Compute category01 from category and compliance tags (0..1)
 * Maps category and tags to meaningful risk scores
 * NO hard-coded 0 values - always returns a meaningful score
 */
/**
 * 8.1: Compute category01 using continuous features to reduce plateaus
 * Uses tag counts, category base score, and continuous multipliers
 */
function computeCategory01(issue: IssueV2, config: RiskRankingConfig): number {
  // Start with category multiplier if available (continuous base, 0..1)
  let categoryBase = config.weights.categoryMultiplier?.[issue.category] || 0.5;
  
  // 8.1: Use continuous tag scoring instead of binary checks
  // Count tags and apply continuous boosts
  const tags = issue.compliance?.tags || [];
  let tagBoost = 0;
  
  if (tags.length > 0) {
    // Count high-priority tags (continuous feature)
    const highPriorityCount = tags.filter(tag => 
      tag.includes('privacy') || tag.includes('pci') || tag.includes('security') || tag.includes('cvv')
    ).length;
    const complianceCount = tags.filter(tag => 
      tag.includes('compliance') || tag.includes('regulatory')
    ).length;
    const billingCount = tags.filter(tag => 
      tag.includes('billing') || tag.includes('fee') || tag.includes('refund') || tag.includes('money')
    ).length;
    const disputeCount = tags.filter(tag => 
      tag.includes('dispute') || tag.includes('customer_risk')
    ).length;
    const qualityCount = tags.filter(tag => 
      tag.includes('tone') || tag.includes('quality')
    ).length;
    
    // Continuous boosts based on counts (normalized)
    tagBoost = Math.min(0.5, 
      (highPriorityCount * 0.15) +      // Up to 0.15 per high-priority tag
      (complianceCount * 0.12) +          // Up to 0.12 per compliance tag
      (billingCount * 0.10) +             // Up to 0.10 per billing tag
      (disputeCount * 0.08) -             // Up to 0.08 per dispute tag
      (qualityCount * 0.05)               // Penalty for quality tags
    );
  }
  
  // Consistency category gets base boost if it's a contradiction
  if (issue.category === 'consistency' && issue.type === 'CONTRADICTION') {
    categoryBase = Math.max(categoryBase, 0.7);
  }
  
  // 8.1: Combine base and tag boost (continuous, not binary)
  const category01 = clamp01(categoryBase + tagBoost);
  
  // Fallback: Map category directly if no tags and category has known mapping
  if (category01 === 0.5 && !config.weights.categoryMultiplier?.[issue.category]) {
    // Direct category mapping (fallback if no tags)
    const categoryMap: Record<string, number> = {
      'privacy': 0.9,
      'security': 0.9,
      'compliance': 0.8,
      'billing': 0.8,
      'fees': 0.8,
      'refunds': 0.8,
      'disclosure': 0.75,
      'consistency': 0.6,
      'data_integrity': 0.7,
      'other': 0.5,
    };
    return clamp01(categoryMap[issue.category] || 0.5);
  }
  
  return category01;
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
  compliance?: { legalHoldSuggested?: boolean; tags?: string[] },
  scoringContext?: ScoringContext,
  issue?: IssueV2 // E2: Optional issue for tag checking
): SeverityDisplayV2 {
  // Never downgrade legal hold / critical compliance signals
  if (compliance?.legalHoldSuggested) {
    // Map critical -> high for display (severityDisplay doesn't have 'critical')
    return severity === 'critical' ? 'high' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
  }
  
  // E2: Mode safety rule - transcript-only should cap display severity only for certain types
  // Must not downgrade:
  // - CONTRADICTION
  // - DATA_INTEGRITY
  // - "recording/CVV storage" (security/compliance critical)
  // - fee/price/refund contradictions
  // So transcript-only can still produce High / Critical display if it's inherently provable from the call.
  
  // Check for security/compliance critical issues (recording/CVV storage)
  // Note: compliance is optional, so we need to check safely
  const tags = compliance?.tags || [];
  const isSecurityCritical = issueType === 'DATA_INTEGRITY' || 
                             tags.some(tag => 
                               tag.toLowerCase().includes('cvv') ||
                               tag.toLowerCase().includes('recording') ||
                               tag.toLowerCase().includes('pci') ||
                               tag.toLowerCase().includes('security')
                             );
  
  // Check for fee/price/refund contradictions
  const isMoneyContradiction = issueType === 'CONTRADICTION' && 
                               tags.some(tag => 
                                 tag.toLowerCase().includes('fee') ||
                                 tag.toLowerCase().includes('price') ||
                                 tag.toLowerCase().includes('refund') ||
                                 tag.toLowerCase().includes('billing')
                               );
  
  // E2: Never downgrade contradictions, data integrity, security/compliance critical, or money contradictions
  if (issueType === 'CONTRADICTION' || issueType === 'DATA_INTEGRITY' || isSecurityCritical || isMoneyContradiction) {
    // Map severity to display (critical -> high, others stay)
    if (severity === 'critical') return 'high';
    if (severity === 'high') return 'high';
    if (severity === 'medium') return 'medium';
    return 'low';
  }
  
  // Only downgrade evidence-type "UNVERIFIED" items in transcript-only mode
  if (scoringContext?.mode === 'transcript_only' && verificationLevel === 'TRANSCRIPT_ONLY' && issueType === 'UNVERIFIED_CLAIM') {
    // Downgrade by one band (critical->high->medium->low), but do NOT force medium
    return downgradeOneBand(severity);
  }
  
  // Do not downgrade risk_signals, safety, harassment, etc.
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

// Removed deprecated computeRiskScore function - use scoreIssue() instead

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

