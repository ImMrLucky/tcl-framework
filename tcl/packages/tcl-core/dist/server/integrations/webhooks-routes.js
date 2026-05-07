import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { getWebhookIntegration, deliverWebhook } from './webhooks.js';
import { encryptSecret } from '../security/secret-crypto.js';
/**
 * Setup webhooks API routes
 */
export function setupWebhooksRoutes(app) {
    // ============================================================================
    // POST /api/integrations/webhooks/test - Test webhook delivery
    // ============================================================================
    app.post('/api/integrations/webhooks/test', requireEntitlement('integrations'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { endpointUrl, signingSecret } = req.body;
            if (!endpointUrl) {
                return res.status(400).json({ error: 'endpointUrl is required' });
            }
            // Create test payload
            const testPayload = {
                event_type: 'test',
                timestamp: new Date().toISOString(),
                org_id: context.orgId,
                message: 'This is a test webhook from ProtectQA',
            };
            try {
                const headers = {
                    'Content-Type': 'application/json',
                    'X-ProtectQA-Event': 'test',
                    'X-ProtectQA-Timestamp': new Date().toISOString(),
                };
                // Add signature if secret provided
                if (signingSecret) {
                    const { createHmac } = await import('crypto');
                    const signature = createHmac('sha256', signingSecret)
                        .update(JSON.stringify(testPayload))
                        .digest('hex');
                    headers['X-ProtectQA-Signature'] = `sha256=${signature}`;
                }
                const response = await fetch(endpointUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(testPayload),
                });
                const responseBody = await response.text().catch(() => '');
                res.json({
                    success: response.ok,
                    statusCode: response.status,
                    responseBody: responseBody.substring(0, 500),
                    message: response.ok ? 'Webhook test successful' : 'Webhook test failed',
                });
            }
            catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to deliver test webhook',
                });
            }
        }
        catch (error) {
            console.error('Test webhook error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // POST /api/integrations/webhooks/send - Send webhook (internal use)
    // ============================================================================
    app.post('/api/integrations/webhooks/send', requireEntitlement('integrations'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { eventType, payload, exportId } = req.body;
            if (!eventType || !payload) {
                return res.status(400).json({ error: 'eventType and payload are required' });
            }
            // Get webhook integration
            const integration = await getWebhookIntegration(context.orgId, supabaseAdmin);
            if (!integration) {
                return res.status(404).json({ error: 'Webhook integration not found or not active' });
            }
            const config = integration.config_json;
            if (!config.endpoint_url) {
                return res.status(400).json({ error: 'Webhook endpoint_url not configured' });
            }
            // Deliver webhook
            await deliverWebhook(integration.id, context.orgId, eventType, payload, config, exportId);
            res.json({ success: true, message: 'Webhook sent successfully' });
        }
        catch (error) {
            console.error('Send webhook error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // POST /api/integrations/webhooks/config - Create/update webhook config
    // ============================================================================
    app.post('/api/integrations/webhooks/config', requireEntitlement('integrations'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { endpointUrl, enabledEvents, signingSecret, headers } = req.body;
            if (!endpointUrl) {
                return res.status(400).json({ error: 'endpointUrl is required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Check if webhook integration exists
            const { data: existingIntegration } = await supabaseAdmin
                .from('enterprise_integrations')
                .select('*')
                .eq('org_id', context.orgId)
                .eq('kind', 'WEBHOOK')
                .maybeSingle();
            let integration;
            if (existingIntegration) {
                // Update existing
                const { data: updatedIntegration, error: updateError } = await supabaseAdmin
                    .from('enterprise_integrations')
                    .update({
                    config_json: {
                        endpoint_url: endpointUrl,
                        enabled_events: enabledEvents || [],
                        headers_json: headers || {},
                    },
                })
                    .eq('id', existingIntegration.id)
                    .select()
                    .single();
                if (updateError) {
                    return res.status(500).json({ error: `Failed to update webhook: ${updateError.message}` });
                }
                integration = updatedIntegration;
            }
            else {
                // Create new
                const { data: newIntegration, error: createError } = await supabaseAdmin
                    .from('enterprise_integrations')
                    .insert({
                    org_id: context.orgId,
                    kind: 'WEBHOOK',
                    status: 'ACTIVE',
                    config_json: {
                        endpoint_url: endpointUrl,
                        enabled_events: enabledEvents || [],
                        headers_json: headers || {},
                    },
                    created_by_user_id: context.userId,
                })
                    .select()
                    .single();
                if (createError) {
                    return res.status(500).json({ error: `Failed to create webhook: ${createError.message}` });
                }
                integration = newIntegration;
            }
            // Store signing secret if provided
            if (signingSecret) {
                try {
                    const secretId = 'signing_secret';
                    const encryptedSecret = encryptSecret(signingSecret);
                    await supabaseAdmin
                        .from('integration_secrets')
                        .upsert({
                        org_id: context.orgId,
                        integration_id: integration.id,
                        integration_kind: 'WEBHOOK',
                        key: secretId,
                        ciphertext: encryptedSecret,
                    }, {
                        onConflict: 'org_id,integration_kind,key',
                    });
                }
                catch (encryptError) {
                    console.error('Failed to encrypt webhook signing secret:', encryptError);
                    // Continue - error will be caught by validation
                }
            }
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: existingIntegration ? 'integration.webhook.update' : 'integration.webhook.create',
                targetType: 'integration',
                targetId: integration.id,
            });
            res.json({ success: true, integration });
        }
        catch (error) {
            console.error('Webhook config error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // GET /api/integrations/webhooks/deliveries - Get webhook delivery history
    // ============================================================================
    app.get('/api/integrations/webhooks/deliveries', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const offset = parseInt(req.query.offset) || 0;
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get webhook integration
            const { data: integration } = await supabaseAdmin
                .from('enterprise_integrations')
                .select('id')
                .eq('org_id', context.orgId)
                .eq('kind', 'WEBHOOK')
                .maybeSingle();
            if (!integration) {
                return res.json({ deliveries: [], total: 0 });
            }
            const { data: deliveries, error: deliveriesError, count } = await supabaseAdmin
                .from('webhook_deliveries')
                .select('*', { count: 'exact' })
                .eq('integration_id', integration.id)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (deliveriesError) {
                return res.status(500).json({ error: `Failed to fetch deliveries: ${deliveriesError.message}` });
            }
            res.json({
                deliveries: deliveries || [],
                total: count || 0,
                limit,
                offset,
            });
        }
        catch (error) {
            console.error('Get webhook deliveries error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
}
