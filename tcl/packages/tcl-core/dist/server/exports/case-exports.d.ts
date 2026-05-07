/**
 * Case Export Functions
 * Export cases as JSON, PDF, or ZIP
 */
import { supabaseAdmin } from '../supabase.js';
export interface CaseExportData {
    case: any;
    issues: any[];
    decisions: any[];
    signoffs: any[];
    snapshots: any[];
    evaluations: any[];
}
/**
 * Export case as JSON
 */
export declare function exportCaseAsJSON(caseId: string, orgId: string, supabase: typeof supabaseAdmin): Promise<{
    data: string;
    checksum: string;
    filename: string;
}>;
/**
 * Export case as PDF
 */
export declare function exportCaseAsPDF(caseId: string, orgId: string, supabase: typeof supabaseAdmin): Promise<{
    stream: NodeJS.ReadableStream;
    checksum: string;
    filename: string;
}>;
/**
 * Export case as ZIP (includes JSON + PDF + supporting files)
 */
export declare function exportCaseAsZIP(caseId: string, orgId: string, supabase: typeof supabaseAdmin): Promise<{
    stream: NodeJS.ReadableStream;
    checksum: string;
    filename: string;
}>;
