import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface IssueScoringConfig {
  weights: {
    impact: {
      low: number;
      medium: number;
      high: number;
    };
    verification: {
      EXTERNAL_VERIFIED: number;
      TRANSCRIPT_ONLY: number;
      NONE: number;
    };
    disputeBoost: number;
    contradictionBoost: number;
    commitmentBoost: number;
    escalationBoost: number;
    regulatedTemplateBoost: number;
  };
  caps: {
    transcriptOnlyMaxSeverityDisplay: "low" | "medium" | "high";
    transcriptOnlyHighExceptions: {
      allowIfEscalation: boolean;
      allowIfStrictContradiction: boolean;
      allowIfDisputedCommitment: boolean;
    };
  };
  contradiction: {
    requireSameSlotType: boolean;
    requireSameEntityKey: boolean;
    requireOppositePolarity: boolean;
    requireSameTopicId: boolean;
    minModelScore: number;
  };
  taxonomy: {
    refundKeywords: string[];
    creditKeywords: string[];
    regulatoryFeeKeywords: string[];
    escalationKeywords: string[];
    commitmentKeywords: string[];
  };
  impactMapping: Record<string, "low" | "medium" | "high">;
  categoryImpactMapping: Record<string, "low" | "medium" | "high">;
}

let cachedConfig: IssueScoringConfig | null = null;

export function getIssueScoringConfig(): IssueScoringConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const configPath = path.join(__dirname, 'issue-scoring.json');
    const configText = fs.readFileSync(configPath, 'utf-8');
    cachedConfig = JSON.parse(configText) as IssueScoringConfig;
    return cachedConfig;
  } catch (error) {
    console.warn('Failed to load issue-scoring.json, using defaults', error);
    // Return defaults
    return {
      weights: {
        impact: { low: 0.2, medium: 0.5, high: 0.8 },
        verification: { EXTERNAL_VERIFIED: 1.0, TRANSCRIPT_ONLY: 0.6, NONE: 0.3 },
        disputeBoost: 0.3,
        contradictionBoost: 0.4,
        commitmentBoost: 0.35,
        escalationBoost: 0.5,
        regulatedTemplateBoost: 0.25,
      },
      caps: {
        transcriptOnlyMaxSeverityDisplay: "medium",
        transcriptOnlyHighExceptions: {
          allowIfEscalation: true,
          allowIfStrictContradiction: true,
          allowIfDisputedCommitment: true,
        },
      },
      contradiction: {
        requireSameSlotType: true,
        requireSameEntityKey: true,
        requireOppositePolarity: true,
        requireSameTopicId: true,
        minModelScore: 0.55,
      },
      taxonomy: {
        refundKeywords: ["refund", "reimburse", "money back"],
        creditKeywords: ["credit", "adjustment", "promo"],
        regulatoryFeeKeywords: ["regulatory fee", "tax"],
        escalationKeywords: ["attorney general", "bbb", "lawsuit"],
        commitmentKeywords: ["will", "promise", "guarantee"],
      },
      impactMapping: {},
      categoryImpactMapping: {},
    };
  }
}

