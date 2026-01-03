/**
 * Issue Narrative Builder - Convert clusters into QA-manager-grade IssueNarratives
 *
 * This is the core function that transforms raw analysis into actionable findings.
 * All values come from config - NO HARD-CODED calculations.
 */
import type { Claim } from '../types.js';
import type { IssueNarrative } from './types.js';
import type { Edge } from './types.js';
interface ClaimCluster {
    id: string;
    claimIds: string[];
    edgeIds: string[];
    category: string;
    subcategory?: string;
    turnRange: [number, number];
    contradictionMass: number;
    supportMass: number;
    groundingMass: number;
    topContradictions: Array<{
        claimAId: string;
        claimBId: string;
        score: number;
        edgeId: string;
    }>;
    topUngrounded: string[];
}
/**
 * Build IssueNarrative objects from clusters.
 *
 * This is the main entry point for creating manager-grade findings.
 */
export declare function buildIssueNarratives(clusters: ClaimCluster[], claims: Claim[], edges: Edge[], spectralData?: {
    truthVector?: number[];
    truthStates?: Array<'Supported' | 'Contradicted' | 'Ungrounded' | 'Inconclusive'>;
    nodeBlameNorm?: number[];
    topBadContradictions?: Array<{
        claimA: string;
        claimB: string;
        badness: number;
    }>;
}): IssueNarrative[];
export {};
