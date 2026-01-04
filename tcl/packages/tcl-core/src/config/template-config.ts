/**
 * TEMPLATE CONFIGURATION SYSTEM
 * 
 * This module provides the TemplateConfig system that drives all graph construction.
 * 
 * INVARIANTS:
 * - All numeric values are configurable - no magic numbers in code
 * - Templates are domain-specific but the engine is universal
 * - Config must be serializable for reproducibility
 */

import type { TemplateConfig, CandidateBudgets, EvidenceKind } from "../graph/types.js";

// ============================================================================
// DEFAULT BUDGETS
// ============================================================================

export const DEFAULT_CANDIDATE_BUDGETS: CandidateBudgets = {
  perClaim: {
    contradictionPairs: 20,
    supportClaimPairs: 15,
    supportEvidencePairs: 10,
    groundingPairs: 5,
  },
  global: {
    maxPairsTotal: 5000, // Safety cap only
  },
};

// ============================================================================
// DEFAULT THRESHOLDS
// ============================================================================

export const DEFAULT_THRESHOLDS = {
  support: 0.65,
  contradiction: 0.70,
  grounding: 0.60,
} as const;

// ============================================================================
// DEFAULT WEIGHTS
// ============================================================================

export const DEFAULT_WEIGHTS = {
  retrieval: {
    slotMatch: 0.4,
    entityOverlap: 0.25,
    semanticSimilarity: 0.2,
    temporalProximity: 0.1,
    speakerConstraint: 0.05,
  },
  calibration: {
    nliScore: 0.5,
    slotMatchBonus: 0.2,
    polarityMatch: 0.15,
    entityStrength: 0.1,
    modalityFactor: 0.05,
  },
  evidenceStrength: {
    policy: 1.0,
    system_fact: 0.95,
    document: 0.85,
    kb: 0.75,
    tool_log: 0.70,
    transcript: 0.30,
  } as Record<EvidenceKind, number>,
};

// ============================================================================
// DEFAULT GATING
// ============================================================================

export const DEFAULT_GATING = {
  allowCrossTopicSupportOnlyOnStrictSlotMatch: true,
  contradictionRequiresSameTopic: true,
  requirePolarityOpposition: true,
  minTopicOverlapForContradiction: 0.3,
};

// ============================================================================
// GENERIC TEMPLATE (Universal baseline)
// ============================================================================

export const GENERIC_TEMPLATE: TemplateConfig = {
  templateId: "generic",
  entityPacks: ["base"],
  slotLexicon: {
    // Fees & Charges
    "fee": { slotType: "fee", entityKey: "fee_generic", synonyms: ["charge", "cost", "expense"] },
    "late fee": { slotType: "fee", entityKey: "late_fee", synonyms: ["late charge", "late payment fee"] },
    "setup fee": { slotType: "fee", entityKey: "setup_fee", synonyms: ["activation fee", "installation fee"] },
    "cancellation fee": { slotType: "fee", entityKey: "cancellation_fee", synonyms: ["termination fee", "early termination"] },
    
    // Payments
    "payment": { slotType: "payment", entityKey: "payment_generic", synonyms: ["pay", "remittance"] },
    "due date": { slotType: "payment", entityKey: "due_date", synonyms: ["payment date", "due by"] },
    "balance": { slotType: "payment", entityKey: "balance", synonyms: ["amount owed", "outstanding"] },
    
    // Plans & Products
    "plan": { slotType: "plan", entityKey: "plan_generic", synonyms: ["package", "bundle", "tier"] },
    "subscription": { slotType: "plan", entityKey: "subscription", synonyms: ["recurring service"] },
    
    // Terms & Contracts
    "contract": { slotType: "contract_term", entityKey: "contract_generic", synonyms: ["agreement", "terms"] },
    "term": { slotType: "contract_term", entityKey: "term_length", synonyms: ["duration", "period"] },
    
    // Promotions
    "promo": { slotType: "promo", entityKey: "promo_generic", synonyms: ["promotion", "discount", "offer"] },
    "credit": { slotType: "promo", entityKey: "credit", synonyms: ["account credit", "bill credit"] },
    
    // Refunds
    "refund": { slotType: "refund", entityKey: "refund_generic", synonyms: ["reimbursement", "money back"] },
    
    // Policies
    "policy": { slotType: "policy", entityKey: "policy_generic", synonyms: ["rule", "regulation", "guideline"] },
  },
  budgets: DEFAULT_CANDIDATE_BUDGETS,
  thresholds: DEFAULT_THRESHOLDS,
  weights: DEFAULT_WEIGHTS,
  gating: DEFAULT_GATING,
};

// ============================================================================
// TELCO TEMPLATE (Call center / telecommunications)
// ============================================================================

