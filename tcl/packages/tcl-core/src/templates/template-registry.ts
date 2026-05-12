import type { IndustryTemplateDefinition } from "./template-types.js";

const REG = new Map<string, IndustryTemplateDefinition>();

function T(def: IndustryTemplateDefinition): IndustryTemplateDefinition {
  REG.set(def.id, def);
  return def;
}

T({
  id: "general_conversation_integrity",
  name: "General Conversation Integrity",
  industry: "general",
  description: "Default TCL lens: contradictions, drift, unsupported claims, and completion integrity without vertical-specific compliance rules.",
  graphTemplateId: "generic",
  additionalDomainPackIds: ["general_conversation_integrity"],
  riskCategories: ["consistency", "truthfulness", "task_completion", "speaker_attribution"],
  requiredDisclosures: [],
  forbiddenClaims: [],
  riskyPhrases: [],
  claimTypesToWatch: ["FACTUAL", "COMMITMENT", "TASK_COMPLETION", "POLICY", "PRICING", "ADVICE"],
  evidenceRequirements: ["transcript_anchor", "policy_or_kb_when_claiming_terms"],
  scoringWeights: { integrity: 0.35, evidence: 0.25, contradiction: 0.2, drift: 0.1, compliance: 0.1 },
});

T({
  id: "final_expense",
  name: "Insurance / Final Expense",
  industry: "insurance",
  description: "Final expense and simplified-issue products: approval language, waiting periods, disclosures, and health/eligibility claims.",
  graphTemplateId: "final_expense",
  additionalDomainPackIds: ["general_conversation_integrity", "protectqa_final_expense"],
  riskCategories: ["guarantees", "underwriting", "disclosures", "health_eligibility", "premium_coverage"],
  requiredDisclosures: ["carrier_approval", "waiting_period", "policy_terms"],
  forbiddenClaims: ["guaranteed_approval", "no_denial", "day_one_full_benefit_everyone"],
  riskyPhrases: ["guaranteed approval", "no risk of denial", "everyone qualifies"],
  claimTypesToWatch: ["POLICY", "PRICING", "COMMITMENT", "FACTUAL"],
  evidenceRequirements: ["carrier_underwriting", "product_spec", "application_status"],
  scoringWeights: { compliance: 0.35, integrity: 0.2, evidence: 0.2, contradiction: 0.15, drift: 0.1 },
});

T({
  id: "healthcare_intake",
  name: "Healthcare Intake",
  industry: "healthcare",
  description: "Triage and intake: diagnosis-like language, emergency advice, medications, PHI handling, escalation.",
  graphTemplateId: "generic",
  additionalDomainPackIds: ["general_conversation_integrity", "healthcare"],
  riskCategories: ["clinical_assertion", "emergency", "medication", "phi", "escalation"],
  requiredDisclosures: ["not_medical_advice", "emergency_disclaimer"],
  forbiddenClaims: ["definitive_diagnosis", "prescription_without_clinician"],
  riskyPhrases: ["you have", "you should stop taking", "no need to see a doctor"],
  claimTypesToWatch: ["ADVICE", "FACTUAL", "COMMITMENT", "POLICY"],
  evidenceRequirements: ["clinical_protocol", "escalation_path"],
  scoringWeights: { compliance: 0.4, integrity: 0.2, evidence: 0.2, contradiction: 0.1, drift: 0.1 },
});

T({
  id: "financial_services",
  name: "Financial Services",
  industry: "finance",
  description: "Suitability, guarantees, fee and risk disclosures, investment advice boundaries.",
  graphTemplateId: "loans",
  additionalDomainPackIds: ["general_conversation_integrity", "financial_services"],
  riskCategories: ["guaranteed_return", "suitability", "fees", "risk_disclosure"],
  requiredDisclosures: ["risk_disclosure", "past_performance"],
  forbiddenClaims: ["guaranteed_return", "insured_principal_unless_true"],
  riskyPhrases: ["guaranteed", "can’t lose", "risk-free"],
  claimTypesToWatch: ["PRICING", "FACTUAL", "COMMITMENT", "ADVICE"],
  evidenceRequirements: ["prospectus", "reg_bi_disclosure"],
  scoringWeights: { compliance: 0.35, integrity: 0.25, evidence: 0.2, contradiction: 0.1, drift: 0.1 },
});

