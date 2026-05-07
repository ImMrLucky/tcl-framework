import type { Claim, IssueV2 } from "../types.js";
export type FactualTruthClassification = "TRUE_SUPPORTED" | "TRUE_BUT_NEEDS_DISCLOSURE" | "MISLEADING" | "LIKELY_FALSE" | "FALSE_BY_RULE" | "UNVERIFIABLE";
export interface FactualTruthResult {
    factualTruthScore: number;
    classifications: Array<{
        claimId: string;
        classification: FactualTruthClassification;
        penalty: number;
        reasons: string[];
    }>;
}
export declare function evaluateFactualTruth(claims: Claim[], issues: IssueV2[], context: {
    hasExternalEvidence: boolean;
}): FactualTruthResult;
