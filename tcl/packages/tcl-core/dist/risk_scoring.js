/**
 * Risk Scoring Module
 *
 * Computes severity and risk scores from measurable signals.
 * NO HARD-CODED SCORES - all outputs derived from inputs.
 *
 * Signals used:
 * - claimType (PROMISE > ASSERTION > POLICY_STATEMENT)
 * - speaker (AGENT > CUSTOMER for liability)
 * - topicTags (billing, fees, cancel, penalty = high stakes)
 * - NLI scores (contradiction, support, grounding)
 * - Spectral outputs (nodeBlameNorm, truthState)
 * - Linguistic features (absolute language, money mentions)
 */
// Default configuration - can be overridden via env
export function getDefaultRiskConfig() {
    return {
        severityThresholds: {
            critical: parseFloat(process.env.RISK_THRESHOLD_CRITICAL || "0.85"),
            high: parseFloat(process.env.RISK_THRESHOLD_HIGH || "0.65"),
            medium: parseFloat(process.env.RISK_THRESHOLD_MEDIUM || "0.35"),
        },
        weights: {
            claimType: parseFloat(process.env.RISK_WEIGHT_CLAIM_TYPE || "0.15"),
            speaker: parseFloat(process.env.RISK_WEIGHT_SPEAKER || "0.10"),
            topic: parseFloat(process.env.RISK_WEIGHT_TOPIC || "0.15"),
            contradiction: parseFloat(process.env.RISK_WEIGHT_CONTRADICTION || "0.25"),
            grounding: parseFloat(process.env.RISK_WEIGHT_GROUNDING || "0.15"),
            absoluteLanguage: parseFloat(process.env.RISK_WEIGHT_ABSOLUTE || "0.05"),
            money: parseFloat(process.env.RISK_WEIGHT_MONEY || "0.05"),
            nodeBlame: parseFloat(process.env.RISK_WEIGHT_NODE_BLAME || "0.05"),
            truthState: parseFloat(process.env.RISK_WEIGHT_TRUTH_STATE || "0.05"),
        },
        claimTypeRisk: {
            PROMISE: 0.9, // Highest risk - agent commitments
            ASSERTION: 0.7, // High risk - factual claims
            POLICY_STATEMENT: 0.6, // Medium-high - policy references
            DISCLAIMER: 0.5, // Medium - caveats
            QUESTION: 0.0, // Not auditable
            REQUEST: 0.0, // Not auditable
            ACKNOWLEDGEMENT: 0.0, // Not auditable
            FILLER: 0.0, // Not auditable
        },
        topicRisk: {
            cancel: 0.9, // Cancellation - highest risk
            penalty: 0.9, // Penalties - highest risk
            fee: 0.8, // Fees - high risk
            billing: 0.7, // Billing - high risk
            refund: 0.7, // Refunds - high risk
            plan: 0.5, // Plan details - medium risk
            account: 0.3, // Account info - lower risk
            promise: 0.8, // Promises - high risk
        }
    };
}
/**
 * Extract risk signals from claim and analysis results.
 * All signals are normalized to 0-1 range.
 */
export function extractRiskSignals(claim, analysisResults) {
    const speaker = (claim.meta?.speaker === "Agent" || claim.meta?.speaker === "AGENT") ? "AGENT" :
        (claim.meta?.speaker === "Customer" || claim.meta?.speaker === "CUSTOMER") ? "CUSTOMER" :
            "UNKNOWN";
    // Count contradictions involving this claim
    const contradictions = analysisResults?.contradictions || [];
    const involvedContradictions = contradictions.filter(c => c.claimA === claim.id || c.claimB === claim.id);
    return {
        claimType: claim.claimType,
        speaker,
        topicTags: claim.topicTags,
        hasAbsoluteLanguage: claim.hasAbsoluteLanguage,
        hasMoney: claim.hasMoney,
        maxContradictionScore: analysisResults?.nliScores?.contradiction ?? 0,
        maxSupportScore: analysisResults?.nliScores?.support ?? 0,
        groundingScore: analysisResults?.nliScores?.grounding ?? 0,
        nodeBlameNorm: analysisResults?.spectral?.nodeBlameNorm ?? 0,
        truthState: analysisResults?.spectral?.truthState ?? "Inconclusive",
        involvedInContradiction: involvedContradictions.length > 0,
        contradictionCount: involvedContradictions.length,
    };
}
/**
 * Compute risk score from signals.
 * All scores are COMPUTED, not hard-coded.
 */
