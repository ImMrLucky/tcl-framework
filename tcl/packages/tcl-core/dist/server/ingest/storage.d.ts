/**
 * Asset Storage
 * Manages file storage for ingestion jobs
 */
export type AssetType = 'AUDIO' | 'TRANSCRIPT_UPLOADED' | 'TRANSCRIPT_ASR' | 'TRANSCRIPT_NORMALIZED';
export interface AssetMetadata {
    durationMs?: number;
    language?: string;
    segmentsCount?: number;
    [key: string]: any;
}
export interface StoredAsset {
    id: string;
    storageUrl: string;
    contentHash: string;
    mimeType: string;
    metadata: AssetMetadata;
}
/**
 * Store an asset file
 */
export declare function storeAsset(content: Buffer, assetType: AssetType, orgId: string, jobId: string, filename: string, metadata?: AssetMetadata): Promise<StoredAsset>;
/**
 * Read an asset file
 */
export declare function readAsset(storageUrl: string): Promise<Buffer>;
/**
 * Delete an asset file
 */
export declare function deleteAsset(storageUrl: string): Promise<void>;
