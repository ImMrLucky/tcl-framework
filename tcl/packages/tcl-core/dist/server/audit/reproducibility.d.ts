import type { Claim, SpectralReport } from "../../types.js";
/**
 * Canonicalize and hash the input payload (claims + edges + grounded)
 */
export declare function computeInputHash(claims: Array<{
    id: string;
    text: string;
}>, supports: Array<{
    claimA: string;
    claimB: string;
    weight?: number;
}>, contradictions: Array<{
    claimA: string;
    claimB: string;
    weight?: number;
}>, grounded: string[]): string;
/**
 * Canonicalize and hash the config
 */
export declare function computeConfigHash(config: {
    wSupport?: number;
    wContradiction?: number;
    wCircularity?: number;
    cycleMaxLen?: number;
    alpha?: number;
    tau?: number;
    [key: string]: any;
}): string;
/**
 * Get engine version from environment or default
 */
export declare function getEngineVersion(): string;
/**
 * Get code version (git commit SHA or build version)
 */
export declare function getCodeVersion(): string;
/**
 * Get model fingerprint
 */
export declare function getModelFingerprint(): {
    claimExtractor: string;
    nliModel: string;
    embeddingModel?: string;
};
/**
 * Calculate importance score for an issue
 */
export declare function calculateImportance(params: {
    nodeBlameNorm?: number;
    truthState?: "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
    speaker?: string;
    hasPolicyTag?: boolean;
}): number;
/**
 * Build issues list from spectral output and claims
 */
export declare function buildIssuesList(spectral: SpectralReport, claims: Array<Claim & {
    meta?: {
        speaker?: string;
        turnIndex?: number;
    };
}>, destructiveClaims?: Array<{
    claimId: string;
    importance: number;
    [key: string]: any;
}>): Array<{
    claimId: string;
    truthState: "Contradicted" | "Supported" | "Ungrounded" | "Inconclusive";
    nodeBlameNorm: number;
    importance: number;
    issueType: "CONTRADICTION" | "UNSUPPORTED" | "POLICY_MISS" | "POLICY_VIOLATION";
    speaker: "AGENT" | "CUSTOMER" | "UNKNOWN";
    turnStartIdx?: number;
    turnEndIdx?: number;
    primaryEvidence?: {
        turnIdx: number;
        speaker: string;
        excerpt: string;
    };
    relatedEdges: {
        topBadContradictions: any[];
        topBadSupports: any[];
    };
    status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_POSITIVE";
}>;