export function computeRiskScore(signals, config = getDefaultRiskConfig()) {
    const breakdown = {
        claimTypeRisk: 0,
        speakerRisk: 0,
        topicRisk: 0,
        contradictionRisk: 0,
        groundingRisk: 0,
        absoluteLanguageRisk: 0,
        moneyRisk: 0,
        nodeBlameRisk: 0,
        truthStateRisk: 0,
    };
    // 1. Claim type risk
    breakdown.claimTypeRisk = config.claimTypeRisk[signals.claimType] ?? 0;
    // 2. Speaker risk (agent statements carry more liability)
    breakdown.speakerRisk = signals.speaker === "AGENT" ? 0.8 :
        signals.speaker === "CUSTOMER" ? 0.3 : 0.5;
    // 3. Topic risk (max of all applicable topics)
    if (signals.topicTags.length > 0) {
        breakdown.topicRisk = Math.max(...signals.topicTags.map(t => config.topicRisk[t] ?? 0.2));
    }
    // 4. Contradiction risk (from NLI)
    // Higher contradiction score = higher risk
    breakdown.contradictionRisk = signals.maxContradictionScore;
    if (signals.involvedInContradiction) {
        // Boost if actually involved in graph contradictions
        breakdown.contradictionRisk = Math.min(1.0, breakdown.contradictionRisk + 0.3);
    }
    // 5. Grounding risk (inverse of grounding score)
    // Low grounding = high risk
    breakdown.groundingRisk = 1.0 - signals.groundingScore;
    // 6. Absolute language risk
    breakdown.absoluteLanguageRisk = signals.hasAbsoluteLanguage ? 0.9 : 0.0;
    // 7. Money mention risk
    breakdown.moneyRisk = signals.hasMoney ? 0.8 : 0.0;
    // 8. Node blame risk (from spectral)
    breakdown.nodeBlameRisk = signals.nodeBlameNorm;
    // 9. Truth state risk
    breakdown.truthStateRisk = {
        "Contradicted": 1.0,
        "Ungrounded": 0.7,
        "Inconclusive": 0.4,
        "Supported": 0.0
    }[signals.truthState] ?? 0.4;
    // Compute weighted average
    const weights = config.weights;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const riskScore = Math.min(1.0, (breakdown.claimTypeRisk * weights.claimType +
        breakdown.speakerRisk * weights.speaker +
        breakdown.topicRisk * weights.topic +
        breakdown.contradictionRisk * weights.contradiction +
        breakdown.groundingRisk * weights.grounding +
        breakdown.absoluteLanguageRisk * weights.absoluteLanguage +
        breakdown.moneyRisk * weights.money +
        breakdown.nodeBlameRisk * weights.nodeBlame +
        breakdown.truthStateRisk * weights.truthState) / totalWeight);
    // Determine severity from thresholds
    let severity;
    if (riskScore >= config.severityThresholds.critical) {
        severity = "critical";
    }
    else if (riskScore >= config.severityThresholds.high) {
        severity = "high";
    }
    else if (riskScore >= config.severityThresholds.medium) {
        severity = "medium";
    }
    else {
        severity = "low";
    }
    // Generate explanation
    const explanation = generateRiskExplanation(signals, breakdown, severity);
    return {
        riskScore,
        severity,
        breakdown,
        explanation
    };
}
/**
 * Generate human-readable explanation of why this claim is risky.
 */
function generateRiskExplanation(signals, breakdown, severity) {
    const reasons = [];
    // Highest impact reasons first
    if (breakdown.contradictionRisk > 0.5) {
        reasons.push(`contradicts other statements (score: ${breakdown.contradictionRisk.toFixed(2)})`);
    }
    if (breakdown.groundingRisk > 0.7) {
        reasons.push("lacks supporting evidence");
    }
    if (signals.hasAbsoluteLanguage) {
        reasons.push("uses absolute language (always, never, guaranteed)");
    }
    if (signals.hasMoney) {
        reasons.push("involves monetary terms");
    }
    if (signals.topicTags.includes("cancel") || signals.topicTags.includes("penalty")) {
        reasons.push("concerns cancellation or penalties");
    }
    if (signals.claimType === "PROMISE" && signals.speaker === "AGENT") {
        reasons.push("agent made a binding commitment");
    }
    if (signals.truthState === "Contradicted") {
        reasons.push("marked as contradicted by spectral analysis");
    }
    else if (signals.truthState === "Ungrounded") {
        reasons.push("not grounded in evidence");
    }
    if (breakdown.nodeBlameRisk > 0.5) {
        reasons.push(`high graph centrality blame (${breakdown.nodeBlameRisk.toFixed(2)})`);
    }
    if (reasons.length === 0) {
        return "General compliance review recommended";
    }
    return `Flagged because: ${reasons.join("; ")}`;
}
/**
 * Determine issue type from signals.
 *
 * Key distinction:
 * - UNVERIFIED: No external policy/evidence docs available (transcript-only mode)
 * - UNSUPPORTED: External docs present but claim has no supporting evidence
 */
