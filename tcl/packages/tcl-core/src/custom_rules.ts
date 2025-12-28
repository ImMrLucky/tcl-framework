/**
 * Custom rule validation engine
 * Allows domain-specific validation rules (call center, legal, medical, etc.)
 * Decoupled from specific implementations - works for any domain
 */

import type { Claim, Violation, CustomRule, ValidateInput } from "./types.js";

/**
 * Validate claims against custom rules
 */
export function validateCustomRules(
  claims: Claim[],
  input: ValidateInput,
  customRules: CustomRule[]
): Violation[] {
  const violations: Violation[] = [];

  if (!customRules || customRules.length === 0) {
    return violations;
  }

  customRules.forEach(rule => {
    if (rule.scope === 'claim') {
      // Validate each claim against the rule
      claims.forEach(claim => {
        const violation = validateClaimAgainstRule(claim, rule, input);
        if (violation) {
          violations.push(violation);
        }
      });
    } else if (rule.scope === 'document') {
      // Validate the entire document (question + answer)
      const violation = validateDocumentAgainstRule(input, rule);
      if (violation) {
        violations.push(violation);
      }
    }
  });

  return violations;
}

function validateClaimAgainstRule(
  claim: Claim,
  rule: CustomRule,
  input: ValidateInput
): Violation | null {
  // Pattern-based rules
  if (rule.pattern) {
    const text = claim.text.toLowerCase();
    const patternValue = rule.pattern.caseSensitive ? rule.pattern.value : rule.pattern.value.toLowerCase();

    let matches = false;
    if (rule.pattern.type === 'contains') {
      matches = text.includes(patternValue);
    } else if (rule.pattern.type === 'regex') {
      try {
        const regex = new RegExp(patternValue, rule.pattern.caseSensitive ? '' : 'i');
        matches = regex.test(claim.text);
      } catch (e) {
        console.warn(`Invalid regex pattern in rule ${rule.id}: ${patternValue}`);
        return null;
      }
    }

    // Check if this is a "must contain" or "must not contain" rule
    // For now, we'll assume pattern rules are "must contain" - can be extended
    if (!matches && rule.severity === 'error') {
      return {
        type: 'CUSTOM_RULE',
        claimId: claim.id,
        ruleId: rule.id,
        detail: rule.description || `Claim violates rule: ${rule.name}`
      };
    }
  }

  // Semantic rules would require NLI scoring - can be added later
  // For now, we support pattern-based rules

  return null;
}

function validateDocumentAgainstRule(
  input: ValidateInput,
  rule: CustomRule
): Violation | null {
  const documentText = `${input.question} ${input.answer}`.toLowerCase();

  if (rule.pattern) {
    const patternValue = rule.pattern.caseSensitive ? rule.pattern.value : rule.pattern.value.toLowerCase();
    let matches = false;

    if (rule.pattern.type === 'contains') {
      matches = documentText.includes(patternValue);
    } else if (rule.pattern.type === 'regex') {
      try {
        const regex = new RegExp(patternValue, rule.pattern.caseSensitive ? '' : 'i');
        matches = regex.test(`${input.question} ${input.answer}`);
      } catch (e) {
        console.warn(`Invalid regex pattern in rule ${rule.id}: ${patternValue}`);
        return null;
      }
    }

    if (!matches && rule.severity === 'error') {
      return {
        type: 'CUSTOM_RULE',
        ruleId: rule.id,
        detail: rule.description || `Document violates rule: ${rule.name}`
      };
    }
  }

  return null;
}

/**
 * Example rule sets for common domains
 * These are examples - customers can define their own
 */
export const ExampleRuleSets = {
  callCenter: [
    {
      id: 'cc-1',
      name: 'Refund Authorization',
      description: 'Agent must mention manager approval for refunds over $100',
      pattern: {
        type: 'contains' as const,
        value: 'refund',
        caseSensitive: false
      },
      scope: 'document' as const,
      severity: 'error' as const,
      suggestion: 'Ensure refund mentions include authorization details for amounts over $100'
    },
    {
      id: 'cc-2',
      name: 'Policy Consistency',
      description: 'Agent should not contradict company policy',
      pattern: {
        type: 'regex' as const,
        value: 'policy|procedure|guideline',
        caseSensitive: false
      },
      scope: 'claim' as const,
      severity: 'warning' as const
    }
  ],
  legal: [
    {
      id: 'legal-1',
      name: 'Disclaimer Required',
      description: 'Legal advice must include disclaimer',
      pattern: {
        type: 'contains' as const,
        value: 'not legal advice|consult an attorney|disclaimer',
        caseSensitive: false
      },
      scope: 'document' as const,
      severity: 'error' as const
    }
  ],
  medical: [
    {
      id: 'med-1',
      name: 'Emergency Warning',
      description: 'Medical advice must include emergency warning',
      pattern: {
        type: 'contains' as const,
        value: 'emergency|seek immediate|call 911',
        caseSensitive: false
      },
      scope: 'document' as const,
      severity: 'error' as const
    }
  ]
};

