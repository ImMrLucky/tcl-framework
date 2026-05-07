import type { Claim, IssueV2 } from "../../types.js";
/**
 * Backward-compatible wrapper. The implementation is now driven entirely by
 * the final-expense domain pack so adding/changing rules is a one-file change.
 */
export declare function detectFinalExpenseComplianceIssues(claims: Pick<Claim, "id" | "text" | "meta">[], context: {
    runId: string;
    conversationId: string;
    evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL";
}): IssueV2[];
