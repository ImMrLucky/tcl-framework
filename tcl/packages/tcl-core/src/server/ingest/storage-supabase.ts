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

import fs from 'fs';
import { createReadStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { promisify } from 'util';

const fsUnlink = promisify(fs.unlink);
const fsMkdir = promisify(fs.mkdir);

// Bucket mapping by asset kind
const BUCKET_BY_KIND: Record<string, string> = {
  audio: 'protectqa-audio',
  transcript: 'protectqa-transcripts',
  evidence: 'protectqa-evidence',
  export: 'protectqa-exports',
};

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
export async function computeSha256FromFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
    
    stream.on('error', (error) => {
      reject(new Error(`Failed to compute SHA-256: ${error.message}`));
    });
  });
}

/**
 * Get file size in bytes
 */
async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.promises.stat(filePath);
  return stats.size;
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    // Audio
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    aac: 'audio/aac',
    // Text
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    vtt: 'text/vtt',
    srt: 'text/srt',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Upload file to Supabase Storage
 * 
 * Note: Supabase JS SDK upload() accepts File, Blob, or ArrayBuffer.
 * For streaming, we read the file into a Buffer, but only for the upload operation.
 * The file is already on disk (from multer diskStorage), so we're not buffering from network.
 */
export async function uploadFileToSupabase({
  bucket,
  objectPath,
  filePath,
  contentType,
}: {
  bucket: string;
  objectPath: string;
  filePath: string;
  contentType: string;
}): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('STORAGE_NOT_CONFIGURED: Supabase not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  // Verify file exists
  try {
    await fs.promises.access(filePath);
  } catch (accessError: any) {
    throw new Error(`STORAGE_FILE_NOT_FOUND: Temp file not found at ${filePath}: ${accessError.message}`);
  }

  // Read file into buffer for upload
  // This is acceptable because:
  // 1. File is already on disk (from multer diskStorage)
  // 2. We're not buffering from network stream
  // 3. For very large files, Supabase Storage has its own limits
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.promises.readFile(filePath);
    console.log(`[Storage] Read file: ${filePath}, size: ${fileBuffer.length} bytes`);
  } catch (readError: any) {
    throw new Error(`STORAGE_READ_FAILED: Failed to read file ${filePath}: ${readError.message}`);
  }
  
  console.log(`[Storage] Uploading to Supabase: bucket=${bucket}, path=${objectPath}, contentType=${contentType}`);
  
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, fileBuffer, {
      contentType,
      upsert: false, // Don't overwrite existing files
    });

  if (error) {
    const errorMessage = error.message || 'Unknown error';
    console.error(`[Storage] Upload error:`, {
      message: errorMessage,
      name: (error as any).name,
      bucket,
      objectPath,
    });
    
    // Provide actionable error information
    if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
      throw new Error(`STORAGE_FILE_EXISTS: File already exists at ${bucket}/${objectPath}`);
    }
    if (errorMessage.includes('not found') || errorMessage.includes('bucket') || errorMessage.includes('404')) {
      throw new Error(`STORAGE_BUCKET_NOT_FOUND: Bucket "${bucket}" does not exist. Please create it in Supabase Storage dashboard.`);
    }
    if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('unauthorized') || errorMessage.includes('forbidden')) {
      throw new Error(`STORAGE_AUTH_FAILED: Authentication failed. Check SUPABASE_SERVICE_ROLE_KEY is correct and has storage access.`);
    }
    throw new Error(`STORAGE_UPLOAD_FAILED: ${errorMessage} (bucket: ${bucket}, path: ${objectPath})`);
  }

  console.log(`[Storage] Upload successful: ${bucket}/${objectPath}`);
}

/**
 * Store uploaded asset to Supabase Storage and return metadata
 */
export async function storeUploadedAsset(
  input: StoreUploadedAssetInput
): Promise<StoredAssetResult> {
  const { kind, orgId, conversationId, jobId, filePath, originalName } = input;

  // Validate bucket exists
  const bucket = BUCKET_BY_KIND[kind];
  if (!bucket) {
    throw new Error(`STORAGE_INVALID_KIND: Invalid asset kind "${kind}". Must be one of: audio, transcript, evidence, export`);
  }

  // Generate asset ID and object path
  const assetId = crypto.randomUUID();
  const ext = originalName.split('.').pop() || 'bin';
  
  // Build structured object path: org/{orgId}/conv/{conversationId or jobId}/kind/{assetId}.{ext}
  const conversationOrJob = conversationId || jobId || 'unknown';
  const objectPath = `org/${orgId}/conv/${conversationOrJob}/${kind}/${assetId}.${ext}`;

  // Compute metadata
  const [sha256, sizeBytes] = await Promise.all([
    computeSha256FromFile(filePath),
    getFileSize(filePath),
  ]);
  const mimeType = getMimeType(originalName);

  // Upload to Supabase Storage
  try {
    await uploadFileToSupabase({
      bucket,
      objectPath,
      filePath,
      contentType: mimeType,
    });
  } catch (error: any) {
    // Re-throw with context
    if (error.message.startsWith('STORAGE_')) {
      throw error; // Already has actionable error code
    }
    throw new Error(`STORAGE_UPLOAD_FAILED: ${error.message} (bucket: ${bucket}, path: ${objectPath})`);
  }

  return {
    assetId,
    bucket,
    objectPath,
    sha256,
    sizeBytes,
    mimeType,
  };
}

/**
 * Download file from Supabase Storage
 */
export async function downloadFileFromSupabase(
  bucket: string,
  objectPath: string
): Promise<Buffer> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .download(objectPath);

  if (error) {
    if (error.message.includes('not found')) {
      throw new Error(`STORAGE_FILE_NOT_FOUND: File not found at ${bucket}/${objectPath}`);
    }
    throw new Error(`STORAGE_DOWNLOAD_FAILED: ${error.message} (bucket: ${bucket}, path: ${objectPath})`);
  }

  if (!data) {
    throw new Error(`STORAGE_DOWNLOAD_FAILED: No data returned from ${bucket}/${objectPath}`);
  }

  // Convert Blob to Buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Create a signed URL for temporary access (e.g., for audio playback in UI)
 */
export async function createSignedUrl(
  bucket: string,
  objectPath: string,
  expiresIn: number = 300 // 5 minutes default
): Promise<string> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresIn);

  if (error) {
    throw new Error(`STORAGE_SIGNED_URL_FAILED: ${error.message} (bucket: ${bucket}, path: ${objectPath})`);
  }

  if (!data?.signedUrl) {
    throw new Error(`STORAGE_SIGNED_URL_FAILED: No signed URL returned for ${bucket}/${objectPath}`);
  }

  return data.signedUrl;
}

