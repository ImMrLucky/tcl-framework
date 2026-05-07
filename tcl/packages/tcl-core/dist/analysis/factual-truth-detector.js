const FALSE_BY_RULE = [
    /guaranteed approval|definitely approved|\byou are approved\b|\byou qualify\b|everyone qualifies|no risk of denial|\bno denial\b|we can get you approved today/i,
    /approved before you apply|approved without carrier review/i,
    /every carrier will accept|any carrier will approve|all carriers accept/i,
    /health does not matter|regardless of health|diabetes does not matter|oxygen does not matter/i,
    /death benefit is guaranteed no matter what|family will absolutely receive|guarantee your family will receive/i,
    /full death benefit from day one|full payout immediately|immediate full coverage for everyone/i,
];
const MISLEADING = [
    /best rate|lowest rate guaranteed|best plan regardless of health/i,
    /no medical exam ever|all policies are no[- ]exam/i,
    /never share under any circumstances|never sell or share anything|answers are just between us/i,
    /licensed in your state|licensed in all states/i,
];
export function evaluateFactualTruth(claims, issues, context) {
    const classifications = [];
    let penalty = 0;
    for (const claim of claims.filter(isAgentClaim)) {
        const reasons = [];
        let classification = "UNVERIFIABLE";
        let claimPenalty = context.hasExternalEvidence ? 5 : 10;
        if (FALSE_BY_RULE.some(pattern => pattern.test(claim.text))) {
            classification = "FALSE_BY_RULE";
            claimPenalty = 35;
            reasons.push("violates baseline final-expense truth rule");
        }
        else if (MISLEADING.some(pattern => pattern.test(claim.text))) {
            classification = "MISLEADING";
            claimPenalty = 25;
            reasons.push("uses misleading absolute or unsupported sales language");
        }
        else if (/(may qualify|could be eligible|final approval depends on carrier|carrier underwriting applies|policy terms apply|waiting periods may apply)/i.test(claim.text)) {
            classification = "TRUE_SUPPORTED";
            claimPenalty = 0;
            reasons.push("uses qualified, policy-dependent language");
        }
        else if (/\b(approval|approved|qualify|eligible|death benefit|payout|coverage|premium|rate)\b/i.test(claim.text)) {
            classification = "TRUE_BUT_NEEDS_DISCLOSURE";
            claimPenalty = 12;
            reasons.push("insurance sales claim needs carrier/policy qualification");
        }
        classifications.push({ claimId: claim.id, classification, penalty: claimPenalty, reasons });
        penalty += claimPenalty;
    }
    const criticalIssues = issues.filter(i => i.severity === "critical").length;
    const highIssues = issues.filter(i => i.severity === "high").length;
    penalty += criticalIssues * 12 + highIssues * 4;
    return {
        factualTruthScore: Math.max(0, Math.round(100 - penalty)),
        classifications,
    };
}
function isAgentClaim(claim) {
    return claim.meta?.speakerType === "agent" || claim.meta?.speaker === "Agent" || claim.meta?.speaker === "AGENT";
}
