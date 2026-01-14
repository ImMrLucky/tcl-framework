/**
 * Evidence Storage Module
 * Handles file uploads and link snapshotting for evidence items
 * Part of ProtectQA Evidence/Policy System
 */
export interface StoreEvidenceFileResult {
    storagePath: string;
    sha256: string;
    sizeBytes: number;
    mimeType: string;
}
export interface StoreEvidenceLinkResult {
    url: string;
    fetchedAt: string;
    sha256?: string;
    snapshotStoragePath?: string;
}
/**
 * Store evidence file to Supabase Storage
 * Path structure: org/{orgId}/evidence/{scope}/{evidenceId}.{ext}
 */
export declare function storeEvidenceFile(filePath: string, orgId: string, evidenceId: string, scope: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION', originalName: string): Promise<StoreEvidenceFileResult>;
/**
 * Store evidence file from buffer (for direct uploads)
 */
export declare function storeEvidenceFileFromBuffer(buffer: Buffer, orgId: string, evidenceId: string, scope: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION', originalName: string): Promise<StoreEvidenceFileResult>;
/**
 * Compute SHA-256 hash from buffer
 */
export declare function computeSha256FromBuffer(buffer: Buffer): string;
/**
 * Fetch and snapshot a URL link
 * Returns the snapshot content and metadata
 */
export declare function snapshotEvidenceLink(url: string, orgId: string, evidenceId: string): Promise<StoreEvidenceLinkResult>;
/**
 * Download evidence file from Supabase Storage
 */
export declare function downloadEvidenceFile(storagePath: string): Promise<Buffer>;
/**
 * Get public URL for evidence file (if bucket is public)
 */
export declare function getEvidenceFilePublicUrl(storagePath: string): string | null;
/**
 * Create signed URL for evidence file (for private buckets)
 */
export declare function createEvidenceFileSignedUrl(storagePath: string, expiresIn?: number): Promise<string>;
/**
 * Delete evidence file from Supabase Storage
 */
export declare function deleteEvidenceFile(storagePath: string): Promise<void>;
