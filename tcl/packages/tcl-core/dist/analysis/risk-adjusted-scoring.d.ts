import type { IssueV2 } from "../types.js";
export type ScoringProfile = "protectqa" | "generic";
export interface RiskAdjustedScoreInput {
    profile?: ScoringProfile;
    transcriptGrounding: number;
    factualTruth: number;
    compliance: number;
    /** 0–100: how well required disclosures were satisfied */
    disclosureCoverage?: number;
    /** 0–100: external / policy evidence support for material claims */
    evidenceSupport?: number;
    speakerConfidence?: number;
    /** 0–100: conversation value mining score */
    businessValueScore?: number;
    consistency: number;
    coherence: number | null;
    hallucination: number;
    drift: number;
    issues: IssueV2[];
    contaminatedClaims: number;
    /** 0..1 unknown speaker line ratio */
    unknownSpeakerRatio?: number;
}
export interface RiskAdjustedScoreResult {
    scores: {
        transcriptGrounding: number;
        factualTruth: number;
        compliance: number;
        disclosureCoverage: number;
        evidenceSupport: number;
        speakerConfidence: number;
        businessValue: number;
        consistency: number;
        coherence: number | null;
        hallucination: number;
        drift: number;
        /** Primary client-facing Conversation Truth & Risk score */
        tcl: number;
        overall: number;
    };
    scoringCapsApplied: string[];
    risk: {
        level: "low" | "medium" | "high" | "critical";
        criticalCount: number;
        highCount: number;
        mediumCount: number;
        lowCount: number;
        reviewRequired: boolean;
        primaryRisk?: string;
        recommendedAction?: string;
        businessImpact?: string;
    };
}
export declare function computeRiskAdjustedScores(input: RiskAdjustedScoreInput): RiskAdjustedScoreResult;
