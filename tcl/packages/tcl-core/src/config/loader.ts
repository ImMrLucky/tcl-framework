/**
 * Config Loader - Single source of truth for all thresholds, weights, templates
 * 
 * NO HARD-CODED VALUES - everything comes from config files.
 */

import scoringConfig from './scoring.json';
import templatesConfig from './templates.json';
import taxonomyConfig from './taxonomy.json';

export interface ScoringConfig {
  thresholds: {
    truthTau: number;
    severity: {
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
    confidence: {
      low: number;
      medium: number;
      high: number;
    };
    contradictionWeight: number;
    supportWeight: number;
    groundingWeight: number;
    minContradictionScore: number;
    minSupportScore: number;
    minGroundingScore: number;
  };
  weights: {
    issueComposite: {
      risk: number;
      impact: number;
      fixability: number;
    };
    riskScore: {
      severity: number;
      contradictionStrength: number;
      topicRiskMultiplier: number;
      regulatorySensitivity: number;
    };
    impactScore: {
      category: number;
      customerHarmPotential: number;
      regulatorySensitivity: number;
    };
    fixabilityScore: {
      clarity: number;
      claimCount: number;
      turnSpan: number;
      groundedness: number;
    };
  };
  categoryRiskMultipliers: Record<string, number>;
  customerHarmIndicators: Record<string, number>;
}

export interface TemplatesConfig {
  contradiction: {
    title: string;
    whatIsWrong: string;
    whyWrong: string[];
    whyItMatters: string[];
    recommendedActions: Array<{
      type: string;
      action: string;
    }>;
  };
  ungrounded: {
    title: string;
    whatIsWrong: string;
    whyWrong: string[];
    whyItMatters: string[];
    recommendedActions: Array<{
      type: string;
      action: string;
    }>;
  };
  circular: {
    title: string;
    whatIsWrong: string;
    whyWrong: string[];
    whyItMatters: string[];
    recommendedActions: Array<{
      type: string;
      action: string;
    }>;
  };
  default: {
    title: string;
    whatIsWrong: string;
    whyWrong: string[];
    whyItMatters: string[];
    recommendedActions: Array<{
      type: string;
      action: string;
    }>;
  };
}

export interface TaxonomyConfig {
  categories: Record<string, {
    label: string;
    subcategories: string[];
    regulatorySensitivity: number;
    customerHarmPotential: number;
  }>;
  subcategoryMapping: Record<string, string>;
}

let cachedScoring: ScoringConfig | null = null;
let cachedTemplates: TemplatesConfig | null = null;
let cachedTaxonomy: TaxonomyConfig | null = null;

/**
 * Get scoring configuration (cached)
 */
export function getScoringConfig(): ScoringConfig {
  if (!cachedScoring) {
    cachedScoring = scoringConfig as ScoringConfig;
  }
  return cachedScoring;
}

/**
 * Get templates configuration (cached)
 */
export function getTemplatesConfig(): TemplatesConfig {
  if (!cachedTemplates) {
    cachedTemplates = templatesConfig as TemplatesConfig;
  }
  return cachedTemplates;
}

/**
 * Get taxonomy configuration (cached)
 */
export function getTaxonomyConfig(): TaxonomyConfig {
  if (!cachedTaxonomy) {
    cachedTaxonomy = taxonomyConfig as TaxonomyConfig;
  }
  return cachedTaxonomy;
}

/**
 * Compute hash of config bundle for reproducibility
 */
export function computeConfigHash(): string {
  const crypto = require('crypto');
  const configBundle = JSON.stringify({
    scoring: scoringConfig,
    templates: templatesConfig,
    taxonomy: taxonomyConfig
  });
  return crypto.createHash('sha256').update(configBundle).digest('hex').substring(0, 16);
}

/**
 * Template string substitution
 */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }
  return result;
}

