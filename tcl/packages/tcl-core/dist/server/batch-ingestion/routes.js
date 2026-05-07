import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { enqueueBatch } from './worker.js';
/**
 * Setup batch ingestion API routes
 */
export function setupBatchIngestionRoutes(app) {
    // ============================================================================
    // POST /api/ingest/batch/create - Create batch
    // ============================================================================
    app.post('/api/ingest/batch/create', requireEntitlement('batchIngestion'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { sourceType, config, items } = req.body;
            if (!sourceType) {
                return res.status(400).json({ error: 'sourceType is required' });
            }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'items array is required and must not be empty' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Create batch
            const { data: batch, error: batchError } = await supabaseAdmin
                .from('ingestion_batches')
                .insert({
                org_id: context.orgId,
                project_id: config?.projectId || context.projectId || null,
                env: config?.env || context.env || 'sandbox',
                created_by_user_id: context.userId,
                source_type: sourceType,
                status: 'CREATED',
                config_json: config || {},
                progress_json: {
                    total: items.length,
                    queued: 0,
                    running: 0,
                    complete: 0,
                    failed: 0,
                },
            })
                .select()
                .single();
            if (batchError) {
                return res.status(500).json({ error: `Failed to create batch: ${batchError.message}` });
            }
            // Create batch items
            const batchItems = items.map((item) => ({
                batch_id: batch.id,
                status: 'PENDING',
                mode: item.mode || 'AUDIO_PLUS_TRANSCRIPT',
                title: item.title || item.name || 'Untitled',
                channel: item.channel || null,
                source_ref: item.sourceRef || {},
            }));
            const { data: createdItems, error: itemsError } = await supabaseAdmin
                .from('ingestion_batch_items')
                .insert(batchItems)
                .select();
            if (itemsError) {
                // Rollback batch if items creation fails
                await supabaseAdmin.from('ingestion_batches').delete().eq('id', batch.id);
                return res.status(500).json({ error: `Failed to create batch items: ${itemsError.message}` });
            }
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: 'batch_ingestion.create',
                targetType: 'ingestion_batch',
                targetId: batch.id,
                meta: {
                    sourceType,
                    itemCount: items.length,
                },
            });
            res.json({
                success: true,
                batch: {
                    ...batch,
                    itemCount: createdItems?.length || 0,
                },
            });
        }
        catch (error) {
            console.error('Create batch error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // GET /api/ingest/batch/scheduled - Info endpoint for scheduled ingestion
    // ============================================================================
    app.get('/api/ingest/batch/scheduled', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            // Return information about scheduled ingestion endpoints
            res.json({
                message: 'Scheduled ingestion is available through the following endpoints',
                endpoints: {
                    sources: {
                        list: 'GET /api/ingest/sources',
                        create: 'POST /api/ingest/sources',
                        test: 'POST /api/ingest/sources/:id/test'
                    },
                    schedules: {
                        list: 'GET /api/ingest/schedules',
                        create: 'POST /api/ingest/schedules',
                        update: 'PATCH /api/ingest/schedules/:id',
                        runs: 'GET /api/ingest/schedules/:id/runs'
                    }
                },
                documentation: 'See /api/ingest/sources and /api/ingest/schedules for scheduled ingestion management'
            });
        }
        catch (error) {
            console.error('Get scheduled info error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // GET /api/ingest/batch/:id - Get batch details
    // ============================================================================
    app.get('/api/ingest/batch/:id', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { id } = req.params;
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { data: batch, error: batchError } = await supabaseAdmin
                .from('ingestion_batches')
                .select('*')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (batchError || !batch) {
                return res.status(404).json({ error: 'Batch not found' });
            }
            // Get batch items
            const { data: items, error: itemsError } = await supabaseAdmin
                .from('ingestion_batch_items')
                .select('*')
                .eq('batch_id', id)
                .order('created_at', { ascending: true });
            if (itemsError) {
                console.error('Failed to fetch batch items:', itemsError);
            }
            res.json({
                batch: {
                    ...batch,
                    config_json: batch.config_json || {},
                    progress_json: batch.progress_json || {},
                },
                items: items || [],
                itemCount: (items || []).length,
            });
        }
        catch (error) {
            console.error('Get batch error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // POST /api/ingest/batch/:id/start - Start batch processing
    // ============================================================================
    app.post('/api/ingest/batch/:id/start', requireEntitlement('batchIngestion'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { id } = req.params;
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Verify batch exists and belongs to org
            const { data: batch, error: batchError } = await supabaseAdmin
                .from('ingestion_batches')
                .select('*')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (batchError || !batch) {
                return res.status(404).json({ error: 'Batch not found' });
            }
            if (batch.status !== 'CREATED' && batch.status !== 'QUEUED') {
                return res.status(400).json({ error: `Batch cannot be started. Current status: ${batch.status}` });
            }
            // Update batch status to QUEUED
            const { data: updatedBatch, error: updateError } = await supabaseAdmin
                .from('ingestion_batches')
                .update({
                status: 'QUEUED',
                started_at: new Date().toISOString(),
            })
                .eq('id', id)
                .select()
                .single();
            if (updateError) {
                return res.status(500).json({ error: `Failed to start batch: ${updateError.message}` });
            }
            // Get pending items
            const { data: pendingItems } = await supabaseAdmin
                .from('ingestion_batch_items')
                .select('*')
                .eq('batch_id', id)
                .eq('status', 'PENDING');
            // Update items to QUEUED status
            if (pendingItems && pendingItems.length > 0) {
                await supabaseAdmin
                    .from('ingestion_batch_items')
                    .update({ status: 'READY' })
                    .eq('batch_id', id)
                    .eq('status', 'PENDING');
            }
            // Trigger background worker to process batch items
            await enqueueBatch(id);
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: 'batch_ingestion.start',
                targetType: 'ingestion_batch',
                targetId: id,
            });
            res.json({ success: true, batch: updatedBatch });
        }
        catch (error) {
            console.error('Start batch error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // POST /api/ingest/batch/:id/cancel - Cancel batch
    // ============================================================================
    app.post('/api/ingest/batch/:id/cancel', requireEntitlement('batchIngestion'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { id } = req.params;
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Verify batch exists and belongs to org
            const { data: batch } = await supabaseAdmin
                .from('ingestion_batches')
                .select('id, status')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (!batch) {
                return res.status(404).json({ error: 'Batch not found' });
            }
            if (batch.status === 'COMPLETE' || batch.status === 'CANCELED') {
                return res.status(400).json({ error: `Batch cannot be canceled. Current status: ${batch.status}` });
            }
            // Update batch status to CANCELED
            const { error: updateError } = await supabaseAdmin
                .from('ingestion_batches')
                .update({
                status: 'CANCELED',
                completed_at: new Date().toISOString(),
            })
                .eq('id', id);
            if (updateError) {
                return res.status(500).json({ error: `Failed to cancel batch: ${updateError.message}` });
            }
            // Cancel pending/queued items
            await supabaseAdmin
                .from('ingestion_batch_items')
                .update({ status: 'SKIPPED' })
                .eq('batch_id', id)
                .in('status', ['PENDING', 'READY', 'UPLOADING']);
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: 'batch_ingestion.cancel',
                targetType: 'ingestion_batch',
                targetId: id,
            });
            res.json({ success: true });
        }
        catch (error) {
            console.error('Cancel batch error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // GET /api/ingest/batch/:id/items - Get batch items
    // ============================================================================
    app.get('/api/ingest/batch/:id/items', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { id } = req.params;
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const offset = parseInt(req.query.offset) || 0;
            const status = req.query.status;
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Verify batch belongs to org
            const { data: batch } = await supabaseAdmin
                .from('ingestion_batches')
                .select('id')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (!batch) {
                return res.status(404).json({ error: 'Batch not found' });
            }
            let query = supabaseAdmin
                .from('ingestion_batch_items')
                .select('*', { count: 'exact' })
                .eq('batch_id', id)
                .order('created_at', { ascending: true })
                .range(offset, offset + limit - 1);
            if (status) {
                query = query.eq('status', status);
            }
            const { data: items, error: itemsError, count } = await query;
            if (itemsError) {
                return res.status(500).json({ error: `Failed to fetch batch items: ${itemsError.message}` });
            }
            res.json({
                items: items || [],
                total: count || 0,
                limit,
                offset,
            });
        }
        catch (error) {
            console.error('Get batch items error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
}
