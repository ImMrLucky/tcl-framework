/**
 * Integration Connections Management
 * Handles connection configuration for cloud storage and batch upload integrations
 */
import { supabaseAdmin, logAudit } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { Capability } from '../plans/capabilities.js';
import { requireCapability } from '../plans/capability-middleware.js';
// Available integration types with metadata
export const INTEGRATION_TYPES = [
    {
        type: 'S3',
        name: 'Amazon S3',
        description: 'Connect to S3 buckets for automatic file ingestion',
        comingSoon: true,
    },
    {
        type: 'GDRIVE',
        name: 'Google Drive',
        description: 'Connect to Google Drive folders for automatic file ingestion',
        comingSoon: true,
    },
    {
        type: 'DROPBOX',
        name: 'Dropbox',
        description: 'Connect to Dropbox folders for automatic file ingestion',
        comingSoon: true,
    },
    {
        type: 'SHAREPOINT',
        name: 'Microsoft SharePoint',
        description: 'Connect to SharePoint sites for automatic file ingestion',
        comingSoon: true,
    },
    {
        type: 'BATCH_UPLOAD',
        name: 'Batch Upload',
        description: 'Configure batch file uploads via API',
        comingSoon: false, // This one might be implemented
    },
];
export function setupIntegrationConnectionsRoutes(app) {
    // ============================================================================
    // GET /api/integrations - List available types and existing connections
    // ============================================================================
    app.get('/api/integrations', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get existing connections for this org
            const { data: connections, error } = await supabaseAdmin
                .from('integration_connections')
                .select('id, org_id, type, status, config_json, error_message, created_at, updated_at, last_sync_at')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            // Map database rows to API format
            const connectionMap = new Map();
            (connections || []).forEach((c) => {
                const typeInfo = INTEGRATION_TYPES.find(t => t.type === c.type);
                connectionMap.set(c.type, {
                    id: c.id,
                    orgId: c.org_id,
                    type: c.type,
                    status: c.status,
                    config: c.config_json || {},
                    errorMessage: c.error_message || undefined,
                    createdAt: c.created_at,
                    updatedAt: c.updated_at,
                    lastSyncAt: c.last_sync_at || undefined,
                    comingSoon: typeInfo?.comingSoon || false,
                });
            });
            // Build response with all types and their connection status
            const response = {
                availableTypes: INTEGRATION_TYPES.map(typeInfo => ({
                    type: typeInfo.type,
                    name: typeInfo.name,
                    description: typeInfo.description,
                    comingSoon: typeInfo.comingSoon,
                    connection: connectionMap.get(typeInfo.type) || null,
                })),
                connections: Array.from(connectionMap.values()),
            };
            res.json(response);
        }
        catch (e) {
            console.error('List integrations error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/integrations/connect - Create or update connection
    // ============================================================================
    app.post('/api/integrations/connect', requireCapability(Capability.CLOUD_CONNECTORS), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { type, config } = req.body;
            if (!type || !INTEGRATION_TYPES.find(t => t.type === type)) {
                return res.status(400).json({ error: 'Invalid integration type' });
            }
            if (!config || typeof config !== 'object') {
                return res.status(400).json({ error: 'config is required and must be an object' });
            }
            const typeInfo = INTEGRATION_TYPES.find(t => t.type === type);
            if (typeInfo?.comingSoon) {
                return res.status(400).json({
                    error: 'This integration is not yet implemented',
                    comingSoon: true,
                    type: type,
                });
            }
            // Check if connection already exists
            const { data: existing, error: fetchError } = await supabaseAdmin
                .from('integration_connections')
                .select('id')
                .eq('org_id', context.orgId)
                .eq('type', type)
                .maybeSingle();
            let connectionId;
            let connection;
            if (existing) {
                // Update existing connection
                const { data: updated, error: updateError } = await supabaseAdmin
                    .from('integration_connections')
                    .update({
                    status: 'CONNECTED',
                    config_json: config,
                    error_message: null,
                    updated_at: new Date().toISOString(),
                })
                    .eq('id', existing.id)
                    .eq('org_id', context.orgId)
                    .select('id, org_id, type, status, config_json, error_message, created_at, updated_at, last_sync_at')
                    .single();
                if (updateError) {
                    return res.status(500).json({ error: updateError.message });
                }
                connectionId = updated.id;
                connection = {
                    id: updated.id,
                    orgId: updated.org_id,
                    type: updated.type,
                    status: updated.status,
                    config: updated.config_json || {},
                    errorMessage: updated.error_message || undefined,
                    createdAt: updated.created_at,
                    updatedAt: updated.updated_at,
                    lastSyncAt: updated.last_sync_at || undefined,
                    comingSoon: false,
                };
            }
            else {
                // Create new connection
                const { data: created, error: createError } = await supabaseAdmin
                    .from('integration_connections')
                    .insert({
                    org_id: context.orgId,
                    type,
                    status: 'CONNECTED',
                    config_json: config,
                })
                    .select('id, org_id, type, status, config_json, error_message, created_at, updated_at, last_sync_at')
                    .single();
                if (createError) {
                    return res.status(500).json({ error: createError.message });
                }
                connectionId = created.id;
                connection = {
                    id: created.id,
                    orgId: created.org_id,
                    type: created.type,
                    status: created.status,
                    config: created.config_json || {},
                    errorMessage: created.error_message || undefined,
                    createdAt: created.created_at,
                    updatedAt: created.updated_at,
                    lastSyncAt: created.last_sync_at || undefined,
                    comingSoon: false,
                };
            }
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'integration.connect',
                targetType: 'integration_connection',
                targetId: connectionId,
                meta: { type, status: 'CONNECTED' }
            });
            res.json({
                success: true,
                connection,
                message: 'Integration connected successfully',
            });
        }
        catch (e) {
            console.error('Connect integration error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/integrations/disconnect - Disconnect integration
    // ============================================================================
    app.post('/api/integrations/disconnect', requireCapability(Capability.CLOUD_CONNECTORS), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { type } = req.body;
            if (!type || !INTEGRATION_TYPES.find(t => t.type === type)) {
                return res.status(400).json({ error: 'Invalid integration type' });
            }
            // Get existing connection
            const { data: existing, error: fetchError } = await supabaseAdmin
                .from('integration_connections')
                .select('id')
                .eq('org_id', context.orgId)
                .eq('type', type)
                .maybeSingle();
            if (fetchError) {
                return res.status(500).json({ error: fetchError.message });
            }
            if (!existing) {
                return res.status(404).json({ error: 'Integration connection not found' });
            }
            // Update status to DISCONNECTED (don't delete, preserve config)
            const { error: updateError } = await supabaseAdmin
                .from('integration_connections')
                .update({
                status: 'DISCONNECTED',
                error_message: null,
                updated_at: new Date().toISOString(),
            })
                .eq('id', existing.id)
                .eq('org_id', context.orgId);
            if (updateError) {
                return res.status(500).json({ error: updateError.message });
            }
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'integration.disconnect',
                targetType: 'integration_connection',
                targetId: existing.id,
                meta: { type, status: 'DISCONNECTED' }
            });
            res.json({
                success: true,
                message: 'Integration disconnected successfully',
            });
        }
        catch (e) {
            console.error('Disconnect integration error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
