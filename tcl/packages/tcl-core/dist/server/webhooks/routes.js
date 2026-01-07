/**
 * Webhook Management Routes
 * Handles creation, listing, testing, and deletion of webhook endpoints
 */
import crypto from 'crypto';
import { supabaseAdmin, logAudit } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { planService } from '../plans/plan-service.js';
import { Capability } from '../plans/capabilities.js';
import { generateWebhookSignature } from '../integrations/security/hmac.js';
export function hashWebhookSecret(secret) {
    return crypto.createHash('sha256').update(secret).digest('hex');
}
export function generateWebhookSecret() {
    const secret = crypto.randomBytes(32).toString('base64url');
    const hash = hashWebhookSecret(secret);
    return { secret, hash };
}
export function setupWebhookRoutes(app) {
    // ============================================================================
    // GET /api/webhooks - List webhook endpoints for current org
    // ============================================================================
    app.get('/api/webhooks', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { data: webhooks, error } = await supabaseAdmin
                .from('webhook_endpoints')
                .select('id, org_id, url, enabled, mode, events, created_at, updated_at, last_delivered_at, last_error_at, last_error_message, delivery_count, failure_count')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            const response = (webhooks || []).map((w) => ({
                id: w.id,
                orgId: w.org_id,
                url: w.url,
                enabled: w.enabled,
                mode: (w.mode || 'SANDBOX'),
                events: w.events || ['analysis.completed'],
                createdAt: w.created_at,
                updatedAt: w.updated_at,
                lastDeliveredAt: w.last_delivered_at || undefined,
                lastErrorAt: w.last_error_at || undefined,
                lastErrorMessage: w.last_error_message || undefined,
                deliveryCount: w.delivery_count || 0,
                failureCount: w.failure_count || 0,
            }));
            res.json({ webhooks: response });
        }
        catch (e) {
            console.error('List webhooks error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/webhooks - Create new webhook endpoint
    // ============================================================================
    app.post('/api/webhooks', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { url, mode, events } = req.body;
            if (!url || typeof url !== 'string' || url.trim().length === 0) {
                return res.status(400).json({ error: 'url is required' });
            }
            // Validate URL format
            try {
                new URL(url);
            }
            catch (e) {
                return res.status(400).json({ error: 'Invalid URL format' });
            }
            const webhookMode = (mode || 'SANDBOX');
            // Check capability based on requested mode
            const requiredCapability = webhookMode === 'PROD'
                ? Capability.WEBHOOKS_PROD
                : Capability.WEBHOOKS_TEST;
            const hasCap = await planService.hasCapability(context.orgId, requiredCapability);
            if (!hasCap) {
                const planContext = await planService.getOrgPlanContext(context.orgId);
                return res.status(403).json({
                    error: 'UPGRADE_REQUIRED',
                    requiredCapability: requiredCapability,
                    currentPlan: planContext.tier,
                    message: `Creating ${webhookMode} webhooks requires ${requiredCapability}. Your current plan (${planContext.tier}) does not include this capability.`,
                });
            }
            // Validate events array
            const validEvents = Array.isArray(events) && events.length > 0
                ? events.filter((e) => typeof e === 'string')
                : ['analysis.completed'];
            // Generate webhook secret
            const { secret, hash } = generateWebhookSecret();
            const { data, error: insertError } = await supabaseAdmin
                .from('webhook_endpoints')
                .insert({
                org_id: context.orgId,
                url: url.trim(),
                secret_hash: hash,
                enabled: true,
                mode: webhookMode,
                events: validEvents,
            })
                .select('id, url, enabled, mode, events, created_at, updated_at')
                .single();
            if (insertError) {
                return res.status(500).json({ error: insertError.message });
            }
            // Return secret only once (never again)
            const response = {
                id: data.id,
                orgId: context.orgId,
                url: data.url,
                enabled: data.enabled,
                mode: (data.mode || 'SANDBOX'),
                events: data.events || ['analysis.completed'],
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                deliveryCount: 0,
                failureCount: 0,
                secret, // Only returned on creation
            };
            res.json(response);
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'webhook.create',
                targetType: 'webhook_endpoint',
                targetId: data.id,
                meta: { url: data.url, mode: webhookMode, events: validEvents }
            });
        }
        catch (e) {
            console.error('Create webhook error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // DELETE /api/webhooks/:id - Delete webhook endpoint
    // ============================================================================
    app.delete('/api/webhooks/:id', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            // Verify webhook belongs to org
            const { data: webhook, error: fetchError } = await supabaseAdmin
                .from('webhook_endpoints')
                .select('id, url, org_id')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (fetchError || !webhook) {
                return res.status(404).json({ error: 'Webhook endpoint not found' });
            }
            // Delete webhook
            const { error: deleteError } = await supabaseAdmin
                .from('webhook_endpoints')
                .delete()
                .eq('id', id)
                .eq('org_id', context.orgId);
            if (deleteError) {
                return res.status(500).json({ error: deleteError.message });
            }
            res.json({ success: true, message: 'Webhook endpoint deleted' });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'webhook.delete',
                targetType: 'webhook_endpoint',
                targetId: id,
                meta: { url: webhook.url }
            });
        }
        catch (e) {
            console.error('Delete webhook error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/webhooks/:id/test - Send test webhook
    // ============================================================================
    app.post('/api/webhooks/:id/test', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            // Get webhook endpoint
            const { data: webhook, error: fetchError } = await supabaseAdmin
                .from('webhook_endpoints')
                .select('id, url, secret_hash, mode, org_id')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (fetchError || !webhook) {
                return res.status(404).json({ error: 'Webhook endpoint not found' });
            }
            // Create test payload
            const testPayload = {
                event: 'webhook.test',
                mode: (webhook.mode || 'SANDBOX'),
                orgId: context.orgId,
                timestamp: new Date().toISOString(),
                test: {
                    message: 'This is a test webhook from ProtectQA',
                    endpointId: webhook.id,
                },
            };
            const payloadBody = JSON.stringify(testPayload);
            // Note: We can't generate the signature without the original secret
            // For test webhooks, we'll send without signature or use a placeholder
            // In production, the user should verify using their stored secret
            const timestamp = Date.now().toString();
            const signature = generateWebhookSignature('test-secret-placeholder', timestamp, payloadBody);
            // Send webhook (fire and forget)
            fetch(webhook.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-ProtectQA-Signature': signature,
                    'X-ProtectQA-Event': 'webhook.test',
                },
                body: payloadBody,
            })
                .then(async (response) => {
                // Update delivery stats
                if (supabaseAdmin) {
                    if (response.ok) {
                        await supabaseAdmin
                            .from('webhook_endpoints')
                            .update({
                            last_delivered_at: new Date().toISOString(),
                            delivery_count: webhook.delivery_count + 1 || 1,
                        })
                            .eq('id', id);
                    }
                    else {
                        await supabaseAdmin
                            .from('webhook_endpoints')
                            .update({
                            last_error_at: new Date().toISOString(),
                            last_error_message: `HTTP ${response.status}`,
                            failure_count: webhook.failure_count + 1 || 1,
                        })
                            .eq('id', id);
                    }
                }
            })
                .catch(async (error) => {
                // Update error stats
                if (supabaseAdmin) {
                    await supabaseAdmin
                        .from('webhook_endpoints')
                        .update({
                        last_error_at: new Date().toISOString(),
                        last_error_message: error.message || 'Network error',
                        failure_count: webhook.failure_count + 1 || 1,
                    })
                        .eq('id', id);
                }
            });
            res.json({
                success: true,
                message: 'Test webhook sent',
                payload: testPayload,
                note: 'Signature is a placeholder. Use your stored secret to verify in production.',
            });
        }
        catch (e) {
            console.error('Test webhook error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
