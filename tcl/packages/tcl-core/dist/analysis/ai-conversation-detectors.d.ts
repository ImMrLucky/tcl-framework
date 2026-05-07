import type { Claim, IssueV2 } from "../types.js";
export interface AiDetectionContext {
    runId: string;
    conversationId: string;
    evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL";
    /** Set when tool/API results are available for this turn (future hook) */
    toolResultsByTurn?: Set<number>;
}
export declare function detectAiConversationIssues(claims: Claim[], ctx: AiDetectionContext): IssueV2[];
