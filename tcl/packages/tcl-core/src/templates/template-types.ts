/**
 * Industry / product templates (ProtectQA, healthcare, etc.) — separate from graph slot templates.
 */

export interface IndustryTemplateDefinition {
  id: string;
  name: string;
  industry: string;
  description: string;
  /** Graph builder template id (generic, final_expense, ai_chat, …) */
  graphTemplateId: string;
  /** Domain packs merged into this run (first is primary for labeling) */
  additionalDomainPackIds: string[];
  riskCategories: string[];
  requiredDisclosures: string[];
  forbiddenClaims: string[];
  riskyPhrases: string[];
  claimTypesToWatch: string[];
  evidenceRequirements: string[];
  /** Relative weights for composite explanation (sum need not be 1; used for rationale only) */
  scoringWeights: Record<string, number>;
}
