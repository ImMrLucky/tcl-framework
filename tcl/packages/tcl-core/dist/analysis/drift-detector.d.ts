import type { Claim, IssueV2 } from "../types.js";
export interface DriftDetectionResult {
    driftScore: number;
    driftIssues: IssueV2[];
    driftTimeline: Array<{
        turnIndex?: number;
        claimId: string;
        marker: string;
        text: string;
        topic?: string;
        strength?: number;
        band?: string;
    }>;
}
export declare function detectDrift(claims: Claim[], context: {
    runId: string;
    conversationId: string;
    evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL";
}): DriftDetectionResult;
