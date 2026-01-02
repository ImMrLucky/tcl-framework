/**
 * Risk Model Configuration
 * 
 * ALL thresholds, weights, escalation rules, and category mappings live here.
 * NO values should be hard-coded in the scoring/clustering code.
 * 
 * This file is versioned and its hash is included in reproducibility metadata.
 */

import { createHash } from "crypto";
import type { IssueCategory, IssueSeverity, IssueConfidence } from "../issues/types.js";

// ============================================================================
// CATEGORY WEIGHTS
// ============================================================================

export interface CategoryWeights {
  /** Base weight for each category (multiplies into risk score) */
  [key: string]: number;
}

// ============================================================================
// SEVERITY THRESHOLDS
// ============================================================================

export interface SeverityThresholds {
  /** Risk score >= this = CRITICAL */
  critical: number;
  /** Risk score >= this = HIGH */
  high: number;
  /** Risk score >= this = MEDIUM */
  medium: number;
  /** Below medium = LOW */
}

// ============================================================================
// CONFIDENCE THRESHOLDS
// ============================================================================

export interface ConfidenceThresholds {
  /** Confidence score >= this = HIGH */
  high: number;
  /** Confidence score >= this = MEDIUM */
  medium: number;
  /** Below medium = LOW */
}

// ============================================================================
// SIGNAL MULTIPLIERS
// ============================================================================

export interface SignalMultipliers {
  /** Multiplier when sensitive data is detected */
  sensitiveData: number;
  /** Multiplier when financial impact is detected */
  financialImpact: number;
  /** Multiplier when policy conflict is detected */
  policyConflict: number;
  /** Multiplier when regulatory risk is detected */
  regulatoryRisk: number;
  /** Multiplier for explicit commitment language */
  explicitCommitment: number;
  /** Multiplier for agent statements (vs customer) */
  agentStatement: number;
  /** Multiplier for recency (more recent = higher risk) */
  recency: number;
}

// ============================================================================
// ESCALATION RULES
// ============================================================================

export interface EscalationRule {
  id: string;
  description: string;
  conditions: {
    sensitiveData?: boolean;
    financialImpact?: boolean;
    policyConflict?: boolean;
    regulatoryRisk?: boolean;
    ungrounded?: boolean;
    contradictionMassMin?: number;
  };
  /** Minimum severity to escalate to */
  minSeverity: IssueSeverity;
}

// ============================================================================
// CLUSTERING CONFIG
// ============================================================================

export interface ClusteringConfig {
  /** Cosine similarity threshold for initial clustering */
  similarityThreshold: number;
  /** Edge density threshold for merging clusters */
  edgeDensityMergeThreshold: number;
  /** Max evidence snippets per issue */
  maxEvidenceSnippets: number;
  /** Max issues to return */
  maxIssues: number;
  /** Minimum claims to form an issue */
  minClaimsPerIssue: number;
}

// ============================================================================
// RED FLAG PATTERNS
// ============================================================================

export interface RedFlagPattern {
  id: string;
  category: IssueCategory;
  patterns: string[]; // Regex patterns
  severity: IssueSeverity;
  description: string;
}

// ============================================================================
// TOPIC KEYWORDS (for category detection)
// ============================================================================

export interface TopicKeywords {
  [category: string]: string[];
}

// ============================================================================
// FULL RISK MODEL CONFIG
// ============================================================================

