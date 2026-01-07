/**
 * Issue Expansion Module
 *
 * Expands graph edges into enterprise-grade IssueV2 objects.
 * Implements comprehensive issue generation:
 * - A: Contradiction edges → CONTRADICTION issues
 * - B: Unverified claims → UNVERIFIED_CLAIM issues
 * - C: Ungrounded claims → UNGROUNDED issues
 * - D: Risk signals → RISK_SIGNAL issues
 * - E: Policy violations → POLICY issues (if enabled)
 */
import type { Claim, ContradictionEdge, SupportEdge, GroundingEdge, IssueV2 } from '../types.js';
export interface IssueExpansionInput {
    claims: Claim[];
    contradictions: ContradictionEdge[];
    supports: SupportEdge[];
    grounding: GroundingEdge[];
    runId: string;
    conversationId: string;
    evidenceMode: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL';
    audit: {
        engineVersion: string;
        scorerId: string;
        modelFingerprint?: any;
        configHash?: string;
        inputHash?: string;
    };
    spectralResults?: {
        nodeBlameNorm?: Record<string, number>;
        truthStates?: Record<string, string>;
    };
}
export interface IssueExpansionOutput {
    allIssues: IssueV2[];
    issuesByClaim: Record<string, IssueV2[]>;
    issueKeys: Set<string>;
}
/**
 * Main entry point: Expand graph edges into issues
 */
export declare function expandIssueCandidates(input: IssueExpansionInput): IssueExpansionOutput;
