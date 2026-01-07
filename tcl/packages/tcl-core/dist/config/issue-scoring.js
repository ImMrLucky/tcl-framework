import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let cachedConfig = null;
export function getIssueScoringConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    try {
        const configPath = path.join(__dirname, 'issue-scoring.json');
        const configText = fs.readFileSync(configPath, 'utf-8');
        cachedConfig = JSON.parse(configText);
        return cachedConfig;
    }
    catch (error) {
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