export const TELCO_TEMPLATE: TemplateConfig = {
  templateId: "telco",
  entityPacks: ["base", "telco"],
  slotLexicon: {
    ...GENERIC_TEMPLATE.slotLexicon,
    
    // Telco-specific fees
    "router fee": { slotType: "fee", entityKey: "router_fee", synonyms: ["equipment fee", "modem fee", "device fee"] },
    "service fee": { slotType: "fee", entityKey: "service_fee", synonyms: ["service charge", "monthly service"] },
    "data overage": { slotType: "fee", entityKey: "data_overage", synonyms: ["overage charge", "extra data"] },
    "roaming fee": { slotType: "fee", entityKey: "roaming_fee", synonyms: ["international charge"] },
    
    // Telco plans
    "streaming": { slotType: "addon", entityKey: "streaming_addon", synonyms: ["streaming service", "streaming plus"] },
    "data plan": { slotType: "plan", entityKey: "data_plan", synonyms: ["data package"] },
    "unlimited": { slotType: "plan", entityKey: "unlimited_plan", synonyms: ["unlimited data", "all-you-can-use"] },
    
    // Telco promotions
    "price lock": { slotType: "promo", entityKey: "price_lock", synonyms: ["rate lock", "price guarantee"] },
    "loyalty discount": { slotType: "promo", entityKey: "loyalty_discount", synonyms: ["tenure discount"] },
    
    // Telco actions
    "upgrade": { slotType: "action", entityKey: "plan_upgrade", synonyms: ["plan change", "service upgrade"] },
    "downgrade": { slotType: "action", entityKey: "plan_downgrade", synonyms: ["plan reduction"] },
    "port": { slotType: "action", entityKey: "number_port", synonyms: ["number transfer", "porting"] },
  },
  budgets: DEFAULT_CANDIDATE_BUDGETS,
  thresholds: DEFAULT_THRESHOLDS,
  weights: DEFAULT_WEIGHTS,
  gating: DEFAULT_GATING,
};

// ============================================================================
// LOANS TEMPLATE (Commercial lending)
// ============================================================================

export const LOANS_TEMPLATE: TemplateConfig = {
  templateId: "loans",
  entityPacks: ["base", "finance"],
  slotLexicon: {
    ...GENERIC_TEMPLATE.slotLexicon,
    
    // Loan metrics
    "dscr": { slotType: "metric", entityKey: "dscr", synonyms: ["debt service coverage", "coverage ratio"] },
    "ltv": { slotType: "metric", entityKey: "ltv", synonyms: ["loan to value", "loan-to-value ratio"] },
    "debt yield": { slotType: "metric", entityKey: "debt_yield", synonyms: ["yield"] },
    
    // Loan terms
    "interest rate": { slotType: "rate", entityKey: "interest_rate", synonyms: ["rate", "apr", "annual rate"] },
    "amortization": { slotType: "term", entityKey: "amortization", synonyms: ["amort", "payback period"] },
    "maturity": { slotType: "term", entityKey: "maturity_date", synonyms: ["term end", "loan maturity"] },
    
    // Loan types
    "bridge loan": { slotType: "product", entityKey: "bridge_loan", synonyms: ["bridge", "short-term loan"] },
    "construction loan": { slotType: "product", entityKey: "construction_loan", synonyms: ["construction financing"] },
    "permanent loan": { slotType: "product", entityKey: "permanent_loan", synonyms: ["perm loan", "takeout"] },
    
    // Loan actions
    "approval": { slotType: "action", entityKey: "loan_approval", synonyms: ["approved", "underwriting approval"] },
    "counteroffer": { slotType: "action", entityKey: "counteroffer", synonyms: ["counter", "revised terms"] },
    "disclosure": { slotType: "action", entityKey: "disclosure", synonyms: ["disclosed", "disclosure sent"] },
    
    // Collateral
    "collateral": { slotType: "collateral", entityKey: "collateral_generic", synonyms: ["security", "pledged asset"] },
    "property": { slotType: "collateral", entityKey: "property", synonyms: ["real estate", "building", "asset"] },
    
    // Covenants
    "covenant": { slotType: "covenant", entityKey: "covenant_generic", synonyms: ["loan covenant", "requirement"] },
    "prepayment": { slotType: "covenant", entityKey: "prepayment", synonyms: ["early payoff", "prepay"] },
  },
  budgets: DEFAULT_CANDIDATE_BUDGETS,
  thresholds: {
    support: 0.70,      // Higher for financial accuracy
    contradiction: 0.75, // Higher to avoid false contradictions
    grounding: 0.65,
  },
  weights: DEFAULT_WEIGHTS,
  gating: {
    ...DEFAULT_GATING,
    minTopicOverlapForContradiction: 0.4, // Stricter for financial domain
  },
};

