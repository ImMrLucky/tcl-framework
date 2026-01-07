import type { IssueV2, ImpactV2, SeverityDisplayV2, RecommendedActionType } from '../types.js';
import { type IssueScoringConfig } from '../config/issue-scoring.js';
export interface ScoringContext {
    mode: 'transcript_only' | 'with_evidence';
    numSources: number;
    graphStatus?: string;
    templateId?: string;
    isRegulatedTemplate?: boolean;
}
export interface ScoredIssue extends IssueV2 {
    impact: ImpactV2;
    severityDisplay: SeverityDisplayV2;
    score: number;
    scoreBreakdown: {
        impactScore: number;
        verificationScore: number;
        disputeScore: number;
        contradictionScore: number;
        commitmentScore: number;
        escalationScore: number;
        templateScore: number;
        penalties: {
            transcriptOnlyCapPenalty?: number;
            [key: string]: number | undefined;
        };
    };
    severityReason: string[];
    capsApplied: string[];
    recommendedAction: {
        actionType: RecommendedActionType;
        explanation: string;
        requiredEvidence?: string[];
    };
}
/**
 * Score issues with transcript-only caps and proper ranking
 */
export declare function scoreIssues(issues: IssueV2[], context: ScoringContext, config?: IssueScoringConfig): {
    issues: ScoredIssue[];
    diagnostics: any;
};
