/**
 * Executive Summary / Trust Report Generator
 *
 * Turns the structured detector + scoring output into a small, opinionated
 * payload that's easy to render and easy for a non-technical reviewer to act on:
 *
 *  - Trust grade (A-F) and headline
 *  - Top issues with quotes and turn refs
 *  - "What was good" highlights when applicable
 *  - Recommended actions (coaching / process / compliance)
 *  - Risk-by-category breakdown for dashboards
 *
 * This is the layer enterprise buyers see, so the language is direct and
 * focuses on the business consequence, not the algorithm internals.
 */
import type { Claim, IssueV2 } from "../types.js";
export interface ExecutiveSummaryInput {
    scores: {
        transcriptGrounding: number;
        factualTruth: number;
        compliance: number;
        consistency: number;
        coherence: number | null;
        hallucination: number;
        drift: number;
        overall: number;
        tcl?: number;
        disclosureCoverage?: number;
        evidenceSupport?: number;
        businessValue?: number;
    };
    risk: {
        level: "low" | "medium" | "high" | "critical";
        criticalCount: number;
        highCount: number;
        mediumCount: number;
        lowCount: number;
        reviewRequired: boolean;
    };
    issues: IssueV2[];
    claims: Claim[];
    scoringCapsApplied: string[];
    diagnostics: {
        contaminatedClaims: number;
        unknownSpeakerLines: number;
        speakerMappingConfidence: number;
    };
}
export type TrustGrade = "A" | "B" | "C" | "D" | "F";
export interface ExecutiveSummary {
    trustGrade: TrustGrade;
    headline: string;
    oneLineVerdict: string;
    topIssues: Array<{
        title: string;
        severity: IssueV2["severity"];
        speakerLabel?: string;
        turnIndex?: number;
        quote: string;
        saferVersion?: string;
        why: string;
    }>;
    highlights: string[];
    recommendedActions: Array<{
        kind: "COACHING" | "COMPLIANCE" | "PROCESS" | "LEGAL";
        action: string;
        priority: "high" | "medium" | "low";
    }>;
    riskByCategory: Record<string, number>;
    scoreBreakdown: {
        label: string;
        value: number | null;
        description: string;
    }[];
    callQualityIndicators: {
        speakerMappingConfidence: number;
        contaminatedClaims: number;
        unknownSpeakerLines: number;
        capsApplied: string[];
    };
}
/**
 * Legacy adapter kept for `server/express.ts`. Older code wired the executive
 * summary off of `aggregatedIssues + raw scores`. The new pipeline produces a
 * richer payload via `buildExecutiveSummary`, but this adapter keeps the older
 * request handler compiling and returns a compatible-shape summary so the UI
 * keeps rendering.
 */
export declare function computeExecutiveSummary(input: {
    aggregatedIssues: any[];
    truthScore: number | null;
    coherenceScore: number | null;
    consistencyScore: number | null;
    evalMode?: any;
}): {
    trustGrade: TrustGrade;
    headline: string;
    oneLineVerdict: string;
    topIssues: ExecutiveSummary["topIssues"];
    recommendedActions: ExecutiveSummary["recommendedActions"];
    riskByCategory: ExecutiveSummary["riskByCategory"];
    scoreBreakdown: ExecutiveSummary["scoreBreakdown"];
};
export declare function buildExecutiveSummary(input: ExecutiveSummaryInput): ExecutiveSummary;
