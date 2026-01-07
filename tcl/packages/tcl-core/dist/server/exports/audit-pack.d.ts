/**
 * Audit Pack Generator
 * Creates defensible export bundles (PDF + JSON + CSV) for compliance
 */
import { SupabaseClient } from '@supabase/supabase-js';
export interface AuditPackOptions {
    evaluationId?: string;
    dateFrom?: string;
    dateTo?: string;
    projectId?: string;
    env?: string;
    includeAllIssues?: boolean;
}
export interface AuditPackResult {
    packId: string;
    downloadUrl: string;
    checksum: string;
    files: {
        pdf: string;
        json: string;
        csv: string;
    };
}
/**
 * Generate audit pack (PDF + JSON + CSV bundle)
 */
export declare function generateAuditPack(options: AuditPackOptions, orgId: string, supabaseAdmin: SupabaseClient): Promise<AuditPackResult>;
