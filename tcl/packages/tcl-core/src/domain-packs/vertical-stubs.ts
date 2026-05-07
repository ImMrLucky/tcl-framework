/**
 * Placeholder vertical packs — extend with carrier-specific patterns over time.
 * Registered for future SaaS/support/health/finance workflows without weakening ProtectQA defaults.
 */
import type { DomainPack } from "./types.js";

export const customerSupportPack: DomainPack = {
  id: "customer_support",
  name: "Customer support",
  domain: "customer_support",
  version: "0.1.0",
  description: "Support refund/escalation/shipment guardrails.",
  appliesToRoles: ["agent", "supervisor", "bot"],
  templates: ["support", "customer_support"],
  rules: [
    {
      type: "HUMAN_UNSUPPORTED_CLAIM",
      severity: "high",
      patterns: [/refund guaranteed outside policy/i, /i already submitted your refund/i],
      summary: "Unsupported refund or resolution claim",
      detail:
        "Refunds and account actions must match policy and tooling. Claiming outcomes without CRM or policy evidence raises dispute risk.",
      saferVersion:
        "I’ll check your account and confirm what policy allows before promising a refund timeline.",
      tags: ["support", "refund"],
    },
  ],
  requiredDisclosures: [],
  forbiddenPhrases: [],
};

export const saasSalesPack: DomainPack = {
  id: "saas_sales",
  name: "SaaS sales",
  domain: "saas_sales",
  version: "0.1.0",
  description: "B2B SaaS security/integration overclaim guardrails.",
  appliesToRoles: ["agent", "supervisor"],
  templates: ["saas", "saas_sales"],
  rules: [
    {
      type: "HUMAN_PRODUCT_OVERCLAIM",
      severity: "high",
      patterns: [
        /\bwe (?:have|offer) full (?:SOC|HIPAA)\s*(?:certified|approval)\b/i,
        /\blogs into (?:everything|every system)\s*automatically\b/i,
      ],
      summary: "Unverified certification or integration claim",
      detail: "Security certifications and integrations require product evidence and legal review.",
      saferVersion:
        "I can confirm which certifications and integrations apply to our contract tier from our official documentation.",
      tags: ["saas", "integrations", "security"],
    },
  ],
  requiredDisclosures: [],
  forbiddenPhrases: [],
};

export const healthcareIntakePack: DomainPack = {
  id: "healthcare",
  name: "Healthcare intake",
  domain: "healthcare",
  version: "0.1.0",
  description: "Medical/disclaimer boundaries for intake conversations.",
  appliesToRoles: ["agent", "supervisor", "bot"],
  templates: ["healthcare", "intake"],
  rules: [
    {
      type: "AI_UNSAFE_RECOMMENDATION",
      severity: "critical",
      patterns: [/you(?:'re| are) diagnosed with/i, /take this dosage/i, /stop taking your medication/i],
      summary: "Unsafe medical certainty or dosing instruction",
      detail: "Only licensed clinicians may diagnose or prescribe changes; scripted disclaimers apply.",
      saferVersion:
        "I’m not qualified to diagnose. Please speak with your clinician before changing treatment.",
      tags: ["healthcare", "medical"],
    },
  ],
  requiredDisclosures: [],
  forbiddenPhrases: [],
};

export const financialServicesPack: DomainPack = {
  id: "financial_services",
  name: "Financial services",
  domain: "financial_services",
  version: "0.1.0",
  description: "Baselines for certainty language on returns and suitability.",
  appliesToRoles: ["agent", "supervisor", "bot"],
  templates: ["finance", "lending"],
  rules: [
    {
      type: "HUMAN_MISLEADING_CLAIM",
      severity: "high",
      patterns: [/guaranteed return/i, /\b(can't|cannot) lose (?:money|principal)\b/i],
      summary: "Misleading certainty on investment or loan outcome",
      detail: "Guaranteed-return language triggers regulatory scrutiny without prospectus/disclosure backing.",
      saferVersion:
        "Returns and outcomes depend on product terms and market conditions disclosed in offering materials.",
      tags: ["finance", "suitability"],
    },
  ],
  requiredDisclosures: [],
  forbiddenPhrases: [],
};