// ============================================================================
// AI CHAT TEMPLATE (AI assistant conversations)
// ============================================================================

export const AI_CHAT_TEMPLATE: TemplateConfig = {
  templateId: "ai_chat",
  entityPacks: ["base", "ai_actions"],
  slotLexicon: {
    ...GENERIC_TEMPLATE.slotLexicon,
    
    // AI actions
    "escalate": { slotType: "action", entityKey: "escalation", synonyms: ["escalated", "hand off", "transfer to human"] },
    "ticket": { slotType: "action", entityKey: "ticket_created", synonyms: ["created ticket", "opened case"] },
    "tool call": { slotType: "action", entityKey: "tool_invocation", synonyms: ["called tool", "function call"] },
    
    // AI claims
    "capability": { slotType: "capability", entityKey: "capability_claim", synonyms: ["can do", "able to"] },
    "limitation": { slotType: "capability", entityKey: "limitation", synonyms: ["cannot", "unable to", "not possible"] },
    
    // Hallucination indicators
    "source": { slotType: "source", entityKey: "source_claim", synonyms: ["according to", "based on"] },
    "certainty": { slotType: "certainty", entityKey: "certainty_level", synonyms: ["confident", "sure", "uncertain"] },
  },
  budgets: DEFAULT_CANDIDATE_BUDGETS,
  thresholds: DEFAULT_THRESHOLDS,
  weights: DEFAULT_WEIGHTS,
  gating: DEFAULT_GATING,
};

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================

const TEMPLATE_REGISTRY: Record<string, TemplateConfig> = {
  generic: GENERIC_TEMPLATE,
  telco: TELCO_TEMPLATE,
  loans: LOANS_TEMPLATE,
  ai_chat: AI_CHAT_TEMPLATE,
};

/**
 * Get a template configuration by ID.
 * Falls back to generic template if not found.
 */
export function getTemplateConfig(templateId: string): TemplateConfig {
  return TEMPLATE_REGISTRY[templateId] ?? GENERIC_TEMPLATE;
}

/**
 * Register a custom template configuration.
 */
export function registerTemplate(config: TemplateConfig): void {
  TEMPLATE_REGISTRY[config.templateId] = config;
}

/**
 * List all available template IDs.
 */
export function listTemplates(): string[] {
  return Object.keys(TEMPLATE_REGISTRY);
}

/**
 * Merge partial config with a base template.
 * Useful for runtime overrides.
 */
export function mergeTemplateConfig(
  base: TemplateConfig,
  overrides: Partial<TemplateConfig>
): TemplateConfig {
  return {
    ...base,
    ...overrides,
    slotLexicon: { ...base.slotLexicon, ...overrides.slotLexicon },
    budgets: {
      perClaim: { ...base.budgets.perClaim, ...overrides.budgets?.perClaim },
      global: { ...base.budgets.global, ...overrides.budgets?.global },
    },
    thresholds: { ...base.thresholds, ...overrides.thresholds },
    weights: {
      retrieval: { ...base.weights.retrieval, ...overrides.weights?.retrieval },
      calibration: { ...base.weights.calibration, ...overrides.weights?.calibration },
      evidenceStrength: { ...base.weights.evidenceStrength, ...overrides.weights?.evidenceStrength },
    },
    gating: { ...base.gating, ...overrides.gating },
  };
}

/**
 * Validate a template configuration.
 * Returns list of validation errors (empty if valid).
 */
export function validateTemplateConfig(config: TemplateConfig): string[] {
  const errors: string[] = [];
  
  // Check required fields
  if (!config.templateId) {
    errors.push("templateId is required");
  }
  
  // Check thresholds are in valid range
  for (const [key, value] of Object.entries(config.thresholds)) {
    if (value < 0 || value > 1) {
      errors.push(`thresholds.${key} must be between 0 and 1, got ${value}`);
    }
  }
  
  // Check budgets are positive
  for (const [key, value] of Object.entries(config.budgets.perClaim)) {
    if (value < 1) {
      errors.push(`budgets.perClaim.${key} must be at least 1, got ${value}`);
    }
  }
  
  // Check gating threshold
  if (config.gating.minTopicOverlapForContradiction < 0 || 
      config.gating.minTopicOverlapForContradiction > 1) {
    errors.push("gating.minTopicOverlapForContradiction must be between 0 and 1");
  }
  
  return errors;
}

/**
 * Serialize template config for reproducibility hashing.
 */
export function serializeTemplateConfig(config: TemplateConfig): string {
  return JSON.stringify(config, Object.keys(config).sort());
}

