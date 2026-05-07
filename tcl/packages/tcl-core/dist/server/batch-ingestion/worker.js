/**
 * Batch Ingestion Worker
 * Processes batch items asynchronously by creating ingestion jobs
 */
import { supabaseAdmin } from '../supabase.js';
import { createIngestionJob } from '../ingest/jobs.js';
import { enqueueJob } from '../ingest/worker.js';
import { s3Connector } from '../connectors/s3-connector.js';
import { dropboxConnector } from '../connectors/dropbox-connector.js';
import { gdriveConnector } from '../connectors/gdrive-connector.js';
import { decryptSecret } from '../security/secret-crypto.js';
import { ensureDropboxAccessToken, ensureGDriveAccessToken } from '../connectors/token-refresh.js';
// In-memory batch processing queue
const batchQueue = [];
let isProcessingBatch = false;
/**
 * Enqueue a batch for processing
 */
export async function enqueueBatch(batchId) {
    if (!batchQueue.includes(batchId)) {
        batchQueue.push(batchId);
    }
    // Start processing if not already running
    if (!isProcessingBatch) {
        processBatchQueue().catch(err => {
            console.error('Batch queue processing error:', err);
            isProcessingBatch = false;
        });
    }
}
/**
 * Process batches from the queue
 */
async function processBatchQueue() {
    if (isProcessingBatch)
        return;
    isProcessingBatch = true;
    while (batchQueue.length > 0) {
        const batchId = batchQueue.shift();
        if (!batchId)
            break;
        try {
            await processBatch(batchId);
        }
        catch (error) {
            console.error(`Error processing batch ${batchId}:`, error);
            await updateBatchStatus(batchId, 'FAILED', {
                error: error.message || 'Unknown error',
            });
        }
    }
    isProcessingBatch = false;
}
/**
 * Process a single batch
 */
async function processBatch(batchId) {
    if (!supabaseAdmin) {
        throw new Error('Database not configured');
    }
    // Get batch
    const { data: batch, error: batchError } = await supabaseAdmin
        .from('ingestion_batches')
        .select('*')
        .eq('id', batchId)
        .single();
    if (batchError || !batch) {
        throw new Error('Batch not found');
    }
    // Update batch status to RUNNING
    await updateBatchStatus(batchId, 'RUNNING');
    // Get ready items
    const { data: items, error: itemsError } = await supabaseAdmin
        .from('ingestion_batch_items')
        .select('*')
        .eq('batch_id', batchId)
        .eq('status', 'READY')
        .order('created_at', { ascending: true });
    if (itemsError) {
        throw new Error(`Failed to fetch batch items: ${itemsError.message}`);
    }
    if (!items || items.length === 0) {
        // No items to process, mark batch as complete
        await updateBatchStatus(batchId, 'COMPLETE');
        return;
    }
    // Process items (with concurrency limit)
    const concurrency = parseInt(process.env.BATCH_INGESTION_CONCURRENCY || '3');
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency) {
        chunks.push(items.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
        await Promise.all(chunk.map(item => processBatchItem(batch, item)));
        await updateBatchProgress(batchId);
    }
    // Check if all items are complete
    const { data: remainingItems } = await supabaseAdmin
        .from('ingestion_batch_items')
        .select('id')
        .eq('batch_id', batchId)
        .in('status', ['READY', 'PROCESSING', 'UPLOADING']);
    if (!remainingItems || remainingItems.length === 0) {
        await updateBatchStatus(batchId, 'COMPLETE');
    }
}
/**
 * Process a single batch item
 */
