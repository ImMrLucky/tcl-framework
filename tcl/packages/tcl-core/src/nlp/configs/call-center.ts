/**
 * Call Center Domain Configuration
 * 
 * This is loaded by the call center app to extend the universal config.
 * Other apps (loans, AI chat) would have their own configs.
 * 
 * Usage in app:
 *   import { setNLPConfig } from '@tcl/core/nlp';
 *   import { CALL_CENTER_CONFIG } from '@tcl/core/nlp/configs/call-center';
 *   setNLPConfig(CALL_CENTER_CONFIG);
 */

import type { NLPConfig, EntityPattern, SynonymGroup, ActionPattern } from '../config.js';

/**
 * Call center specific entity patterns
 */
const CALL_CENTER_ENTITIES: EntityPattern[] = [
  {
    type: 'PLAN',
    patterns: [
      /(basic|standard|premium|gold|silver|bronze|platinum|pro|enterprise)\s*(plan|package|tier|account|membership)/gi,
      /(unlimited|family|individual|business)\s*(plan|package|account)/gi,
    ],
    priority: 50
  },
  {
    type: 'FEE',
    patterns: [
      /(early\s+termination|cancellation|activation|setup|monthly\s+service|late|processing|admin)\s*(fee|charge)/gi,
      /(fee|charge)\s+for\s+(\w+(?:\s+\w+)?)/gi,
    ],
    priority: 55
  },
  {
    type: 'POLICY',
    patterns: [
      /(service\s+agreement|terms\s+(and\s+conditions|of\s+service)|contract|policy|policies)/gi,
      /(promotional|promo|trial)\s+period/gi,
    ],
    priority: 40
  },
  {
    type: 'COMMITMENT',
    patterns: [
      /(?:i(?:'ll|\s+will)|we(?:'ll|\s+will))\s+(send|email|call|follow\s+up|check|review|process|apply|credit|refund|waive)/gi,
    ],
    priority: 45
  }
];

/**
 * Call center specific synonyms
 */
const CALL_CENTER_SYNONYMS: SynonymGroup[] = [
  { canonical: 'bill', terms: ['bill', 'billing', 'invoice', 'statement', 'charges'] },
  { canonical: 'fee', terms: ['fee', 'charge', 'cost', 'amount', 'payment', 'surcharge'] },
  { canonical: 'rate', terms: ['rate', 'price', 'pricing', 'cost per'] },
  { canonical: 'plan', terms: ['plan', 'package', 'subscription', 'service', 'tier', 'membership'] },
  { canonical: 'cancel', terms: ['cancel', 'cancellation', 'terminate', 'termination', 'end service', 'disconnect'] },
  { canonical: 'escalate', terms: ['supervisor', 'manager', 'escalate', 'speak to', 'transfer'] },
  { canonical: 'credit', terms: ['credit', 'refund', 'reimburse', 'adjustment', 'courtesy'] },
  { canonical: 'waive', terms: ['waive', 'remove', 'take off', 'eliminate', 'get rid of'] },
];

/**
 * Call center specific action patterns
 */
const CALL_CENTER_ACTIONS: ActionPattern[] = [
  {
    type: 'ESCALATION',
    patterns: [
      /\b(transfer|escalate|speak\s+to\s+(a\s+)?(supervisor|manager))\b/i,
    ]
  },
  {
    type: 'CREDIT_ADJUSTMENT',
    patterns: [
      /\b(apply\s+a?\s*credit|issue\s+a?\s*refund|credit\s+your\s+account)\b/i,
    ],
    speakerConstraint: 'agent'
  },
  {
    type: 'DISCLOSURE',
    patterns: [
      /\b(outlined\s+in|according\s+to|as\s+stated\s+in|per\s+the)\s+(agreement|terms|policy)\b/i,
    ],
    speakerConstraint: 'agent'
  },
  {
    type: 'DOCUMENT_SEND',
    patterns: [
      /\b(send|email)\s+(you\s+)?(a\s+)?(copy|breakdown|agreement|details)/i,
    ],
    speakerConstraint: 'agent'
  }
];

/**
 * Full call center config
 */
export const CALL_CENTER_CONFIG: Partial<NLPConfig> = {
  domain: 'call_center',
  entities: CALL_CENTER_ENTITIES,
  synonyms: CALL_CENTER_SYNONYMS,
  actions: CALL_CENTER_ACTIONS,
  statementClassification: {
    promise: ['will send', "i'll email", 'make sure', 'ensure you receive', 'right after this call'],
    denial: ['that is not', "that's not what", 'never said', 'was not told'],
    explanation: ['the reason', 'this is because', 'due to the', 'as a result of'],
    question: ['can you explain', 'why is', 'what happened', 'how come'],
  },
  thresholds: {
    entityConfidence: 0.75,
    topicOverlap: 0.25,
    polarityStrength: 0.35,
  }
};

// Default export for convenience
export default CALL_CENTER_CONFIG;

