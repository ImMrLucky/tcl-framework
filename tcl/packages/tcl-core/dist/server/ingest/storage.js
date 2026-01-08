/**
 * Asset Storage
 * Manages file storage for ingestion jobs
 */
import fs from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';
const fsWriteFile = promisify(fs.writeFile);
const fsUnlink = promisify(fs.unlink);
const fsExists = promisify(fs.exists);
const fsMkdir = promisify(fs.mkdir);
// Storage base directory (can be overridden with env var)
const STORAGE_BASE = process.env.ASSET_STORAGE_BASE || join(tmpdir(), 'tcl-assets');
/**
 * Ensure storage directory exists
 */
async function ensureStorageDir() {
    if (!(await fsExists(STORAGE_BASE))) {
        await fsMkdir(STORAGE_BASE, { recursive: true });
    }
    return STORAGE_BASE;
}
/**
 * Compute SHA256 hash of content
 */
function computeHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}
/**
 * Get MIME type from filename
 */
function getMimeType(filename) {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const mimeTypes = {
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
 * Store an asset file
 */
export async function storeAsset(content, assetType, orgId, jobId, filename, metadata = {}) {
    const baseDir = await ensureStorageDir();
    const contentHash = computeHash(content);
    // Create org/job directory structure
    const orgDir = join(baseDir, orgId);
    const jobDir = join(orgDir, jobId);
    if (!(await fsExists(orgDir))) {
        await fsMkdir(orgDir, { recursive: true });
    }
    if (!(await fsExists(jobDir))) {
        await fsMkdir(jobDir, { recursive: true });
    }
    // Generate storage path
    const ext = filename.split('.').pop() || 'bin';
    const storageFilename = `${assetType.toLowerCase()}_${Date.now()}.${ext}`;
    const storagePath = join(jobDir, storageFilename);
    const storageUrl = storagePath; // For now, local path. Can be S3 URL later
    // Write file
    await fsWriteFile(storagePath, content);
    return {
        id: crypto.randomUUID(),
        storageUrl,
        contentHash,
        mimeType: getMimeType(filename),
        metadata,
    };
}
/**
 * Read an asset file
 */
export async function readAsset(storageUrl) {
    return fs.promises.readFile(storageUrl);
}
/**
 * Delete an asset file
 */
export async function deleteAsset(storageUrl) {
    if (await fsExists(storageUrl)) {
        await fsUnlink(storageUrl);
    }
}