async function processBatchItem(batch, item) {
    if (!supabaseAdmin) {
        throw new Error('Database not configured');
    }
    try {
        // Update item status to PROCESSING
        await supabaseAdmin
            .from('ingestion_batch_items')
            .update({
            status: 'PROCESSING',
            started_at: new Date().toISOString(),
        })
            .eq('id', item.id);
        const sourceRef = item.source_ref || {};
        const sourceType = batch.source_type;
        // Handle different source types
        if (sourceType === 'UPLOAD') {
            // For uploads, items should already have job_id set
            // Just enqueue the job
            if (item.job_id) {
                await enqueueJob(item.job_id);
                await supabaseAdmin
                    .from('ingestion_batch_items')
                    .update({
                    status: 'COMPLETE',
                    completed_at: new Date().toISOString(),
                })
                    .eq('id', item.id);
            }
            else {
                throw new Error('Upload item missing job_id');
            }
        }
        else if (sourceType === 'S3' || sourceType === 'DROPBOX' || sourceType === 'GDRIVE') {
            // For connectors, fetch the file and create an ingestion job
            await processConnectorItem(batch, item, sourceRef);
        }
        else {
            throw new Error(`Unsupported source type: ${sourceType}`);
        }
    }
    catch (error) {
        console.error(`Error processing batch item ${item.id}:`, error);
        // Update item status to FAILED
        await supabaseAdmin
            .from('ingestion_batch_items')
            .update({
            status: 'FAILED',
            error_message: error.message || 'Unknown error',
            completed_at: new Date().toISOString(),
        })
            .eq('id', item.id);
        // Increment retry count and schedule retry if needed
        const retryCount = (item.retry_count || 0) + 1;
        const maxRetries = parseInt(process.env.BATCH_ITEM_MAX_RETRIES || '3');
        if (retryCount < maxRetries) {
            // Schedule retry (exponential backoff)
            const retryDelay = Math.min(1000 * Math.pow(2, retryCount - 1), 300000); // Max 5 minutes
            const retryAt = new Date(Date.now() + retryDelay).toISOString();
            await supabaseAdmin
                .from('ingestion_batch_items')
                .update({
                retry_count: retryCount,
                retry_at: retryAt,
                status: 'PENDING', // Reset to pending for retry
            })
                .eq('id', item.id);
        }
    }
}
/**
 * Process a connector item (S3, Dropbox, GDrive)
 */
async function processConnectorItem(batch, item, sourceRef) {
    if (!supabaseAdmin) {
        throw new Error('Database not configured');
    }
    // Get connector provider
    const connector = getConnectorProvider(batch.source_type);
    if (!connector) {
        throw new Error(`Connector not available for source type: ${batch.source_type}`);
    }
    // Get connector config and secrets
    const config = batch.config_json || {};
    let secrets = await getConnectorSecrets(batch.org_id, batch.source_type, supabaseAdmin);
    if (!secrets) {
        throw new Error(`Connector secrets not found for ${batch.source_type}`);
    }
    // For OAuth connectors, ensure fresh token
    const sourceTypeUpper = batch.source_type.toUpperCase();
    if (sourceTypeUpper === 'DROPBOX') {
        const freshToken = await ensureDropboxAccessToken(batch.org_id);
        if (!freshToken) {
            throw new Error('Dropbox connection expired. Please reconnect.');
        }
        secrets = { ...secrets, accessToken: freshToken.accessToken };
    }
    else if (sourceTypeUpper === 'GDRIVE') {
        const freshToken = await ensureGDriveAccessToken(batch.org_id);
        if (!freshToken) {
            throw new Error('Google Drive connection expired. Please reconnect.');
        }
        secrets = { ...secrets, accessToken: freshToken.accessToken };
    }
    // Fetch the file from connector
    const fetchResult = await connector.fetchObject(sourceRef.path || sourceRef.id, config, secrets);
    // Create ingestion job
    // Get representativeId from batch config (default representative for all items)
    const representativeId = config?.representativeId || null;
    const jobId = await createIngestionJob(batch.org_id, batch.project_id || null, batch.env, batch.created_by_user_id, item.mode || 'AUDIO_PLUS_TRANSCRIPT', item.title, item.channel || null, representativeId);
    // Upload file to Supabase Storage
    // TODO: Implement file upload to Supabase Storage from stream
    // For now, we'll need to buffer the stream and upload it
    // This is a placeholder - actual implementation would:
    // 1. Read stream into buffer
    // 2. Upload to Supabase Storage
    // 3. Create asset record
    // 4. Link asset to job
    // Update item with job_id
    await supabaseAdmin
        .from('ingestion_batch_items')
        .update({
        job_id: jobId,
        status: 'COMPLETE',
        completed_at: new Date().toISOString(),
    })
        .eq('id', item.id);
    // Enqueue the job for processing
    await enqueueJob(jobId);
}
/**
 * Get connector provider by source type
 */
