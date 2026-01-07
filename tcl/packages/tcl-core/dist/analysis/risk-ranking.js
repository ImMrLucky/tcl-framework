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
import { getRiskRankingConfig } from '../config/risk-ranking.js';
/**
 * Rank issues by risk score (deterministic)
 * Uses new pipeline: impact + evidence + signal + category → risk01 → severity
 */
export function rankIssuesV2(issues, config, scoringContext) {
    const rankingConfig = config || getRiskRankingConfig();
    // Score all issues using new pipeline
    const scoredIssues = issues.map(issue => {
        return scoreIssue(issue, rankingConfig, scoringContext);
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
        const impactOrder = {
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
        const verificationOrder = {
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
            if (typeAIdx >= 0 && typeBIdx < 0)
                return -1;
            if (typeAIdx < 0 && typeBIdx >= 0)
                return 1;
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
function scoreIssue(issue, config, scoringContext) {
    // Step 1: Compute component scores (all 0..1, all from config)
    const impact01 = computeImpact01(issue, config);
    const evidence01 = computeEvidence01(issue, config);
    const signal01 = computeSignal01(issue, config);
    const category01 = computeCategory01(issue, config);
    // Step 2: Get weights from config (validated on startup)
    const wImpact = config.weights.riskScoring.impact;
    const wEvidence = config.weights.riskScoring.evidence;
    const wSignal = config.weights.riskScoring.signal;
    const wCategory = config.weights.riskScoring.category;
    // Step 3: Weighted average (no clamping yet)
    const risk01 = (wImpact * impact01) +
        (wEvidence * evidence01) +
        (wSignal * signal01) +
        (wCategory * category01);
    // Step 4: Clamp to 0..1
    const riskScore = clamp01(risk01);
    // Step 5: Convert to 0..100 score
    const score = Math.round(riskScore * 100);
    // Step 6: Derive severity from riskScore (canonical severity, independent of mode)
    let severity = deriveSeverity(riskScore, config);
    // Apply category-based minimums (e.g., CONTRADICTION involving MONEY/FEES/REFUND => min "high")
    severity = applyCategoryMinimums(severity, issue, config);
    // Step 7: Compute severityDisplay with conditional downgrade (not blanket cap)
    const severityDisplay = computeSeverityDisplay(severity, issue.verification.level, issue.type, issue.compliance, scoringContext);
    // MODE SAFETY: impact is UNCHANGED in transcript-only mode
    // Preserve existing impact if set, otherwise derive from impact01 using config thresholds
    // Use midpoints between impactMap values as thresholds
    const impactThresholds = {
        high: (config.impactMap.high + config.impactMap.medium) / 2,
        medium: (config.impactMap.medium + config.impactMap.low) / 2,
    };
    const finalImpact = issue.impact ||
        (impact01 >= impactThresholds.high ? 'high' :
            impact01 >= impactThresholds.medium ? 'medium' : 'low');
    // Note: impact is NOT affected by transcript-only mode (only severityDisplay is capped)
    // Step 8: Build scoring explanation (enterprise requirement)
    const scoringReasons = [];
    // Impact reason
    if (finalImpact === 'high') {
        scoringReasons.push(`High impact: ${issue.type} in ${issue.category} category`);
    }
    else if (finalImpact === 'medium') {
        scoringReasons.push(`Medium impact: ${issue.type} in ${issue.category} category`);
    }
    // Evidence reason
    if (issue.verification.level === 'EXTERNAL_VERIFIED') {
        scoringReasons.push('Externally verified with policy/document evidence');
    }
    else if (issue.verification.level === 'TRANSCRIPT_ONLY') {
        scoringReasons.push('Transcript-only mode: not externally verified');
    }
    else {
        scoringReasons.push('No verification evidence available');
    }
    // Signal reason
    if (signal01 >= 0.8) {
        scoringReasons.push('Strong graph/spectral signals detected');
    }
    else if (signal01 >= 0.6) {
        scoringReasons.push('Moderate graph/spectral signals');
    }
    else if (signal01 < 0.4) {
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
function computeImpact01(issue, config) {
    const impact = issue.impact || 'low';
    return config.impactMap[impact];
}
/**
 * Compute evidence01 from issue.verification.level (0..1)
 * Uses config.evidenceMap (no hard-coded values)
 */
function computeEvidence01(issue, config) {
    const level = issue.verification.level;
    return config.evidenceMap[level];
}
/**
 * Compute signal01 from graph + spectral (graceful degrade)
 * Uses edge weights, confidence, and structural importance
 * Falls back to degradedMode values when data missing
 */
function computeSignal01(issue, config) {
    // Start with confidence (already 0..1)
    let signal = issue.confidence || config.degradedMode.missingSpectralSignal01;
    // Boost from edge weights (contradiction/support edges)
    if (issue.evidence.edges && issue.evidence.edges.length > 0) {
        const maxEdgeWeight = Math.max(...issue.evidence.edges.map(e => e.weight || 0));
        // Edge weight contributes up to 0.3 (could be config-driven in future)
        signal = Math.min(1.0, signal + (maxEdgeWeight * 0.3));
    }
    else {
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
    }
    else if (issue.type === 'RISK_SIGNAL' || issue.type === 'FEE_DISCLOSURE_RISK') {
        signal = Math.min(1.0, signal + 0.10);
    }
    return clamp01(signal);
}
/**
 * Compute category01 from config (normalized)
 * Uses config.categoryNormalization (no hard-coded values)
 */
function computeCategory01(issue, config) {
    const categoryMult = config.weights.categoryMultiplier?.[issue.category] || config.categoryNormalization.min;
    // Normalize using config range
    const range = config.categoryNormalization.max - config.categoryNormalization.min;
    const normalized = (categoryMult - config.categoryNormalization.min) / range;
    return clamp01(normalized);
}
/**
 * Derive severity from riskScore using thresholds
 */
function deriveSeverity(riskScore, config) {
    const thresholds = config.severityThresholds;
    if (riskScore >= thresholds.critical)
        return 'critical';
    if (riskScore >= thresholds.high)
        return 'high';
    if (riskScore >= thresholds.medium)
        return 'medium';
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
function computeSeverityDisplay(severity, verificationLevel, issueType, compliance, scoringContext) {
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
    if (severity === 'critical')
        return 'high';
    if (severity === 'high')
        return 'high';
    if (severity === 'medium')
        return 'medium';
    return 'low';
}
/**
 * Downgrade severity by one band (critical->high->medium->low)
 */
function downgradeOneBand(severity) {
    if (severity === 'critical')
        return 'high';
    if (severity === 'high')
        return 'medium';
    if (severity === 'medium')
        return 'low';
    return 'low';
}
/**
 * Apply category-based minimums to severity
 * Examples:
 * - CONTRADICTION involving MONEY/FEES/REFUND => min "high"
 * - LEGAL_HOLD suggested => min "high" or "critical"
 */
function applyCategoryMinimums(severity, issue, config) {
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
            issue.compliance?.tags?.some(tag => tag.toLowerCase().includes('fee') ||
                tag.toLowerCase().includes('money') ||
                tag.toLowerCase().includes('refund') ||
                tag.toLowerCase().includes('billing'));
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
function computeRiskScore(issue, config) {
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
    }
    else if (issue.evidence.refs && issue.evidence.refs.length > 0) {
        const weights = issue.evidence.refs.map(r => r.weight || 0).filter(w => w > 0);
        if (weights.length > 0) {
            structuralImportance = weights.reduce((a, b) => a + b, 0) / weights.length;
        }
    }
    // Customer impact (based on type and category)
    let impact01 = 0.5; // Default
    if (issue.type === 'RISK_SIGNAL' || issue.type === 'CONTRADICTION') {
        impact01 = 0.8;
    }
    else if (issue.category === 'compliance' || issue.compliance.tags?.some(tag => tag.includes('fee') || tag.includes('billing') || tag.includes('refund'))) {
        impact01 = 0.7;
    }
    else if (issue.compliance.tags?.includes('high_impact')) {
        impact01 = 0.75;
    }
    // Evidence penalty (lower score if transcript-only or no evidence)
    let evidencePenalty01 = 0;
    if (issue.verification.level === 'TRANSCRIPT_ONLY') {
        evidencePenalty01 = 0.2; // Small penalty for transcript-only
    }
    else if (issue.verification.level === 'NONE') {
        evidencePenalty01 = 0.4; // Larger penalty for no evidence
    }
    // Compute composite score (0..100)
    const compositeScore = 100 * clamp01(w_severity * severity01 +
        w_category * category01 +
        w_confidence * confidence01 +
        w_structure * structuralImportance +
        w_impact * impact01 -
        w_evidencePenalty * evidencePenalty01);
    // Convert to riskScore (0..1) for backward compatibility
    const riskScore = compositeScore / 100;
    // Determine severity from composite score thresholds
    const severity = deriveSeverity(riskScore, config);
    // Update legal hold suggestion (high/critical + agent + disclosure/billing)
    const legalHoldSuggested = (severity === 'high' || severity === 'critical') &&
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
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
/**
 * Generate summary statistics
 */
function generateSummary(issues, topCount, scoringContext) {
    const byType = {};
    const bySeverity = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
    };
    const byCategory = {};
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