export function determineIssueType(signals, options) {
    // Priority 1: Explicit contradictions
    if (signals.truthState === "Contradicted" || signals.maxContradictionScore > 0.7) {
        return "CONTRADICTION";
    }
    // Priority 2: Policy violations
    if (options.policyViolation) {
        return "POLICY_VIOLATION";
    }
    // Priority 3: Policy misses
    if (options.policyMiss) {
        return "POLICY_MISS";
    }
    // Priority 4: Circular reasoning
    if (options.isCircular) {
        return "CIRCULAR";
    }
    // Priority 5: Ungrounded claims
    if (signals.truthState === "Ungrounded" || signals.groundingScore < 0.3) {
        // Distinguish between UNVERIFIED (no external docs) and UNSUPPORTED (has docs but no support)
        if (!options.hasExternalDocs) {
            return "UNVERIFIED";
        }
        return "UNSUPPORTED";
    }
    // Priority 6: Agent promises (high risk even if not contradicted)
    if (signals.claimType === "PROMISE" && signals.speaker === "AGENT") {
        return "PROMISE_RISK";
    }
    // Priority 7: Absolute language (always, never, guaranteed)
    if (signals.hasAbsoluteLanguage && signals.speaker === "AGENT") {
        return "ABSOLUTE_CLAIM";
    }
    // Priority 8: Late disclaimers
    if (signals.claimType === "DISCLAIMER" && options.turnIndex !== undefined && options.totalTurns !== undefined) {
        const progress = options.turnIndex / options.totalTurns;
        if (progress > 0.5) { // Disclaimer in second half of conversation
            return "LATE_DISCLAIMER";
        }
    }
    // Priority 9: Vague language
    const vaguePatterns = [
        /depends on/i, /it varies/i, /might be/i, /could be/i,
        /sometimes/i, /usually/i, /in some cases/i
    ];
    if (vaguePatterns.some(p => p.test(signals.claimType)) && signals.speaker === "AGENT") {
        return "VAGUE_LANGUAGE";
    }
    // Default based on grounding
    if (!options.hasExternalDocs) {
        return "UNVERIFIED";
    }
    return "UNSUPPORTED";
}
/**
 * Get human-readable issue type label.
 */
export function getIssueTypeLabel(issueType) {
    const labels = {
        CONTRADICTION: "Contradiction Detected",
        UNVERIFIED: "Unverified (Transcript Only)",
        UNSUPPORTED: "Unsupported by Evidence",
        CIRCULAR: "Circular Reasoning",
        POLICY_VIOLATION: "Policy Violation",
        POLICY_MISS: "Missing Required Disclosure",
        VAGUE_LANGUAGE: "Vague/Ambiguous Language",
        LATE_DISCLAIMER: "Late Disclaimer",
        PROMISE_RISK: "Unverified Agent Promise",
        ABSOLUTE_CLAIM: "Absolute Claim Risk"
    };
    return labels[issueType] || issueType;
}
/**
 * Get issue type explanation for UI display.
 */
export function getIssueTypeExplanation(issueType, hasExternalDocs) {
    switch (issueType) {
        case "CONTRADICTION":
            return "This statement directly conflicts with another statement in the conversation.";
        case "UNVERIFIED":
            return "Not verifiable against policy/account documents; grounded in transcript only.";
        case "UNSUPPORTED":
            return "Policy and evidence documents are available, but this claim has no supporting evidence.";
        case "CIRCULAR":
            return "Part of a circular reasoning chain where claims support each other without independent verification.";
        case "POLICY_VIOLATION":
            return "This statement conflicts with established policy rules or guidelines.";
        case "POLICY_MISS":
            return "A required disclosure or disclaimer appears to be missing from the conversation.";
        case "VAGUE_LANGUAGE":
            return "Ambiguous or non-committal language that could lead to customer misunderstanding.";
        case "LATE_DISCLAIMER":
            return "Important disclaimer or caveat provided late in the conversation.";
        case "PROMISE_RISK":
            return "Agent made a commitment that should be verified and tracked.";
        case "ABSOLUTE_CLAIM":
            return "Statement uses absolute language (always, never, guaranteed) that may be difficult to defend.";
        default:
            return "This claim requires review.";
    }
}