function getConnectorProvider(sourceType) {
    switch (sourceType.toUpperCase()) {
        case 'S3':
            return s3Connector;
        case 'DROPBOX':
            return dropboxConnector;
        case 'GDRIVE':
            return gdriveConnector;
        default:
            return null;
    }
}
/**
 * Get connector secrets from database
 */
async function getConnectorSecrets(orgId, sourceType, supabase) {
    const { data: secrets, error } = await supabase
        .from('integration_secrets')
        .select('key, ciphertext')
        .eq('org_id', orgId)
        .eq('integration_kind', sourceType.toUpperCase())
        .in('key', ['accessKeyId', 'secretAccessKey', 'accessToken', 'refreshToken', 'clientId', 'clientSecret']);
    if (error || !secrets || secrets.length === 0) {
        return null;
    }
    const secretsMap = {};
    for (const secret of secrets) {
        try {
            secretsMap[secret.key] = decryptSecret(secret.ciphertext);
        }
        catch (decryptError) {
            console.error(`Failed to decrypt secret ${secret.key}:`, decryptError);
            // Continue - will fail when connector tries to use it
        }
    }
    return secretsMap;
}
/**
 * Update batch status
 */
async function updateBatchStatus(batchId, status, updates) {
    if (!supabaseAdmin)
        return;
    const updateData = {
        status,
        updated_at: new Date().toISOString(),
    };
    if (status === 'RUNNING' && !updates?.started_at) {
        updateData.started_at = new Date().toISOString();
    }
    if (status === 'COMPLETE' || status === 'FAILED' || status === 'CANCELED') {
        updateData.completed_at = new Date().toISOString();
    }
    if (updates) {
        Object.assign(updateData, updates);
    }
    await supabaseAdmin
        .from('ingestion_batches')
        .update(updateData)
        .eq('id', batchId);
}
/**
 * Update batch progress
 */
async function updateBatchProgress(batchId) {
    if (!supabaseAdmin)
        return;
    // Count items by status
    const { data: items } = await supabaseAdmin
        .from('ingestion_batch_items')
        .select('status')
        .eq('batch_id', batchId);
    if (!items)
        return;
    const progress = {
        total: items.length,
        queued: items.filter(i => i.status === 'PENDING' || i.status === 'READY').length,
        running: items.filter(i => i.status === 'PROCESSING' || i.status === 'UPLOADING').length,
        complete: items.filter(i => i.status === 'COMPLETE').length,
        failed: items.filter(i => i.status === 'FAILED').length,
    };
    await supabaseAdmin
        .from('ingestion_batches')
        .update({
        progress_json: progress,
    })
        .eq('id', batchId);
}
/**
 * Process retry queue (items scheduled for retry)
 */
export async function processRetryQueue() {
    if (!supabaseAdmin)
        return;
    const now = new Date().toISOString();
    // Find items ready for retry
    const { data: retryItems } = await supabaseAdmin
        .from('ingestion_batch_items')
        .select('batch_id')
        .eq('status', 'PENDING')
        .not('retry_at', 'is', null)
        .lte('retry_at', now);
    if (!retryItems || retryItems.length === 0)
        return;
    // Get unique batch IDs
    const batchIds = [...new Set(retryItems.map(item => item.batch_id))];
    // Enqueue batches for processing
    for (const batchId of batchIds) {
        await enqueueBatch(batchId);
    }
}
// Start retry queue processor (runs every 30 seconds)
if (typeof setInterval !== 'undefined') {
    setInterval(() => {
        processRetryQueue().catch(err => {
            console.error('Retry queue processing error:', err);
        });
    }, 30000);
}
