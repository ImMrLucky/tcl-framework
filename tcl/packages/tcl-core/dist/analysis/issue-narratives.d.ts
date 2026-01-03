/**
 * Issue Narrative Builder
 *
 * Converts claims + edges + spectral data into QA-Manager Grade IssueNarratives.
 * All narrative text comes from config templates - NO hard-coded text.
 */
import type { Claim, IssueNarrative, SpectralReport, DestructiveClaim } from "../types.js";
import type { ContradictionEdge, SupportEdge } from "../types.js";
export interface BuildNarrativesInput {
    claims: Claim[];
    contradictions: ContradictionEdge[];
    supports: SupportEdge[];
    grounding: Array<{
        claimId: string;
        sourceId: string;
        weight: number;
        quote?: string;
    }>;
    spectral?: SpectralReport;
    destructiveClaims?: DestructiveClaim[];
    transcript?: string;
}
export interface BuildNarrativesOutput {
    narratives: IssueNarrative[];
    summary: {
        totalIssues: number;
        bySeverity: Record<string, number>;
        byCategory: Record<string, number>;
        topCategories: string[];
    };
}
/**
 * Main entry point: Build issue narratives from claims and edges.
 */
export declare function buildIssueNarratives(input: BuildNarrativesInput): BuildNarrativesOutput;
