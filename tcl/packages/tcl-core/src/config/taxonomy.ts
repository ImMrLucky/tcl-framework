/**
 * Issue Taxonomy Configuration
 * 
 * Defines categories, subcategories, and their risk multipliers.
 * All category mappings must come from here - NO hard-coded categories.
 */

export interface CategoryDefinition {
  /** Display name */
  label: string;
  /** Risk multiplier (0-2, where 1.0 is baseline) */
  riskMultiplier: number;
  /** Subcategories */
  subcategories: Record<string, {
    label: string;
    riskMultiplier: number;
  }>;
}

export interface IssueTaxonomy {
  categories: Record<string, CategoryDefinition>;
  
  /** Severity thresholds (0-100) */
  severity: {
    low: number;      // 0 to this value
    medium: number;   // low to this value
    high: number;     // medium to this value
    critical: number; // high to 100
  };
  
  /** Confidence thresholds (0-1) */
  confidence: {
    low: number;
    medium: number;
    high: number;
  };
  
  /** Issue type definitions */
  issueTypes: {
    contradiction: string;
    ungrounded: string;
    unverified: string;
    circular: string;
    policyViolation: string;
    generic: string;
  };
}

export const DEFAULT_TAXONOMY: IssueTaxonomy = {
  categories: {
    BILLING: {
      label: "Billing",
      riskMultiplier: 1.5,
      subcategories: {
        cancellation: { label: "Cancellation Fees", riskMultiplier: 1.8 },
        refund: { label: "Refunds", riskMultiplier: 1.6 },
        charges: { label: "Charges", riskMultiplier: 1.4 },
        rates: { label: "Rates", riskMultiplier: 1.3 },
        payment: { label: "Payment Terms", riskMultiplier: 1.5 },
      },
    },
    DISCLOSURE: {
      label: "Disclosure",
      riskMultiplier: 1.8,
      subcategories: {
        terms: { label: "Terms & Conditions", riskMultiplier: 2.0 },
        fees: { label: "Fee Disclosure", riskMultiplier: 1.9 },
        cancellation: { label: "Cancellation Policy", riskMultiplier: 1.8 },
        privacy: { label: "Privacy Policy", riskMultiplier: 1.7 },
      },
    },
    MISREPRESENTATION: {
      label: "Misrepresentation",
      riskMultiplier: 2.0,
      subcategories: {
        product: { label: "Product Features", riskMultiplier: 2.0 },
        pricing: { label: "Pricing", riskMultiplier: 2.1 },
        availability: { label: "Availability", riskMultiplier: 1.9 },
        guarantees: { label: "Guarantees", riskMultiplier: 2.2 },
      },
    },
    PRIVACY: {
      label: "Privacy",
      riskMultiplier: 1.9,
      subcategories: {
        data: { label: "Data Handling", riskMultiplier: 2.0 },
        consent: { label: "Consent", riskMultiplier: 1.9 },
        sharing: { label: "Data Sharing", riskMultiplier: 2.1 },
      },
    },
    SECURITY: {
      label: "Security",
      riskMultiplier: 1.8,
      subcategories: {
        authentication: { label: "Authentication", riskMultiplier: 1.9 },
        access: { label: "Access Control", riskMultiplier: 1.8 },
        data: { label: "Data Security", riskMultiplier: 2.0 },
      },
    },
    PROCESS: {
      label: "Process",
      riskMultiplier: 1.2,
      subcategories: {
        escalation: { label: "Escalation", riskMultiplier: 1.3 },
        followup: { label: "Follow-up", riskMultiplier: 1.2 },
        documentation: { label: "Documentation", riskMultiplier: 1.1 },
      },
    },
    CUSTOMER_HARM: {
      label: "Customer Harm",
      riskMultiplier: 2.2,
      subcategories: {
        financial: { label: "Financial Impact", riskMultiplier: 2.3 },
        service: { label: "Service Disruption", riskMultiplier: 2.1 },
        emotional: { label: "Emotional Distress", riskMultiplier: 2.0 },
      },
    },
    REGULATORY: {
      label: "Regulatory",
      riskMultiplier: 2.5,
      subcategories: {
        compliance: { label: "Compliance Violation", riskMultiplier: 2.6 },
        reporting: { label: "Reporting Requirements", riskMultiplier: 2.4 },
        licensing: { label: "Licensing", riskMultiplier: 2.5 },
      },
    },
    PROMISE_BREACH: {
      label: "Promise Breach",
      riskMultiplier: 1.6,
      subcategories: {
        followup: { label: "Follow-up Promise", riskMultiplier: 1.7 },
        delivery: { label: "Delivery Promise", riskMultiplier: 1.6 },
        resolution: { label: "Resolution Promise", riskMultiplier: 1.8 },
      },
    },
    OTHER: {
      label: "Other",
      riskMultiplier: 1.0,
      subcategories: {
        general: { label: "General", riskMultiplier: 1.0 },
      },
    },
  },
  
  severity: {
    low: 30,
    medium: 60,
    high: 85,
    critical: 100,
  },
  
  confidence: {
    low: 0.4,
    medium: 0.7,
    high: 0.9,
  },
  
  issueTypes: {
    contradiction: "CONTRADICTION",
    ungrounded: "UNGROUNDED",
    unverified: "UNVERIFIED",
    circular: "CIRCULAR",
    policyViolation: "POLICY_VIOLATION",
    generic: "GENERIC",
  },
};

/**
 * Get taxonomy, allowing custom overrides.
 */
export function getTaxonomy(custom?: Partial<IssueTaxonomy>): IssueTaxonomy {
  if (!custom) {
    return DEFAULT_TAXONOMY;
  }
  
  return {
    categories: { ...DEFAULT_TAXONOMY.categories, ...custom.categories },
    severity: { ...DEFAULT_TAXONOMY.severity, ...custom.severity },
    confidence: { ...DEFAULT_TAXONOMY.confidence, ...custom.confidence },
    issueTypes: { ...DEFAULT_TAXONOMY.issueTypes, ...custom.issueTypes },
  };
}

/**
 * Map numeric risk score to severity label.
 */
export function getSeverity(riskScore: number, taxonomy: IssueTaxonomy = DEFAULT_TAXONOMY): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (riskScore >= taxonomy.severity.high) {
    return "CRITICAL";
  } else if (riskScore >= taxonomy.severity.medium) {
    return "HIGH";
  } else if (riskScore >= taxonomy.severity.low) {
    return "MEDIUM";
  } else {
    return "LOW";
  }
}

/**
 * Map numeric confidence to confidence label.
 */
export function getConfidence(confidenceScore: number, taxonomy: IssueTaxonomy = DEFAULT_TAXONOMY): "LOW" | "MEDIUM" | "HIGH" {
  if (confidenceScore >= taxonomy.confidence.high) {
    return "HIGH";
  } else if (confidenceScore >= taxonomy.confidence.medium) {
    return "MEDIUM";
  } else {
    return "LOW";
  }
}

/**
 * Get risk multiplier for a category/subcategory.
 */
export function getRiskMultiplier(
  category: string,
  subcategory?: string,
  taxonomy: IssueTaxonomy = DEFAULT_TAXONOMY
): number {
  const catDef = taxonomy.categories[category];
  if (!catDef) {
    return 1.0; // Default multiplier
  }
  
  if (subcategory && catDef.subcategories[subcategory]) {
    return catDef.subcategories[subcategory].riskMultiplier;
  }
  
  return catDef.riskMultiplier;
}

