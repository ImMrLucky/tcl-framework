import type { Claim, IssueV2 } from "../types.js";
export type HallucinationClassification = "supported_by_external_policy" | "supported_by_transcript_only" | "unsupported_specific_claim" | "unverifiable_absolute_claim" | "fabricated_authority_claim";
export interface HallucinationDetectionResult {
    hallucinationScore: number;
    issues: IssueV2[];
    classifications: Array<{
        claimId: string;
        classification: HallucinationClassification;
        penalty: number;
    }>;
}
export declare function detectHallucinations(claims: Claim[], context: {
    runId: string;
    conversationId: string;
    hasExternalEvidence: boolean;
    evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL";
}): HallucinationDetectionResult;
