/**
 * Issue Analyzer
 *
 * Main entry point for generating manager-grade QA deliverables.
 * Orchestrates: extraction → clustering → scoring → narrative → export
 */
import type { IssueAnalysisOutput } from "./types.js";
import { type RiskModelConfig } from "../config/risk.model.js";
import type { Claim, ContradictionEdge, SupportEdge, GroundingEdge } from "../types.js";
export interface AnalyzeInput {
    /** Raw transcript text */
    transcript: string;
    /** Pre-extracted claims (from existing pipeline) */
    claims: Claim[];
    /** Edges from existing pipeline */
    edges: {
        contradictions: ContradictionEdge[];
        supports: SupportEdge[];
        grounding: GroundingEdge[];
    };
    /** Optional config override */
    config?: Partial<RiskModelConfig>;
}
/**
 * Main entry point: analyze claims and generate manager-grade output.
 */
export declare function analyzeForIssues(input: AnalyzeInput): IssueAnalysisOutput;
/**
 * Export issues as JSON (for analytics).
 */
export declare function exportAsJSON(output: IssueAnalysisOutput): string;
/**
 * Export issues as CSV (one row per issue).
 */
export declare function exportAsCSV(output: IssueAnalysisOutput): string;
/**
 * Export as HTML report (printable/PDF-ready).
 */
export declare function exportAsHTML(output: IssueAnalysisOutput): string;
