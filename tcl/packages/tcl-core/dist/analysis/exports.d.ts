/**
 * Export Functions for Issue Narratives
 *
 * Exports QA-Manager Grade findings in CSV, JSON, and PDF-ready HTML formats.
 */
import type { IssueNarrative } from "../types.js";
export interface IssueNarrativesExport {
    narratives: IssueNarrative[];
    summary: {
        totalIssues: number;
        bySeverity: Record<string, number>;
        byCategory: Record<string, number>;
        topCategories: string[];
    };
    reproducibility?: {
        inputHash: string;
        configHash: string;
        codeVersion: string;
        engineVersion: string;
        modelFingerprint: any;
    };
}
/**
 * Export issue narratives as CSV (one row per issue).
 */
export declare function exportNarrativesAsCSV(exportData: IssueNarrativesExport): string;
/**
 * Export issue narratives as JSON (full audit pack).
 */
export declare function exportNarrativesAsJSON(exportData: IssueNarrativesExport): string;
/**
 * Export issue narratives as HTML report (printable/PDF-ready).
 */
export declare function exportNarrativesAsHTML(exportData: IssueNarrativesExport): string;
