import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ScoringV2Config {
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
    signals: {
      dispute: number;
      strictContradiction: number;
      commitment: number;
      escalation: number;
      evidenceBoost: number;
    };
    categoryMultipliers: Record<string, number>;
  };
  thresholds: {
    severityHigh: number;
    severityMedium: number;
    severityLow: number;
  };
  caps: {
    transcriptOnlyMaxSeverity: "low" | "medium" | "high";
    transcriptOnlyHighExceptions: {
      escalation: boolean;
      strictContradiction: boolean;
      disputedCommitment: boolean;
    };
    transcriptOnlyNoisePenalty: number;
  };
  legalHold: {
    allowInTranscriptOnly: boolean;
    allowOnlyIfEscalationAndRegulated: boolean;
  };
  contradictionRules: {
    requireSameSlotType: boolean;
    requireSameEntityKey: boolean;
    requireOppositePolarity: boolean;
    requireSameTopicId: boolean;
    minNliScore: number;
  };
  taxonomy: {
    refundVsCredit: {
      creditKeywords: string[];
      refundKeywords: string[];
      rule: string;
    };
    regulatoryFeesNotEscalation: {
      regulatoryKeywords: string[];
      escalationKeywords: string[];
      rule: string;
    };
  };
}

let cachedConfig: ScoringV2Config | null = null;

export function getScoringV2Config(): ScoringV2Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const configPath = path.join(__dirname, 'scoring.v2.json');
    const configText = fs.readFileSync(configPath, 'utf-8');
    cachedConfig = JSON.parse(configText) as ScoringV2Config;
    return cachedConfig;
  } catch (error) {
    console.warn('Failed to load scoring.v2.json, using defaults', error);
    // Return defaults
    return {
      weights: {
        impact: { low: 10, medium: 40, high: 80 },
        verification: { EXTERNAL_VERIFIED: 40, TRANSCRIPT_ONLY: 10, NONE: 0 },
        signals: {
          dispute: 30,
          strictContradiction: 40,
          commitment: 25,
          escalation: 60,
          evidenceBoost: 50,
        },
        categoryMultipliers: {},
      },
      thresholds: {
        severityHigh: 70,
        severityMedium: 30,
        severityLow: 0,
      },
      caps: {
        transcriptOnlyMaxSeverity: "medium",
        transcriptOnlyHighExceptions: {
          escalation: true,
          strictContradiction: true,
          disputedCommitment: true,
        },
        transcriptOnlyNoisePenalty: 20,
      },
      legalHold: {
        allowInTranscriptOnly: false,
        allowOnlyIfEscalationAndRegulated: true,
      },
      contradictionRules: {
        requireSameSlotType: true,
        requireSameEntityKey: true,
        requireOppositePolarity: true,
        requireSameTopicId: true,
        minNliScore: 0.65,
      },
      taxonomy: {
        refundVsCredit: {
          creditKeywords: [],
          refundKeywords: [],
          rule: "",
        },
        regulatoryFeesNotEscalation: {
          regulatoryKeywords: [],
          escalationKeywords: [],
          rule: "",
        },
      },
    };
  }
}

