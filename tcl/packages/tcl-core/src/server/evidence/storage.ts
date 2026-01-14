/**
 * Evidence Storage Module
 * Handles file uploads and link snapshotting for evidence items
 * Part of ProtectQA Evidence/Policy System
 */

import fs from 'fs';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { 
  computeSha256FromFile, 
  uploadFileToSupabase,
  getMimeType 
} from '../ingest/storage-supabase.js';
import { promisify } from 'util';

const fsUnlink = promisify(fs.unlink);
const fsWriteFile = promisify(fs.writeFile);
const fsMkdir = promisify(fs.mkdir);

const EVIDENCE_BUCKET = 'protectqa-evidence';

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
export async function storeEvidenceFile(
  filePath: string,
  orgId: string,
  evidenceId: string,
  scope: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION',
  originalName: string
): Promise<StoreEvidenceFileResult> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  // Get file metadata
  const stats = await fs.promises.stat(filePath);
  const sizeBytes = stats.size;
  
  // Compute SHA-256 hash
  const sha256 = await computeSha256FromFile(filePath);
  
  // Get MIME type
  const mimeType = getMimeType(originalName);
  
  // Generate storage path
  const ext = originalName.split('.').pop() || 'bin';
  const storagePath = `org/${orgId}/evidence/${scope.toLowerCase()}/${evidenceId}.${ext}`;
  
  // Upload to Supabase Storage
  await uploadFileToSupabase({
    bucket: EVIDENCE_BUCKET,
    objectPath: storagePath,
    filePath,
    contentType: mimeType,
  });
  
  return {
    storagePath,
    sha256,
    sizeBytes,
    mimeType,
  };
}

/**
 * Store evidence file from buffer (for direct uploads)
 */
export async function storeEvidenceFileFromBuffer(
  buffer: Buffer,
  orgId: string,
  evidenceId: string,
  scope: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION',
  originalName: string
): Promise<StoreEvidenceFileResult> {
  // Write buffer to temp file
  const tempDir = join(tmpdir(), 'evidence-uploads');
  await fsMkdir(tempDir, { recursive: true });
  
  const tempFilePath = join(tempDir, `${evidenceId}-${Date.now()}`);
  
  try {
    await fsWriteFile(tempFilePath, buffer);
    
    // Use file-based storage function
    const result = await storeEvidenceFile(
      tempFilePath,
      orgId,
      evidenceId,
      scope,
      originalName
    );
    
    return result;
  } finally {
    // Clean up temp file
    try {
      await fsUnlink(tempFilePath);
    } catch (err) {
      console.warn('Failed to clean up temp file:', err);
    }
  }
}

/**
 * Compute SHA-256 hash from buffer
 */
export function computeSha256FromBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Fetch and snapshot a URL link
 * Returns the snapshot content and metadata
 */
export async function snapshotEvidenceLink(
  url: string,
  orgId: string,
  evidenceId: string
): Promise<StoreEvidenceLinkResult> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const fetchedAt = new Date().toISOString();
  
  try {
    // Fetch the URL
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ProtectQA-Evidence-Snapshot/1.0',
      },
      // Timeout after 30 seconds
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: HTTP ${response.status} ${response.statusText}`);
    }
    
    // Get content type
    const contentType = response.headers.get('content-type') || 'text/html';
    
    // Read response body
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Compute SHA-256
    const sha256 = computeSha256FromBuffer(buffer);
    
    // Determine file extension from content type or URL
    let ext = 'html';
    if (contentType.includes('pdf')) {
      ext = 'pdf';
    } else if (contentType.includes('json')) {
      ext = 'json';
    } else if (contentType.includes('xml')) {
      ext = 'xml';
    } else if (contentType.includes('text/plain')) {
      ext = 'txt';
    } else {
      // Try to get extension from URL
      const urlMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
      if (urlMatch) {
        ext = urlMatch[1].toLowerCase();
      }
    }
    
    // Store snapshot in Supabase Storage
    const snapshotPath = `org/${orgId}/evidence/snapshots/${evidenceId}.${ext}`;
    
    // Write to temp file first (for streaming upload)
    const tempDir = join(tmpdir(), 'evidence-snapshots');
    await fsMkdir(tempDir, { recursive: true });
    const tempFilePath = join(tempDir, `${evidenceId}-${Date.now()}.${ext}`);
    
    try {
      await fsWriteFile(tempFilePath, buffer);
      
      // Upload snapshot
      await uploadFileToSupabase({
        bucket: EVIDENCE_BUCKET,
        objectPath: snapshotPath,
        filePath: tempFilePath,
        contentType: contentType,
      });
      
      return {
        url,
        fetchedAt,
        sha256,
        snapshotStoragePath: snapshotPath,
      };
    } finally {
      // Clean up temp file
      try {
        await fsUnlink(tempFilePath);
      } catch (err) {
        console.warn('Failed to clean up temp snapshot file:', err);
      }
    }
  } catch (error: any) {
    // If snapshotting fails, still return the link info (without snapshot)
    console.warn(`Failed to snapshot URL ${url}:`, error.message);
    
    return {
      url,
      fetchedAt,
      // No sha256 or snapshotStoragePath if fetch failed
    };
  }
}

/**
 * Download evidence file from Supabase Storage
 */
export async function downloadEvidenceFile(
  storagePath: string
): Promise<Buffer> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin.storage
    .from(EVIDENCE_BUCKET)
    .download(storagePath);
  
  if (error) {
    throw new Error(`Failed to download evidence file: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('No data returned from storage download');
  }
  
  // Convert Blob to Buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get public URL for evidence file (if bucket is public)
 */
export function getEvidenceFilePublicUrl(storagePath: string): string | null {
  if (!supabaseAdmin) {
    return null;
  }
  
  const { data } = supabaseAdmin.storage
    .from(EVIDENCE_BUCKET)
    .getPublicUrl(storagePath);
  
  return data?.publicUrl || null;
}

/**
 * Create signed URL for evidence file (for private buckets)
 */
export async function createEvidenceFileSignedUrl(
  storagePath: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<string> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  
  if (error) {
    throw new Error(`Failed to create signed URL: ${error.message}`);
  }
  
  if (!data?.signedUrl) {
    throw new Error('No signed URL returned');
  }
  
  return data.signedUrl;
}

/**
 * Delete evidence file from Supabase Storage
 */
export async function deleteEvidenceFile(storagePath: string): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabaseAdmin.storage
    .from(EVIDENCE_BUCKET)
    .remove([storagePath]);
  
  if (error) {
    throw new Error(`Failed to delete evidence file: ${error.message}`);
  }
}

