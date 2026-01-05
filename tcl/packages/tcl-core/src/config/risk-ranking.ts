/**
 * Risk Ranking Configuration
 * 
 * Config-driven risk scoring and ranking for issues.
 * NO hard-coded thresholds or weights.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface RiskRankingConfig {
  ui: {
    maxTopIssues: number;
  };
  issueLimits?: {
    perClaimMax: number;
    globalMax: number;
    topIssuesMax: number;
    evidenceQuotesMax: number;
  };
  severityThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  weights: {
    typeBase: Record<string, number>;
    speakerMultiplier: Record<string, number>;
    verificationMultiplier: Record<string, number>;
    // Composite scoring weights (for new formula)
    severityWeight?: number;
    categoryMultiplier?: Record<string, number>;
    confidenceWeight?: number;
    structuralImportanceWeight?: number;
    evidencePenaltyWeight?: number;
    customerImpactWeight?: number;
  };
  typePriority: string[];
}

let cachedConfig: RiskRankingConfig | null = null;

export function getRiskRankingConfig(): RiskRankingConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const configPath = join(__dirname, 'risk-ranking.json');
    const configText = readFileSync(configPath, 'utf-8');
    cachedConfig = JSON.parse(configText) as RiskRankingConfig;
    return cachedConfig;
  } catch (error) {
    console.warn('Failed to load risk-ranking.json, using defaults');
    // Return safe defaults
    return {
      ui: { maxTopIssues: 10 },
      issueLimits: {
        perClaimMax: 10,
        globalMax: 50,
        topIssuesMax: 10,
        evidenceQuotesMax: 5,
      },
      severityThresholds: {
        low: 0.20,
        medium: 0.45,
        high: 0.70,
        critical: 0.85,
      },
      weights: {
        typeBase: {
          CONTRADICTION: 0.75,
          UNVERIFIED_CLAIM: 0.35,
          UNSUPPORTED_CLAIM: 0.65,
          UNGROUNDED: 0.50,
          RISK_SIGNAL: 0.60,
          POLICY: 0.70,
          FEE_DISCLOSURE_RISK: 0.70,
          COMMITMENT_INCONSISTENCY: 0.60,
          NUMERIC_MISMATCH: 0.55,
          DATA_INTEGRITY: 0.80,
          OTHER: 0.30,
        },
        speakerMultiplier: {
          AGENT: 1.15,
          CUSTOMER: 0.85,
          SYSTEM: 1.25,
          UNKNOWN: 1.00,
        },
        verificationMultiplier: {
          EXTERNAL_VERIFIED: 1.10,
          TRANSCRIPT_ONLY: 0.90,
          NONE: 0.80,
        },
        // Composite scoring weights
        severityWeight: 0.25,
        categoryMultiplier: {
          billing: 1.2,
          fees: 1.3,
          refunds: 1.2,
          privacy: 1.1,
          disclosure: 1.15,
          retention: 1.0,
          general: 1.0,
          other: 1.0,
        },
        confidenceWeight: 0.20,
        structuralImportanceWeight: 0.15,
        evidencePenaltyWeight: 0.10,
        customerImpactWeight: 0.30,
      },
      typePriority: [
        'CONTRADICTION',
        'DATA_INTEGRITY',
        'POLICY',
        'FEE_DISCLOSURE_RISK',
        'RISK_SIGNAL',
        'COMMITMENT_INCONSISTENCY',
        'NUMERIC_MISMATCH',
        'UNSUPPORTED_CLAIM',
        'UNGROUNDED',
        'UNVERIFIED_CLAIM',
        'OTHER',
      ],
    };
  }
}

