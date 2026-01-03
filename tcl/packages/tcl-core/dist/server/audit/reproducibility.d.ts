import type { Claim, SpectralReport } from "../../types.js";
import type { ClaimType } from "../../claim_extractor.js";
import { type IssueType } from "../../risk_scoring.js";
/**
 * Defensible Issue Object
 *
 * Each issue must answer:
 * - What: What exactly is inconsistent or unsupported?
 * - Who: Who made the claim?
 * - Where: Where did it occur (turn / timestamp)?
 * - Conflict: What does it conflict with?
 * - Risk: Why is this a risk?
 * - Confidence: How confident is this assessment?
 */
export interface DefensibleIssue {
    issueId: string;
    claimId: string;
    evaluationId?: string;
    what: {
        claimText: string;
        claimSummary: string;
        issueType: IssueType;
        truthState: "Contradicted" | "Supported" | "Ungrounded" | "Inconclusive";
        description: string;
        whyFlagged: string;
        claimType?: ClaimType;
    };
    who: {
        speaker: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
        speakerLabel?: string;
    };
    where: {
        turnStartIdx?: number;
        turnEndIdx?: number;
        timestampStartMs?: number;
        timestampEndMs?: number;
        excerpt?: string;
    };
    conflictsWith: Array<{
        claimId: string;
        claimText: string;
        relationshipType: "contradiction" | "unsupported_by" | "circular_with";
        edgeWeight: number;
    }>;
    risk: {
        severity: "critical" | "high" | "medium" | "low";
        category: string;
        explanation: string;
        policyRuleIds?: string[];
    };
    confidence: {
        nodeBlameNorm: number;
        importance: number;
        nliScore?: number;
        groundingScore?: number;
    };
    status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_POSITIVE";
    statusChangedAt?: string;
    statusChangedBy?: string;
    notes?: string;
}
/**
 * Immutable Evaluation Manifest
 *
 * Once created, an evaluation is FROZEN and cannot be modified.
 * Any changes require creating a NEW evaluation with a new ID.
 *
 * This manifest contains everything needed to:
 * - Reproduce the exact same analysis
 * - Verify the integrity of the evaluation
 * - Trace the provenance of all outputs
 * - Defend the results in an audit
 */
export interface ImmutableEvaluationManifest {
    evaluationId: string;
    mode: "EVALUATION" | "SIMULATION";
    parentEvaluationId?: string;
    provenance: {
        createdAt: string;
        createdBy?: string;
        orgId: string;
        projectId: string;
        env: "sandbox" | "production";
    };
    source: {
        conversationId: string;
        sourceType: "transcript" | "chat" | "document" | "api";
        sourceHash: string;
        sourceTitle?: string;
        externalId?: string;
    };
    frozenInputs: {
        inputHash: string;
        claims: Array<{
            id: string;
            text: string;
            speaker: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
            turnStartIdx?: number;
            turnEndIdx?: number;
            timestampStartMs?: number;
            timestampEndMs?: number;
            tags: string[];
        }>;
        supports: Array<{
            claimA: string;
            claimB: string;
            weight: number;
            source: "nli" | "rule" | "manual";
        }>;
        contradictions: Array<{
            claimA: string;
            claimB: string;
            weight: number;
            source: "nli" | "rule" | "manual";
        }>;
        grounded: string[];
        groundingSources?: Array<{
            id: string;
            text: string;
            type: "policy" | "evidence" | "reference";
        }>;
    };
    frozenConfig: {
        configHash: string;
        engineName: string;
        engineVersion: string;
        codeVersion: string;
        modelFingerprint: {
            claimExtractor: string;
            nliModel: string;
            embeddingModel?: string;
        };
        parameters: {
            wSupport: number;
            wContradiction: number;
            wCircularity: number;
            cycleMaxLen: number;
            alpha?: number;
            tau?: number;
        };
    };
    frozenOutputs: {
        spectral: {
            coherenceScore: number;
            contradictionEnergy: number;
            supportEnergy: number;
            circularityScore: number;
            spectralGap: number;
            cycleMass: number;
            heatTrace: number[];
            truthVector: number[];
            truthStates: string[];
            nodeBlame: number[];
            nodeBlameNorm: number[];
        };
        counts: {
            claims: number;
            contradicted: number;
            ungrounded: number;
            supported: number;
            inconclusive: number;
        };
        fingerprint: {
            coherenceScore: number;
            spectralGap: number;
            contradictionEnergy: number;
            circularityScore: number;
            heatTrace: number[];
        };
    };
    issues: DefensibleIssue[];
    latencyMs: number;
    expiresAt?: string;
}
/**
 * Build an immutable evaluation manifest
 */
export declare function buildImmutableManifest(evaluationId: string, conversationId: string, context: {
    orgId: string;
    projectId: string;
    env: string;
    userId?: string;
}, claims: Array<{
    id: string;
    text: string;
    speaker?: string;
    turnIndex?: number;
    timestampMs?: number;
    tags?: string[];
}>, supports: Array<{
    claimA: string;
    claimB: string;
    weight?: number;
    source?: string;
}>, contradictions: Array<{
    claimA: string;
    claimB: string;
    weight?: number;
    source?: string;
}>, grounded: string[], config: {
    wSupport?: number;
    wContradiction?: number;
    wCircularity?: number;
    cycleMaxLen?: number;
    alpha?: number;
    tau?: number;
}, spectral: SpectralReport, issues: DefensibleIssue[], latencyMs: number, options?: {
    mode?: "EVALUATION" | "SIMULATION";
    parentEvaluationId?: string;
    sourceTitle?: string;
    externalId?: string;
}): ImmutableEvaluationManifest;
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
    claimConfidence?: number;
}): number;
/**
 * Build issues list from spectral output and claims
 * Creates fully defensible issue objects that answer all required questions
 *
 * KEY CHANGES:
 * - Uses new risk_scoring.ts for computed severity (NO hard-coded values)
 * - Uses UNVERIFIED for transcript-only mode (no external docs)
 * - Filters out non-auditable claims (QUESTION, ACKNOWLEDGEMENT, FILLER)
 * - Severity varies based on actual signals, not hard-coded rules
 */
export declare function buildIssuesList(spectral: SpectralReport, claims: Array<Claim & {
    meta?: {
        speaker?: string;
        turnIndex?: number;
        timestampMs?: number;
    };
    claimType?: ClaimType;
    isAuditable?: boolean;
    topicTags?: string[];
    hasAbsoluteLanguage?: boolean;
    hasMoney?: boolean;
}>, destructiveClaims?: Array<{
    claimId: string;
    importance: number;
    [key: string]: any;
}>, evaluationId?: string, options?: {
    hasExternalDocs?: boolean;
    contradictions?: Array<{
        claimA: string;
        claimB: string;
        weight: number;
    }>;
    supports?: Array<{
        claimA: string;
        claimB: string;
        weight: number;
    }>;
    grounding?: Array<{
        claimId: string;
        sourceId: string;
        weight: number;
        quote?: string;
    }>;
    totalTurns?: number;
}): DefensibleIssue[];
/**
 * Legacy buildIssuesList for backward compatibility
 * Returns simpler issue objects for existing code
 */
export declare function buildIssuesListLegacy(spectral: SpectralReport, claims: Array<Claim & {
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
