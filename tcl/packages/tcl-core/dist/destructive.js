/**
 * Compute ranked destructive claims with importance scoring
 *
 * This module identifies and ranks claims that are most problematic,
 * using spectral analysis, contradiction pressure, confidence metrics,
 * and policy violations.
 */
export function computeDestructiveClaims(args) {
    const { claims, contradictions, grounding, customRuleViolations, spectral } = args;
    if (claims.length === 0) {
        return [];
    }
    // Build maps for efficient lookup
    const idToIdx = new Map();
    claims.forEach((c, i) => idToIdx.set(c.id, i));
    const claimMap = new Map(claims.map(c => [c.id, c]));
    // 1) Build contradiction incident sum per claim
    const contradictionIncidentSum = new Map();
    for (const cont of contradictions) {
        const sumA = contradictionIncidentSum.get(cont.claimA) || 0;
        const sumB = contradictionIncidentSum.get(cont.claimB) || 0;
        contradictionIncidentSum.set(cont.claimA, sumA + cont.weight);
        contradictionIncidentSum.set(cont.claimB, sumB + cont.weight);
    }
    // Normalize contradiction incident
    const maxCon = Math.max(1e-9, ...Array.from(contradictionIncidentSum.values()));
    const contradictionNorm = new Map();
    for (const [claimId, sum] of contradictionIncidentSum.entries()) {
        contradictionNorm.set(claimId, sum / maxCon);
    }
    // 2) Build policy severity map
    const policySeverity = new Map();
    const policyRuleIds = new Map();
    for (const violation of customRuleViolations) {
        if (violation.type === "CUSTOM_RULE" && violation.claimId) {
            const rule = customRuleViolations.find(v => v.type === "CUSTOM_RULE" && v.ruleId);
            const severity = rule?.type === "CUSTOM_RULE" ? "error" : "warning"; // Simplified
            policySeverity.set(violation.claimId, severity);
            const existing = policyRuleIds.get(violation.claimId) || [];
            if (violation.ruleId) {
                existing.push(violation.ruleId);
            }
            policyRuleIds.set(violation.claimId, existing);
        }
    }
    // 3) Extract confidence/grounding from claims
    const confidenceOverall = new Map();
    const groundingScore = new Map();
    for (const claim of claims) {
        if (claim.confidenceMetrics) {
            // Use actual confidence metrics from the claim (only if computed)
            if (claim.confidenceMetrics.overall !== undefined) {
                confidenceOverall.set(claim.id, claim.confidenceMetrics.overall);
            }
            if (claim.confidenceMetrics.groundingScore !== undefined) {
                groundingScore.set(claim.id, claim.confidenceMetrics.groundingScore);
            }
        }
        else {
            // Compute from actual grounding edges (real data, not heuristic)
            const claimGrounding = grounding.filter(g => g.claimId === claim.id);
            if (claimGrounding.length > 0) {
                const maxGrounding = Math.max(...claimGrounding.map(g => g.weight));
                groundingScore.set(claim.id, maxGrounding);
                // Only set confidence if we have grounding data
                // Don't use text length heuristics - that's fake data
            }
        }
    }
    // 4) Compute importance for each claim
    const destructiveClaims = [];
    for (const claim of claims) {
        const idx = idToIdx.get(claim.id);
        if (idx === undefined)
            continue;
        // Extract spectral data
        const nodeBlameNorm = spectral?.nodeBlameNorm?.[idx] ?? 0;
        const truthState = spectral?.truthStates?.[idx];
        const truthValue = spectral?.truthVector?.[idx];
        const conNorm = contradictionNorm.get(claim.id) ?? 0;
        const confOverall = confidenceOverall.get(claim.id) ?? 0.5;
        const gndScore = groundingScore.get(claim.id) ?? 0;
        const policySev = policySeverity.get(claim.id) ?? "none";
        const ruleIds = policyRuleIds.get(claim.id) || [];
        // Policy boost
        const policyBoost = policySev === "error" ? 1.0 : policySev === "warning" ? 0.5 : 0;
        // Base importance formula
        let importance = 0.55 * nodeBlameNorm +
            0.20 * conNorm +
            0.15 * (1 - confOverall) +
            0.10 * policyBoost;
        // Adjustments based on truth state
        if (truthState === "Contradicted") {
            importance *= 1.35;
        }
        else if (truthState === "Ungrounded") {
            importance *= 1.15;
        }
        // Reduce importance if well-grounded
        if (gndScore >= 0.7) {
            importance *= 0.85;
        }
        // Clamp to 0..1
        importance = Math.max(0, Math.min(1, importance));
        // Build reasons array
        const reasons = [];
        if (nodeBlameNorm > 0.1) {
            reasons.push({
                kind: "node_blame",
                weight: nodeBlameNorm,
                detail: `High spectral blame (${nodeBlameNorm.toFixed(2)})`
            });
        }
        if (conNorm > 0.1) {
            reasons.push({
                kind: "contradiction_pressure",
                weight: conNorm,
                detail: `Involved in ${contradictionIncidentSum.get(claim.id)?.toFixed(2) || 0} contradiction weight`
            });
        }
        if (confOverall < 0.5) {
            reasons.push({
                kind: "low_confidence",
                weight: 1 - confOverall,
                detail: `Low overall confidence (${confOverall.toFixed(2)})`
            });
        }
        if (policySev !== "none") {
            reasons.push({
                kind: "policy_violation",
                weight: policyBoost,
                detail: `Policy violation: ${policySev} (rules: ${ruleIds.join(", ")})`
            });
        }
        if (truthState === "Ungrounded") {
            reasons.push({
                kind: "ungrounded",
                weight: 0.3,
                detail: "Claim is ungrounded (no evidence)"
            });
        }
        if (truthState === "Contradicted") {
            reasons.push({
                kind: "contradicted",
                weight: 0.4,
                detail: "Claim is contradicted by spectral analysis"
            });
        }
        destructiveClaims.push({
            claimId: claim.id,
            text: claim.text,
            importance,
            truthState,
            truthValue,
            nodeBlameNorm,
            contradictionIncident: conNorm,
            confidenceOverall: confOverall,
            groundingScore: gndScore,
            policySeverity: policySev,
            policyRuleIds: ruleIds,
            reasons
        });
    }
    // Sort by importance descending
    destructiveClaims.sort((a, b) => b.importance - a.importance);
    return destructiveClaims;
}
