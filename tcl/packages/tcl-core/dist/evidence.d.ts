import { Claim, Source, Violation } from "./types.js";
/**
 * MVP grounding: token overlap.
 * Production: replace by NLI entailment (see graph/edge_builder.ts).
 */
export declare function attachEvidenceAndFindViolations(claims: Claim[], sources: Source[] | undefined, minSupport?: number): {
    claims: Claim[];
    violations: Violation[];
    missing: {
        claimId: string;
        reason: string;
    }[];
    truthScore: number;
};
