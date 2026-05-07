import type { Claim, IssueV2 } from "../types.js";
export interface ConsistencyEvent {
    kind: "customer_fact" | "agent_assertion" | "agent_dismissal" | "numeric" | "commitment";
    topic: string;
    turnIndex?: number;
    claimId: string;
    text: string;
    entities: string[];
    numbers?: number[];
}
export interface ConsistencyResult {
    events: ConsistencyEvent[];
    issues: IssueV2[];
    consistencyScore: number;
    pairs: Array<{
        earlier: ConsistencyEvent;
        later: ConsistencyEvent;
        reason: string;
    }>;
}
export declare function runCrossTurnConsistency(claims: Claim[], context: {
    runId: string;
    conversationId: string;
    evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL";
}): ConsistencyResult;
