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
      ui: { maxTopIssues: 4 },
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
      },
      typePriority: [
        'CONTRADICTION',
        'DATA_INTEGRITY',
        'FEE_DISCLOSURE_RISK',
        'COMMITMENT_INCONSISTENCY',
        'NUMERIC_MISMATCH',
        'UNSUPPORTED_CLAIM',
        'UNVERIFIED_CLAIM',
        'OTHER',
      ],
    };
  }
}