export interface RiskModelConfig {
  version: string;
  categoryWeights: CategoryWeights;
  severityThresholds: SeverityThresholds;
  confidenceThresholds: ConfidenceThresholds;
  signalMultipliers: SignalMultipliers;
  escalationRules: EscalationRule[];
  clustering: ClusteringConfig;
  redFlagPatterns: RedFlagPattern[];
  topicKeywords: TopicKeywords;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

export const DEFAULT_RISK_MODEL: RiskModelConfig = {
  version: "1.0.0",
  
  categoryWeights: {
    BILLING: 1.2,
    DISCLOSURE: 1.3,
    MISREPRESENTATION: 1.5,
    PRIVACY: 1.8,
    SECURITY: 2.0,
    PROCESS: 0.8,
    CUSTOMER_HARM: 1.6,
    REGULATORY: 1.9,
    PROMISE_BREACH: 1.1,
    OTHER: 1.0,
  },
  
  severityThresholds: {
    critical: 80,
    high: 60,
    medium: 35,
  },
  
  confidenceThresholds: {
    high: 0.75,
    medium: 0.45,
  },
  
  signalMultipliers: {
    sensitiveData: 1.5,
    financialImpact: 1.3,
    policyConflict: 1.4,
    regulatoryRisk: 1.6,
    explicitCommitment: 1.2,
    agentStatement: 1.15,
    recency: 1.1,
  },
  
  escalationRules: [
    {
      id: "SENSITIVE_UNGROUNDED",
      description: "Sensitive data mentioned without grounding",
      conditions: { sensitiveData: true, ungrounded: true },
      minSeverity: "HIGH",
    },
    {
      id: "POLICY_FINANCIAL",
      description: "Policy conflict with financial impact",
      conditions: { policyConflict: true, financialImpact: true },
      minSeverity: "HIGH",
    },
    {
      id: "REGULATORY_ANY",
      description: "Any regulatory risk detected",
      conditions: { regulatoryRisk: true },
      minSeverity: "HIGH",
    },
    {
      id: "HIGH_CONTRADICTION",
      description: "High contradiction mass indicates serious inconsistency",
      conditions: { contradictionMassMin: 2.5 },
      minSeverity: "HIGH",
    },
  ],
  
  clustering: {
    similarityThreshold: 0.65,
    edgeDensityMergeThreshold: 0.4,
    maxEvidenceSnippets: 5,
    maxIssues: 20,
    minClaimsPerIssue: 2,
  },
  
  redFlagPatterns: [
    {
      id: "PCI_DATA",
      category: "SECURITY",
      patterns: ["\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b", "\\bcvv\\b", "\\bcard number\\b"],
      severity: "CRITICAL",
      description: "Payment card data detected",
    },
    {
      id: "SSN_DATA",
      category: "PRIVACY",
      patterns: ["\\b\\d{3}-\\d{2}-\\d{4}\\b", "\\bsocial security\\b"],
      severity: "CRITICAL",
      description: "Social Security Number detected",
    },
    {
      id: "GUARANTEE_LANGUAGE",
      category: "MISREPRESENTATION",
      patterns: ["\\bguarantee\\b", "\\bpromise\\b.*\\bnever\\b", "\\bwill never\\b"],
      severity: "HIGH",
      description: "Absolute guarantee language used",
    },
    {
      id: "LEGAL_THREAT",
      category: "REGULATORY",
      patterns: ["\\blawsuit\\b", "\\blegal action\\b", "\\battorney\\b", "\\bsue\\b"],
      severity: "HIGH",
      description: "Legal/regulatory language detected",
    },
  ],
  
  topicKeywords: {
    BILLING: ["bill", "billing", "charge", "payment", "invoice", "rate", "cost", "price", "fee", "refund"],
    DISCLOSURE: ["disclose", "disclosure", "inform", "notify", "notice", "terms", "conditions", "agreement"],
    MISREPRESENTATION: ["promise", "guarantee", "never", "always", "won't", "will not", "definitely"],
    PRIVACY: ["personal", "private", "data", "information", "email", "address", "phone", "ssn", "social"],
    SECURITY: ["password", "security", "account", "access", "login", "verify", "authentication"],
    PROCESS: ["process", "procedure", "step", "follow", "complete", "submit", "request"],
    CUSTOMER_HARM: ["frustrated", "upset", "angry", "disappointed", "harm", "damage", "loss"],
    REGULATORY: ["compliance", "regulation", "legal", "law", "requirement", "mandate"],
    PROMISE_BREACH: ["i will", "i'll", "we will", "we'll", "send", "email", "call back", "follow up"],
  },
};

// ============================================================================
// CONFIG LOADING
// ============================================================================

/**
 * Get the risk model config with optional environment overrides.
 */
export function getRiskModelConfig(): RiskModelConfig {
  // Start with defaults
  const config = JSON.parse(JSON.stringify(DEFAULT_RISK_MODEL)) as RiskModelConfig;
  
  // Allow environment overrides for key values
  if (process.env.TCL_SEVERITY_CRITICAL) {
    config.severityThresholds.critical = parseFloat(process.env.TCL_SEVERITY_CRITICAL);
  }
  if (process.env.TCL_SEVERITY_HIGH) {
    config.severityThresholds.high = parseFloat(process.env.TCL_SEVERITY_HIGH);
  }
  if (process.env.TCL_SIMILARITY_THRESHOLD) {
    config.clustering.similarityThreshold = parseFloat(process.env.TCL_SIMILARITY_THRESHOLD);
  }
  if (process.env.TCL_MAX_ISSUES) {
    config.clustering.maxIssues = parseInt(process.env.TCL_MAX_ISSUES, 10);
  }
  
  return config;
}

/**
 * Get hash of the config for reproducibility.
 */
export function getConfigHash(config?: RiskModelConfig): string {
  const cfg = config || getRiskModelConfig();
  const json = JSON.stringify(cfg);
  return createHash("sha256").update(json).digest("hex").substring(0, 16);
}

/**
 * Merge custom config with defaults.
 */
export function mergeRiskModelConfig(custom: Partial<RiskModelConfig>): RiskModelConfig {
  const base = getRiskModelConfig();
  return {
    ...base,
    ...custom,
    categoryWeights: { ...base.categoryWeights, ...custom.categoryWeights },
    severityThresholds: { ...base.severityThresholds, ...custom.severityThresholds },
    confidenceThresholds: { ...base.confidenceThresholds, ...custom.confidenceThresholds },
    signalMultipliers: { ...base.signalMultipliers, ...custom.signalMultipliers },
    escalationRules: custom.escalationRules || base.escalationRules,
    clustering: { ...base.clustering, ...custom.clustering },
    redFlagPatterns: custom.redFlagPatterns || base.redFlagPatterns,
    topicKeywords: { ...base.topicKeywords, ...custom.topicKeywords },
  };
}

