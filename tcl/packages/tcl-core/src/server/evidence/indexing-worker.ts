/**
 * Evidence Indexing Worker
 * Processes evidence items with PENDING index_status and creates chunks + embeddings
 * 
 * Embeddings:
 * - If OPENAI_API_KEY is set: Uses OpenAI for semantic embeddings (paid)
 * - If not set: Uses free hash-based embeddings (keyword similarity, no external service)
 * 
 * Both methods work - semantic embeddings provide better meaning-based search,
 * while hash-based embeddings provide keyword-based matching at no cost.
 */

import { supabaseAdmin } from '../supabase.js';
import { downloadFileFromSupabase } from '../ingest/storage-supabase.js';
import { extractTextFromBuffer } from './extraction.js';
import { chunkText } from './chunking.js';
import { createEmbeddingsBatch } from './embeddings.js';
import { updateIndexingStatus } from './service.js';
import { createHash } from 'crypto';
import fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const fsUnlink = promisify(fs.unlink);
const fsWriteFile = promisify(fs.writeFile);

// Worker state
let isProcessing = false;
let processingInterval: NodeJS.Timeout | null = null;

/**
 * Start the indexing worker (polls every 30 seconds)
 */
export function startIndexingWorker(): void {
  if (processingInterval) {
    console.log('[EvidenceIndexing] Worker already running');
    return;
  }

  console.log('[EvidenceIndexing] Starting evidence indexing worker...');
  
  // Process immediately on start
  processPendingEvidenceItems().catch(err => {
    console.error('[EvidenceIndexing] Error in initial processing:', err);
  });

  // Then poll every 30 seconds
  processingInterval = setInterval(() => {
    processPendingEvidenceItems().catch(err => {
      console.error('[EvidenceIndexing] Error processing pending evidence:', err);
    });
  }, 30000); // 30 seconds
}

/**
 * Stop the indexing worker
 */
export function stopIndexingWorker(): void {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    console.log('[EvidenceIndexing] Worker stopped');
  }
}

/**
 * Process all pending evidence items
 */
async function processPendingEvidenceItems(): Promise<void> {
  if (isProcessing || !supabaseAdmin) {
    return;
  }

  isProcessing = true;

  try {
    // Fetch evidence items with PENDING index_status and APPROVED status
    const { data: pendingItems, error } = await supabaseAdmin
      .from('evidence_items')
      .select('*')
      .eq('index_status', 'PENDING')
      .eq('status', 'APPROVED')
      .limit(10); // Process up to 10 items at a time

    if (error) {
      console.error('[EvidenceIndexing] Error fetching pending items:', error);
      return;
    }

    if (!pendingItems || pendingItems.length === 0) {
      // No pending items
      return;
    }

    console.log(`[EvidenceIndexing] Processing ${pendingItems.length} pending evidence items...`);

    for (const item of pendingItems) {
      try {
        await processEvidenceItem(item);
      } catch (itemError: any) {
        console.error(`[EvidenceIndexing] Error processing evidence item ${item.id}:`, itemError);
        // Mark as failed
        await updateIndexingStatus(
          item.id,
          'FAILED',
          0, // chunkCount
          undefined, // embeddingModel
          itemError.message || 'Unknown error' // indexError
        );
      }
    }
  } catch (error: any) {
    console.error('[EvidenceIndexing] Error in processPendingEvidenceItems:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Process a single evidence item
 */
async function processEvidenceItem(item: any): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  console.log(`[EvidenceIndexing] Processing evidence item: ${item.id} (${item.title})`);

  let fileBuffer: Buffer | null = null;
  let tempFilePath: string | null = null;

  try {
    // Download file if it's a FILE type
    if (item.storage_kind === 'FILE' && item.file_storage_path) {
      try {
        // Download from Supabase Storage
        fileBuffer = await downloadFileFromSupabase('protectqa-evidence', item.file_storage_path);
      } catch (downloadError: any) {
        throw new Error(`Failed to download file: ${downloadError.message}`);
      }
    } else if (item.storage_kind === 'LINK' && item.link_snapshot_storage_path) {
      // Download snapshot if available
      try {
        fileBuffer = await downloadFileFromSupabase('protectqa-evidence', item.link_snapshot_storage_path);
      } catch (downloadError: any) {
        // If snapshot doesn't exist, try to fetch from URL
        if (item.link_url) {
          console.warn(`[EvidenceIndexing] Snapshot not available for ${item.id}, skipping (should be created during upload)`);
          throw new Error('Link snapshot not available');
        }
        throw new Error(`Failed to download snapshot: ${downloadError.message}`);
      }
    } else {
      throw new Error('No file or snapshot available for indexing');
    }

    // Extract text
    const mimeType = item.file_mime_type || 'text/plain';
    const filename = item.file_original_name || item.title || 'unknown';
    const extracted = await extractTextFromBuffer(fileBuffer, mimeType, filename);

    if (!extracted.text || extracted.text.trim().length === 0) {
      throw new Error('No text extracted from file');
    }

    // Chunk text
    const chunks = chunkText(extracted.text, item.id, {
      maxChunkSize: 1000,
      chunkOverlap: 200,
      preserveHeadings: true,
    });

    if (chunks.length === 0) {
      throw new Error('No chunks created from text');
    }

    console.log(`[EvidenceIndexing] Created ${chunks.length} chunks for ${item.id}`);

    // Create embeddings for all chunks
    // Uses OpenAI if OPENAI_API_KEY is set, otherwise uses free hash-based fallback
    const chunkTexts = chunks.map(chunk => chunk.content);
    const embeddings = await createEmbeddingsBatch(chunkTexts, {
      apiKey: process.env.OPENAI_API_KEY, // Optional - system works without it
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', // Only used if API key is set
    });

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`);
    }

    // Store chunks in database
    const chunkRecords = chunks.map((chunk, index) => {
      const embedding = embeddings[index];
      const contentHash = createHash('sha256').update(chunk.content).digest('hex');

      return {
        evidence_item_id: item.id,
        org_id: item.org_id,
        chunk_id: chunk.chunkId,
        content: chunk.content,
        content_hash: contentHash,
        embedding: embedding.embedding, // Stored as JSONB array in PostgreSQL
        metadata: {
          heading: chunk.metadata.heading,
          page: chunk.metadata.page,
          startChar: chunk.metadata.startChar,
          endChar: chunk.metadata.endChar,
        },
      };
    });

    // Insert chunks in batches
    const batchSize = 100;
    for (let i = 0; i < chunkRecords.length; i += batchSize) {
      const batch = chunkRecords.slice(i, i + batchSize);
      const { error: insertError } = await supabaseAdmin
        .from('evidence_chunks')
        .insert(batch);

      if (insertError) {
        throw new Error(`Failed to insert chunks: ${insertError.message}`);
      }
    }

    // Update evidence item status
    const embeddingModel = embeddings[0]?.model || 'unknown';
    await updateIndexingStatus(
      item.id,
      'INDEXED',
      chunks.length, // chunkCount
      embeddingModel, // embeddingModel
      undefined // indexError
    );

    console.log(`[EvidenceIndexing] ✅ Successfully indexed ${item.id}: ${chunks.length} chunks, model: ${embeddingModel}`);
  } catch (error: any) {
    console.error(`[EvidenceIndexing] ❌ Failed to index ${item.id}:`, error);
    throw error;
  } finally {
    // Clean up temp file if created
    if (tempFilePath) {
      try {
        await fsUnlink(tempFilePath);
      } catch (cleanupError) {
        console.warn(`[EvidenceIndexing] Failed to clean up temp file: ${cleanupError}`);
      }
    }
  }
}

