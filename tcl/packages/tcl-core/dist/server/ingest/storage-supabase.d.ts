/**
 * Supabase Storage Module
 * Handles streaming uploads to Supabase Storage buckets
 *
 * Features:
 * - Streaming file uploads (no RAM buffering for large files)
 * - SHA-256 computation from file streams
 * - Automatic bucket selection by asset kind
 * - Structured object paths (org/{orgId}/conv/{conversationId}/kind/{assetId}.{ext})
 */
export type AssetKind = 'audio' | 'transcript' | 'evidence' | 'export';
export interface StoredAssetResult {
    assetId: string;
    bucket: string;
    objectPath: string;
    sha256: string;
    sizeBytes: number;
    mimeType: string;
}
export interface StoreUploadedAssetInput {
    kind: AssetKind;
    orgId: string;
    projectId?: string | null;
    conversationId?: string | null;
    jobId?: string;
    uploaderUserId?: string | null;
    filePath: string;
    originalName: string;
}
/**
 * Compute SHA-256 hash from file path (streaming, no RAM buffering)
 */
export declare function computeSha256FromFile(filePath: string): Promise<string>;
/**
 * Get MIME type from filename
 */
export declare function getMimeType(filename: string): string;
/**
 * Upload file to Supabase Storage using streaming to avoid OOM errors
 *
 * Uses Supabase REST API with streaming uploads to avoid loading entire file into memory.
 * This is critical for large audio files on memory-constrained platforms like Railway.
 */
export declare function uploadFileToSupabase({ bucket, objectPath, filePath, contentType, }: {
    bucket: string;
    objectPath: string;
    filePath: string;
    contentType: string;
}): Promise<void>;
/**
 * Store uploaded asset to Supabase Storage and return metadata
 */
export declare function storeUploadedAsset(input: StoreUploadedAssetInput): Promise<StoredAssetResult>;
/**
 * Download file from Supabase Storage
 */
export declare function downloadFileFromSupabase(bucket: string, objectPath: string): Promise<Buffer>;
/**
 * Create a signed URL for temporary access (e.g., for audio playback in UI)
 */
export declare function createSignedUrl(bucket: string, objectPath: string, expiresIn?: number): Promise<string>;
