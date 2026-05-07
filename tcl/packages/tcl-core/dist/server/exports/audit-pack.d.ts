/**
 * Audit Pack Generator
 * Creates defensible export bundles (PDF + JSON + CSV) for compliance
 */
import { SupabaseClient } from '@supabase/supabase-js';
export type AuditPackPreset = 'AUDIT' | 'LEGAL_HOLD' | 'CUSTOMER_DISPUTE' | 'CUSTOM';
export interface AuditPackOptions {
    evaluationId?: string;
    dateFrom?: string;
    dateTo?: string;
    projectId?: string;
    env?: string;
    includeAllIssues?: boolean;
    preset?: AuditPackPreset;
}
export interface AuditPackResult {
    packId: string;
    pdfUrl: string;
    jsonUrl: string;
    csvUrl: string;
    zipUrl?: string;
    summary?: any;
    checksums: {
        pdf: string;
        json: string;
        csv: string;
        combined: string;
        zip?: string;
    };
}
/**
 * Generate audit pack (PDF + JSON + CSV bundle)
 */
export declare function generateAuditPack(options: AuditPackOptions, orgId: string, supabaseAdmin: SupabaseClient): Promise<AuditPackResult>;