T({
  id: "legal_intake",
  name: "Legal Intake",
  industry: "legal",
  description: "Information vs advice, relationship disclaimers, deadlines and jurisdiction claims.",
  graphTemplateId: "generic",
  additionalDomainPackIds: ["general_conversation_integrity"],
  riskCategories: ["legal_advice", "relationship", "deadline", "jurisdiction"],
  requiredDisclosures: ["not_attorney_client", "information_only"],
  forbiddenClaims: ["attorney_client_relationship_formed"],
  riskyPhrases: ["I am your lawyer", "attorney-client privilege applies now"],
  claimTypesToWatch: ["ADVICE", "COMMITMENT", "FACTUAL"],
  evidenceRequirements: ["retainer", "conflict_check"],
  scoringWeights: { compliance: 0.4, integrity: 0.25, evidence: 0.15, contradiction: 0.1, drift: 0.1 },
});

T({
  id: "customer_support",
  name: "Customer Support / SaaS",
  industry: "saas",
  description: "Refunds, SLAs, security/account claims, feature promises, escalation integrity.",
  graphTemplateId: "generic",
  additionalDomainPackIds: ["general_conversation_integrity", "customer_support"],
  riskCategories: ["refund_policy", "sla", "security", "feature_promise", "escalation"],
  requiredDisclosures: [],
  forbiddenClaims: [],
  riskyPhrases: ["full refund guaranteed", "we will never lose your data"],
  claimTypesToWatch: ["TASK_COMPLETION", "COMMITMENT", "POLICY", "FACTUAL"],
  evidenceRequirements: ["kb_article", "ticket_system_state"],
  scoringWeights: { integrity: 0.3, evidence: 0.25, contradiction: 0.2, drift: 0.15, compliance: 0.1 },
});

T({
  id: "ai_agent_qa",
  name: "AI Voice / Chat Agent QA",
  industry: "ai",
  description: "Hallucination, tool-result alignment, false completion, unsupported policy claims, escalation.",
  graphTemplateId: "ai_chat",
  additionalDomainPackIds: ["general_conversation_integrity", "ai_chatbot"],
  riskCategories: ["hallucination", "tool_fabrication", "false_completion", "policy_claim", "escalation"],
  requiredDisclosures: [],
  forbiddenClaims: [],
  riskyPhrases: ["I ran the tool", "the API returned"],
  claimTypesToWatch: ["FACTUAL", "TASK_COMPLETION", "POLICY", "COMMITMENT"],
  evidenceRequirements: ["tool_log", "kb_citation"],
  scoringWeights: { integrity: 0.25, evidence: 0.2, contradiction: 0.15, drift: 0.15, compliance: 0.25 },
});

T({
  id: "insurance_sales",
  name: "Insurance Sales (General)",
  industry: "insurance",
  description: "Broader insurance sales integrity beyond final expense (still use final_expense pack for FE-specific rules).",
  graphTemplateId: "final_expense",
  additionalDomainPackIds: ["general_conversation_integrity", "protectqa_final_expense"],
  riskCategories: ["product_fit", "disclosure", "eligibility"],
  requiredDisclosures: [],
  forbiddenClaims: [],
  riskyPhrases: [],
  claimTypesToWatch: ["POLICY", "PRICING", "COMMITMENT"],
  evidenceRequirements: ["carrier_docs"],
  scoringWeights: { compliance: 0.35, integrity: 0.2, evidence: 0.2, contradiction: 0.15, drift: 0.1 },
});

export function getIndustryTemplate(id: string | undefined): IndustryTemplateDefinition {
  if (id && REG.has(id)) return REG.get(id)!;
  return REG.get("general_conversation_integrity")!;
}

export function listIndustryTemplates(): IndustryTemplateDefinition[] {
  return Array.from(REG.values());
}
