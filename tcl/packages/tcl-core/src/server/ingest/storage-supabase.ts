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
import { Readable } from 'stream';
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
 * Upload file to Supabase Storage using streaming to avoid OOM errors
 * 
 * Uses Supabase REST API with streaming uploads to avoid loading entire file into memory.
 * This is critical for large audio files on memory-constrained platforms like Railway.
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

  // Verify file exists and get size
  let fileSize: number;
  try {
    const stats = await fs.promises.stat(filePath);
    fileSize = stats.size;
    console.log(`[Storage] Uploading file: ${filePath}, size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  } catch (accessError: any) {
    throw new Error(`STORAGE_FILE_NOT_FOUND: Temp file not found at ${filePath}: ${accessError.message}`);
  }

  // For files > 50MB, use streaming upload via REST API to avoid OOM
  // For smaller files, use the SDK (simpler, but still loads into memory)
  const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB
  
  if (fileSize > LARGE_FILE_THRESHOLD) {
    console.log(`[Storage] Large file detected (${(fileSize / 1024 / 1024).toFixed(2)} MB), using streaming upload`);
    return await uploadFileStreaming(bucket, objectPath, filePath, contentType, fileSize);
  }

  // For smaller files, use SDK (simpler)
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.promises.readFile(filePath);
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
 * Upload large file using Supabase REST API with streaming (avoids OOM)
 */
async function uploadFileStreaming(
  bucket: string,
  objectPath: string,
  filePath: string,
  contentType: string,
  fileSize: number
): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('STORAGE_NOT_CONFIGURED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  // Encode object path for URL
  const encodedPath = encodeURIComponent(objectPath);
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`;

  // Create readable stream from file and convert to Web Stream for fetch
  const fileStream = createReadStream(filePath);
  
  // Convert Node.js Readable stream to Web ReadableStream (Node 18+)
  // This allows streaming uploads without loading entire file into memory
  const webStream = Readable.toWeb(fileStream);

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': contentType,
        'Content-Length': fileSize.toString(),
        'x-upsert': 'false', // Don't overwrite existing files
      },
      body: webStream, // Web ReadableStream is compatible with fetch body in Node 18+
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${errorText}`;
      
      if (response.status === 409 || errorText.includes('already exists')) {
        throw new Error(`STORAGE_FILE_EXISTS: File already exists at ${bucket}/${objectPath}`);
      }
      if (response.status === 404 || errorText.includes('bucket')) {
        throw new Error(`STORAGE_BUCKET_NOT_FOUND: Bucket "${bucket}" does not exist. Please create it in Supabase Storage dashboard.`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(`STORAGE_AUTH_FAILED: Authentication failed. Check SUPABASE_SERVICE_ROLE_KEY is correct and has storage access.`);
      }
      throw new Error(`STORAGE_UPLOAD_FAILED: ${errorMessage} (bucket: ${bucket}, path: ${objectPath})`);
    }

    console.log(`[Storage] Streaming upload successful: ${bucket}/${objectPath}`);
  } catch (error: any) {
    // Clean up stream on error
    fileStream.destroy();
    
    if (error.message.startsWith('STORAGE_')) {
      throw error; // Re-throw our formatted errors
    }
    throw new Error(`STORAGE_UPLOAD_FAILED: ${error.message} (bucket: ${bucket}, path: ${objectPath})`);
  }
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

