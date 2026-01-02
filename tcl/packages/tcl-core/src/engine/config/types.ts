/**
 * Configuration types for the deterministic truth graph engine.
 * All weights, thresholds, and rule parameters come from config - never hard-coded.
 */

export interface EdgeWeightConfig {
  contradictionBase: number;
  supportBase: number;
  groundingBase: number;
  structureBase: number;
  
  // Multipliers
  modalityAbsoluteMultiplier: number;
  modalityConditionalMultiplier: number;
  polarityConflictMultiplier: number;
  timeframeConflictMultiplier: number;
  agentSpeakerMultiplier: number;
  customerSpeakerMultiplier: number;
}

export interface PruningConfig {
  topKPerNodePerType: number;
  minWeightContradiction: number;
  minWeightSupport: number;
  minWeightGrounding: number;
  minWeightStructure: number;
}

export interface ModalityLexicon {
  absoluteWords: string[];
  conditionalWords: string[];
  denialWords: string[];
  affirmWords: string[];
  apologyWords: string[];
  questionPatterns: string[];
  requestPatterns: string[];
}

export interface SubjectSchema {
  id: string;
  keywords: string[];
  patterns: RegExp[];
  predicates: string[];
  polarityMapping: Record<string, 'affirm' | 'deny'>;
  relatedSubjects?: string[];
}

export interface EvidenceRetrievalConfig {
  enabled: boolean;
  maxChunksPerClaim: number;
  minKeywordOverlap: number;
  authorityWeights: Record<string, number>;
}

export interface RuleConfig {
  id: string;
  enabled: boolean;
  priority: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}

export interface TruthEngineConfig {
  version: string;
  
  edgeWeights: EdgeWeightConfig;
  pruning: PruningConfig;
  modalityLexicon: ModalityLexicon;
  subjectSchemas: SubjectSchema[];
  evidenceRetrieval: EvidenceRetrievalConfig;
  rules: Record<string, RuleConfig>;
}

/**
 * Default configuration - loaded if no custom config provided.
 * Can be overridden by vertical-specific or org-specific configs.
 */
