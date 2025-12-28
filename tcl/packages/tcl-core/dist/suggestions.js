/**
 * Generate actionable suggestions for fixing validation issues
 * Decoupled from specific use cases - works for any domain
 */
export function generateSuggestions(claims, violations, contradictions, missingEvidence, supports, customRules, importanceByClaimId, grounding) {
    const suggestions = [];
    const claimMap = new Map(claims.map(c => [c.id, c]));
    // Helper to determine priority based on importance
    const getPriority = (claimId) => {
        if (!importanceByClaimId)
            return 'high';
        const importance = importanceByClaimId.get(claimId) ?? 0;
        if (importance > 0.75)
            return 'high';
        if (importance > 0.4)
            return 'medium';
        return 'low';
    };
    // 1. Fix contradictions
    contradictions.forEach(cont => {
        const claimA = claimMap.get(cont.claimA);
        const claimB = claimMap.get(cont.claimB);
        if (claimA && claimB) {
            const priorityA = getPriority(cont.claimA);
            const priorityB = getPriority(cont.claimB);
            const priority = priorityA === 'high' || priorityB === 'high' ? 'high' :
                priorityA === 'medium' || priorityB === 'medium' ? 'medium' : 'low';
            suggestions.push({
                type: 'fix_contradiction',
                claimIds: [cont.claimA, cont.claimB],
                priority,
                title: 'Resolve Contradiction',
                description: `These claims contradict each other: "${claimA.text.substring(0, 60)}..." and "${claimB.text.substring(0, 60)}..."`,
                suggestedAction: `Review and reconcile these statements. One may need to be corrected or clarified.`,
                example: `If one claim says "X is true" and another says "X is false", determine which is correct and update accordingly.`
            });
        }
    });
    // 2. Add evidence for ungrounded claims
    missingEvidence.forEach(missing => {
        const claim = claimMap.get(missing.claimId);
        if (claim) {
            // Find best grounding quote if available
            let bestQuote;
            if (grounding) {
                const claimGrounding = grounding.filter(g => g.claimId === missing.claimId);
                if (claimGrounding.length > 0) {
                    const best = claimGrounding.reduce((max, g) => g.weight > max.weight ? g : max);
                    bestQuote = best.quote;
                }
            }
            const priority = getPriority(missing.claimId);
            const description = bestQuote
                ? `Claim "${claim.text.substring(0, 60)}..." lacks supporting evidence. Related quote: "${bestQuote.substring(0, 80)}..."`
                : `Claim "${claim.text.substring(0, 60)}..." lacks supporting evidence.`;
            suggestions.push({
                type: 'add_evidence',
                claimId: missing.claimId,
                priority,
                title: 'Add Supporting Evidence',
                description,
                suggestedAction: `Provide a source, citation, or reference that supports this claim.`,
                example: bestQuote
                    ? `Use evidence like: "${bestQuote.substring(0, 100)}..."`
                    : `Add a source like: "According to [source], [claim]"`
            });
        }
    });
    // 3. Improve consistency (for claims with many contradictions)
    const contradictionCounts = new Map();
    contradictions.forEach(cont => {
        contradictionCounts.set(cont.claimA, (contradictionCounts.get(cont.claimA) || 0) + 1);
        contradictionCounts.set(cont.claimB, (contradictionCounts.get(cont.claimB) || 0) + 1);
    });
    contradictionCounts.forEach((count, claimId) => {
        if (count >= 2) {
            const claim = claimMap.get(claimId);
            if (claim) {
                suggestions.push({
                    type: 'improve_consistency',
                    claimId: claimId,
                    priority: 'high',
                    title: 'Improve Claim Consistency',
                    description: `This claim contradicts ${count} other claims: "${claim.text.substring(0, 60)}..."`,
                    suggestedAction: `Review this claim carefully. It may need to be reworded, qualified, or removed to improve overall consistency.`,
                    example: `Consider adding qualifiers like "in some cases" or "typically" to make the claim more nuanced.`
                });
            }
        }
    });
    // 4. Custom rule violations
    violations.forEach(violation => {
        if (violation.type === 'CUSTOM_RULE') {
            const claim = violation.claimId ? claimMap.get(violation.claimId) : null;
            suggestions.push({
                type: 'custom_rule',
                claimId: violation.claimId,
                priority: 'medium',
                title: `Custom Rule Violation: ${violation.ruleId}`,
                description: violation.detail,
                suggestedAction: `Review the custom rule requirements and adjust the content accordingly.`,
                example: claim ? `Claim "${claim.text.substring(0, 60)}..." violates the rule.` : undefined
            });
        }
    });
    // Sort by priority (high first)
    return suggestions.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
}
