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
export declare function getScoringV2Config(): ScoringV2Config;
