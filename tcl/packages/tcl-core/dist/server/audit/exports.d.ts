import type { SupabaseClient } from "@supabase/supabase-js";
/**
 * Export Claims CSV
 */
export declare function exportClaimsCSV(evaluationId: string, orgId: string, projectId: string, env: string, supabaseAdmin: SupabaseClient): Promise<{
    artifactId: string;
    downloadUrl: string;
    checksum: string;
}>;
/**
 * Export Run JSON Bundle
 */
export declare function exportRunJSON(evaluationId: string, orgId: string, projectId: string, env: string, supabaseAdmin: SupabaseClient): Promise<{
    artifactId: string;
    downloadUrl: string;
    checksum: string;
}>;
/**
 * Export Single Issue PDF
 */
export declare function exportIssuePDF(evaluationId: string, claimId: string, orgId: string, projectId: string, env: string, supabaseAdmin: SupabaseClient): Promise<{
    artifactId: string;
    downloadUrl: string;
    checksum: string;
}>;
