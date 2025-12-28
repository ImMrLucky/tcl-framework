/**
 * Generate actionable suggestions for fixing validation issues
 * Decoupled from specific use cases - works for any domain
 */

import type { Claim, Violation, ContradictionEdge, Suggestion, CustomRule } from "./types.js";

export function generateSuggestions(
  claims: Claim[],
  violations: Violation[],
  contradictions: { claimA: string; claimB: string; reason: string }[],
  missingEvidence: { claimId: string; reason: string }[],
  supports: ContradictionEdge[],
  customRules?: CustomRule[]
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const claimMap = new Map(claims.map(c => [c.id, c]));

  // 1. Fix contradictions
  contradictions.forEach(cont => {
    const claimA = claimMap.get(cont.claimA);
    const claimB = claimMap.get(cont.claimB);
    
    if (claimA && claimB) {
      suggestions.push({
        type: 'fix_contradiction',
        claimIds: [cont.claimA, cont.claimB],
        priority: 'high',
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
      suggestions.push({
        type: 'add_evidence',
        claimId: missing.claimId,
        priority: claim.confidence < 0.5 ? 'high' : 'medium',
        title: 'Add Supporting Evidence',
        description: `Claim "${claim.text.substring(0, 60)}..." lacks supporting evidence.`,
        suggestedAction: `Provide a source, citation, or reference that supports this claim.`,
        example: `Add a source like: "According to [source], [claim]"`
      });
    }
  });

  // 3. Improve consistency (for claims with many contradictions)
  const contradictionCounts = new Map<string, number>();
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

