import { Claim, Violation } from "./types.js";
export declare function findLogicViolations(claims: Claim[]): {
    violations: Violation[];
    contradictions: {
        claimA: string;
        claimB: string;
        reason: string;
    }[];
    consistencyScore: number;
};
