export interface IssueScoringConfig {
    weights: {
        baseWeights?: {
            impact: number;
            verification: number;
            confidence: number;
        };
        impact?: {
            low: number;
            medium: number;
            high: number;
        };
        verification?: {
            EXTERNAL_VERIFIED: number;
            TRANSCRIPT_ONLY: number;
            NONE: number;
        };
        disputeBoostPoints?: number;
        contradictionBoostPoints?: number;
        commitmentBoostPoints?: number;
        escalationBoostPoints?: number;
        regulatedTemplateBoostPoints?: number;
        disputeBoost?: number;
        contradictionBoost?: number;
        commitmentBoost?: number;
        escalationBoost?: number;
        regulatedTemplateBoost?: number;
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
    normalization?: {
        maxRawScore?: number;
    };
}
export declare function getIssueScoringConfig(): IssueScoringConfig;