export const DEFAULT_CONFIG: TruthEngineConfig = {
  version: "1.0.0",
  
  edgeWeights: {
    contradictionBase: 0.8,
    supportBase: 0.5,
    groundingBase: 0.6,
    structureBase: 0.4,
    
    modalityAbsoluteMultiplier: 1.3,
    modalityConditionalMultiplier: 0.8,
    polarityConflictMultiplier: 1.2,
    timeframeConflictMultiplier: 1.1,
    agentSpeakerMultiplier: 1.2,
    customerSpeakerMultiplier: 0.9,
  },
  
  pruning: {
    topKPerNodePerType: 5,
    minWeightContradiction: 0.3,
    minWeightSupport: 0.4,
    minWeightGrounding: 0.3,
    minWeightStructure: 0.2,
  },
  
  modalityLexicon: {
    absoluteWords: [
      "never", "always", "guarantee", "guaranteed", "definitely", "certainly",
      "no", "none", "any time", "anytime", "will not", "won't", "cannot", "can't",
      "without", "free", "zero", "unlimited"
    ],
    conditionalWords: [
      "may", "might", "could", "depends", "depending", "in some cases",
      "if", "unless", "when", "sometimes", "potentially", "possibly"
    ],
    denialWords: [
      "no", "not", "none", "never", "don't", "doesn't", "didn't", "won't",
      "can't", "cannot", "without", "zero", "nothing"
    ],
    affirmWords: [
      "yes", "will", "can", "do", "does", "is", "are", "there is", "there are",
      "absolutely", "correct", "right", "exactly"
    ],
    apologyWords: [
      "apologize", "apology", "sorry", "apologies", "regret", "unfortunately"
    ],
    questionPatterns: [
      "\\?$", "^can i", "^can you", "^is there", "^are there", "^do you",
      "^does", "^what", "^where", "^when", "^why", "^how", "^who"
    ],
    requestPatterns: [
      "can you send", "please send", "i want", "i need", "i'd like",
      "could you", "would you", "send me", "give me", "show me"
    ],
  },
  
  subjectSchemas: [
    {
      id: "cancellation_fee",
      keywords: ["cancel", "cancellation", "cancelling"],
      patterns: [/cancel(l?ation)?\s*(fee|charge|penalty)/i],
      predicates: ["exists", "amount", "applies", "waived"],
      polarityMapping: { "without": "deny", "no": "deny", "free": "deny" },
      relatedSubjects: ["early_termination_fee"],
    },
    {
      id: "early_termination_fee",
      keywords: ["early", "termination", "terminate"],
      patterns: [/early\s*termination\s*(fee|charge)/i, /terminate\s*early/i],
      predicates: ["exists", "amount", "applies", "conditions"],
      polarityMapping: { "may be": "affirm", "there may": "affirm" },
      relatedSubjects: ["cancellation_fee"],
    },
    {
      id: "extra_fees",
      keywords: ["extra", "additional", "hidden"],
      patterns: [/(extra|additional|hidden)\s*(fee|charge|cost)s?/i],
      predicates: ["exists", "amount", "types"],
      polarityMapping: { "no": "deny", "none": "deny", "without": "deny" },
    },
    {
      id: "adjustment_fee",
      keywords: ["adjustment", "service adjustment"],
      patterns: [/(service\s*)?adjustment\s*(fee|charge)/i],
      predicates: ["exists", "amount", "started", "cycle"],
      polarityMapping: {},
    },
    {
      id: "rate_change",
      keywords: ["rate", "price", "cost", "bill"],
      patterns: [/rate\s*(change|increas|decreas)/i, /bill.*higher/i, /price.*change/i],
      predicates: ["changed", "amount", "reason"],
      polarityMapping: { "hasn't changed": "deny", "hasn't": "deny" },
    },
    {
      id: "plan_change",
      keywords: ["plan", "package", "subscription"],
      patterns: [/plan\s*(change|modif)/i],
      predicates: ["changed", "type", "effective"],
      polarityMapping: { "hasn't changed": "deny" },
    },
    {
      id: "written_confirmation",
      keywords: ["email", "writing", "written", "send", "copy"],
      patterns: [/send.*email/i, /email.*copy/i, /in\s*writing/i],
      predicates: ["promised", "timeframe", "content"],
      polarityMapping: {},
    },
    {
      id: "promo_period",
      keywords: ["promo", "promotional", "promotion"],
      patterns: [/promo(tional)?\s*period/i, /promotional\s*pricing/i],
      predicates: ["active", "end_date", "conditions"],
      polarityMapping: {},
    },
  ],
  
  evidenceRetrieval: {
    enabled: false, // Disabled by default, enable when corpus available
    maxChunksPerClaim: 3,
    minKeywordOverlap: 0.2,
    authorityWeights: {
      policy: 1.0,
      agreement: 0.9,
      kb: 0.7,
      product: 0.6,
    },
  },
  
  rules: {
    "POLARITY_CONFLICT": {
      id: "POLARITY_CONFLICT",
      enabled: true,
      priority: 1,
      severity: "high",
      description: "Same subject with conflicting polarity (affirm vs deny)",
    },
    "ABSOLUTE_TO_CONDITIONAL": {
      id: "ABSOLUTE_TO_CONDITIONAL",
      enabled: true,
      priority: 2,
      severity: "high",
      description: "Absolute statement followed by conditional qualifier",
    },
    "TIMEFRAME_CONFLICT": {
      id: "TIMEFRAME_CONFLICT",
      enabled: true,
      priority: 3,
      severity: "medium",
      description: "Overlapping timeframes with conflicting states",
    },
    "AGENT_SELF_CONTRADICTION": {
      id: "AGENT_SELF_CONTRADICTION",
      enabled: true,
      priority: 1,
      severity: "critical",
      description: "Agent contradicts their own previous statement",
    },
    "SUPPORT_REPETITION": {
      id: "SUPPORT_REPETITION",
      enabled: true,
      priority: 5,
      severity: "low",
      description: "Same claim repeated or paraphrased",
    },
    "QUESTION_ANSWER": {
      id: "QUESTION_ANSWER",
      enabled: true,
      priority: 4,
      severity: "low",
      description: "Customer question followed by agent answer",
    },
    "REQUEST_FULFILLMENT": {
      id: "REQUEST_FULFILLMENT",
      enabled: true,
      priority: 4,
      severity: "low",
      description: "Customer request followed by agent promise",
    },
  },
};

