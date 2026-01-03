/**
 * Commercial Loans Domain Configuration
 * 
 * Example of how a different vertical would configure the TCL engine.
 * This is NOT implemented - just a template for future use.
 */

import type { NLPConfig, EntityPattern, SynonymGroup } from '../config.js';

/**
 * Commercial loans specific entity patterns
 */
const LOAN_ENTITIES: EntityPattern[] = [
  {
    type: 'INTEREST_RATE',
    patterns: [
      /(\d+(?:\.\d+)?)\s*(%|percent)\s*(APR|apr|annual|interest)/gi,
      /(interest\s+rate|APR)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*%?/gi,
    ],
    priority: 100
  },
  {
    type: 'LOAN_AMOUNT',
    patterns: [
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(loan|principal|amount)/gi,
      /(loan|principal)\s+(?:of\s+)?\$(\d+(?:,\d{3})*)/gi,
    ],
    priority: 95
  },
  {
    type: 'LOAN_TERM',
    patterns: [
      /(\d+)\s*(year|month|yr|mo)s?\s*(term|loan|mortgage)/gi,
      /(term|duration)\s+(?:of\s+)?(\d+)\s*(year|month)s?/gi,
    ],
    priority: 90
  },
  {
    type: 'DISCLOSURE',
    patterns: [
      /(truth\s+in\s+lending|TILA|RESPA|good\s+faith\s+estimate|closing\s+disclosure)/gi,
      /(disclosure|closing)\s+(document|statement|form)/gi,
    ],
    priority: 85
  },
  {
    type: 'LOAN_TYPE',
    patterns: [
      /(fixed|variable|adjustable|ARM|conventional|FHA|VA|jumbo)\s*(rate\s+)?(loan|mortgage)/gi,
    ],
    priority: 80
  },
  {
    type: 'COLLATERAL',
    patterns: [
      /(collateral|property|real\s+estate|asset)\s+(at|located|valued)/gi,
      /(secured\s+by|lien\s+on)\s+/gi,
    ],
    priority: 75
  }
];

/**
 * Commercial loans specific synonyms
 */
const LOAN_SYNONYMS: SynonymGroup[] = [
  { canonical: 'approve', terms: ['approve', 'approved', 'accept', 'grant', 'fund', 'originate'] },
  { canonical: 'deny', terms: ['deny', 'denied', 'decline', 'reject', 'turn down'] },
  { canonical: 'rate', terms: ['rate', 'APR', 'interest', 'percentage'] },
  { canonical: 'term', terms: ['term', 'duration', 'period', 'length', 'maturity'] },
  { canonical: 'payment', terms: ['payment', 'installment', 'P&I', 'principal and interest'] },
  { canonical: 'disclosure', terms: ['disclosure', 'TILA', 'truth in lending', 'closing disclosure', 'GFE'] },
  { canonical: 'underwrite', terms: ['underwrite', 'underwriting', 'review', 'assess', 'evaluate'] },
  { canonical: 'condition', terms: ['condition', 'contingency', 'requirement', 'stipulation', 'prior to'] },
];

/**
 * Full commercial loans config
 */
export const COMMERCIAL_LOANS_CONFIG: Partial<NLPConfig> = {
  domain: 'commercial_loans',
  entities: LOAN_ENTITIES,
  synonyms: LOAN_SYNONYMS,
  actions: [
    {
      type: 'APPROVAL',
      patterns: [
        /\b(loan\s+is\s+approved|you('re|\s+are)\s+approved|approval\s+granted)\b/i,
      ]
    },
    {
      type: 'DENIAL',
      patterns: [
        /\b(loan\s+is\s+denied|cannot\s+approve|decline\s+the\s+application)\b/i,
      ]
    },
    {
      type: 'RATE_LOCK',
      patterns: [
        /\b(lock\s+(the\s+)?rate|rate\s+is\s+locked|locked\s+at)\b/i,
      ]
    },
    {
      type: 'DISCLOSURE_SENT',
      patterns: [
        /\b(send|sent|provide|provided)\s+(the\s+)?(disclosure|TILA|closing)\b/i,
      ]
    }
  ],
  statementClassification: {
    promise: ['will fund', 'will close', 'will send disclosure', 'will lock'],
    denial: ['cannot approve', 'does not qualify', 'insufficient', 'ineligible'],
    explanation: ['based on the appraisal', 'due to credit', 'because of DTI', 'ratio exceeds'],
    question: ['what rate', 'when will', 'how much down'],
  },
  thresholds: {
    entityConfidence: 0.8,
    topicOverlap: 0.3,
    polarityStrength: 0.4,
  }
};

export default COMMERCIAL_LOANS_CONFIG;

