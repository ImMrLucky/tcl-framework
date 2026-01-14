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
const fsMkdir = promisify(fs.mkdir);
// fs.exists is deprecated, use fs.promises.access instead
async function fsExists(path) {
    try {
        await fs.promises.access(path);
        return true;
    }
    catch {
        return false;
    }
}
// Storage base directory (can be overridden with env var)
const STORAGE_BASE = process.env.ASSET_STORAGE_BASE || join(tmpdir(), 'tcl-assets');
/**
 * Ensure storage directory exists
 */
async function ensureStorageDir() {
    try {
        if (!(await fsExists(STORAGE_BASE))) {
            await fsMkdir(STORAGE_BASE, { recursive: true });
            console.log(`[Storage] Created storage directory: ${STORAGE_BASE}`);
        }
        return STORAGE_BASE;
    }
    catch (error) {
        console.error(`[Storage] Failed to create storage directory ${STORAGE_BASE}:`, error);
        throw new Error(`Failed to create storage directory: ${error.message}`);
    }
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
    try {
        console.log(`[Storage] Storing asset: type=${assetType}, org=${orgId}, job=${jobId}, filename=${filename}, size=${content.length}`);
        const baseDir = await ensureStorageDir();
        const contentHash = computeHash(content);
        // Create org/job directory structure
        const orgDir = join(baseDir, orgId);
        const jobDir = join(orgDir, jobId);
        try {
            if (!(await fsExists(orgDir))) {
                await fsMkdir(orgDir, { recursive: true });
                console.log(`[Storage] Created org directory: ${orgDir}`);
            }
            if (!(await fsExists(jobDir))) {
                await fsMkdir(jobDir, { recursive: true });
                console.log(`[Storage] Created job directory: ${jobDir}`);
            }
        }
        catch (dirError) {
            console.error(`[Storage] Failed to create directories:`, dirError);
            throw new Error(`Failed to create storage directories: ${dirError.message}`);
        }
        // Generate storage path
        const ext = filename.split('.').pop() || 'bin';
        const storageFilename = `${assetType.toLowerCase()}_${Date.now()}.${ext}`;
        const storagePath = join(jobDir, storageFilename);
        const storageUrl = storagePath; // For now, local path. Can be S3 URL later
        console.log(`[Storage] Writing file to: ${storagePath}`);
        // Write file
        try {
            await fsWriteFile(storagePath, content);
            console.log(`[Storage] File written successfully: ${storagePath}`);
        }
        catch (writeError) {
            console.error(`[Storage] Failed to write file:`, writeError);
            throw new Error(`Failed to write asset file: ${writeError.message}`);
        }
        return {
            id: crypto.randomUUID(),
            storageUrl,
            contentHash,
            mimeType: getMimeType(filename),
            metadata,
        };
    }
    catch (error) {
        console.error(`[Storage] Error storing asset:`, error);
        throw error;
    }
}
/**
 * Read an asset file
 */
export async function readAsset(storageUrl) {
    try {
        return await fs.promises.readFile(storageUrl);
    }
    catch (error) {
        console.error(`[Storage] Failed to read asset from ${storageUrl}:`, error);
        throw new Error(`Failed to read asset: ${error.message}`);
    }
}
/**
 * Delete an asset file
 */
export async function deleteAsset(storageUrl) {
    if (await fsExists(storageUrl)) {
        await fsUnlink(storageUrl);
    }
}
