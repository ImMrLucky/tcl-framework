import { supabaseAdmin } from '../supabase.js';
import { createHash, createHmac } from 'crypto';
import { decryptSecret } from '../security/secret-crypto.js';
/**
 * Get webhook integration for an org
 */
export async function getWebhookIntegration(orgId, supabase) {
    const { data, error } = await supabase
        .from('enterprise_integrations')
        .select('*')
        .eq('org_id', orgId)
        .eq('kind', 'WEBHOOK')
        .eq('status', 'ACTIVE')
        .maybeSingle();
    if (error) {
        console.error('Failed to fetch webhook integration:', error);
        return null;
    }
    return data;
}
/**
 * Get webhook signing secret
 */
export async function getWebhookSigningSecret(orgId, secretId, supabase) {
    const { data, error } = await supabase
        .from('integration_secrets')
        .select('ciphertext')
        .eq('org_id', orgId)
        .eq('integration_kind', 'WEBHOOK')
        .eq('key', secretId)
        .maybeSingle();
    if (error || !data) {
        return null;
    }
    try {
        return decryptSecret(data.ciphertext);
    }
    catch (decryptError) {
        console.error('Failed to decrypt webhook signing secret:', decryptError);
        return null;
    }
}
/**
 * Sign webhook payload
 */
export function signWebhookPayload(payload, secret) {
    return createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}
/**
 * Create webhook delivery record
 */
export async function createWebhookDelivery(integrationId, orgId, eventType, endpointUrl, payload, exportId, supabase) {
    const db = supabase || supabaseAdmin;
    const { data, error } = await db
        .from('webhook_deliveries')
        .insert({
        integration_id: integrationId,
        org_id: orgId,
        export_id: exportId || null,
        event_type: eventType,
        endpoint_url: endpointUrl,
        payload_json: payload,
        status: 'PENDING',
        attempt_number: 1,
        max_attempts: 3,
    })
        .select('id')
        .single();
    if (error) {
        throw new Error(`Failed to create webhook delivery: ${error.message}`);
    }
    return data.id;
}
/**
 * Update webhook delivery status
 */
export async function updateWebhookDelivery(deliveryId, updates, supabase) {
    const db = supabase || supabaseAdmin;
    const { error } = await db
        .from('webhook_deliveries')
        .update(updates)
        .eq('id', deliveryId);
    if (error) {
        throw new Error(`Failed to update webhook delivery: ${error.message}`);
    }
}
/**
 * Deliver webhook with retry logic
 */
export async function deliverWebhook(integrationId, orgId, eventType, payload, config, exportId) {
    const deliveryId = await createWebhookDelivery(integrationId, orgId, eventType, config.endpoint_url, payload, exportId);
    let attemptNumber = 1;
    const maxAttempts = 3;
    const baseDelay = 1000; // 1 second
    while (attemptNumber <= maxAttempts) {
        try {
            // Prepare headers
            const headers = {
                'Content-Type': 'application/json',
                'X-ProtectQA-Event': eventType,
                'X-ProtectQA-Timestamp': new Date().toISOString(),
                ...(config.headers_json || {}),
            };
            // Add signature if signing secret is configured
            if (config.signing_secret_id) {
                const secret = await getWebhookSigningSecret(orgId, config.signing_secret_id, supabaseAdmin);
                if (secret) {
                    const payloadString = JSON.stringify(payload);
                    const signature = signWebhookPayload(payloadString, secret);
                    headers['X-ProtectQA-Signature'] = `sha256=${signature}`;
                }
            }
            // Make HTTP request
            const response = await fetch(config.endpoint_url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            });
            const responseBody = await response.text().catch(() => '');
            if (response.ok) {
                // Success
                await updateWebhookDelivery(deliveryId, {
                    status: 'SENT',
                    responseStatusCode: response.status,
                    responseBody: responseBody.substring(0, 1000), // Limit response body size
                    sentAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                });
                // Create integration export record
                const payloadHash = createHash('sha256')
                    .update(JSON.stringify(payload))
                    .digest('hex');
                await supabaseAdmin
                    .from('integration_exports')
                    .insert({
                    integration_id: integrationId,
                    org_id: orgId,
                    target_type: payload.target_type || 'ISSUE',
                    target_id: payload.target_id || '',
                    status: 'SENT',
                    external_ref: response.headers.get('X-Request-ID') || undefined,
                    payload_hash: payloadHash,
                    sent_at: new Date().toISOString(),
                });
                return; // Success, exit retry loop
            }
            else {
                // HTTP error
                throw new Error(`HTTP ${response.status}: ${responseBody.substring(0, 200)}`);
            }
        }
        catch (error) {
            const errorMessage = error.message || 'Unknown error';
            if (attemptNumber < maxAttempts) {
                // Calculate exponential backoff delay
                const delay = baseDelay * Math.pow(2, attemptNumber - 1);
                const nextRetryAt = new Date(Date.now() + delay).toISOString();
                await updateWebhookDelivery(deliveryId, {
                    status: 'RETRYING',
                    errorMessage,
                    attemptNumber: attemptNumber + 1,
                    nextRetryAt,
                });
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, delay));
                attemptNumber++;
            }
            else {
                // Final failure
                await updateWebhookDelivery(deliveryId, {
                    status: 'FAILED',
                    errorMessage,
                    attemptNumber,
                    completedAt: new Date().toISOString(),
                });
                // Create integration export record with failed status
                const payloadHash = createHash('sha256')
                    .update(JSON.stringify(payload))
                    .digest('hex');
                await supabaseAdmin
                    .from('integration_exports')
                    .insert({
                    integration_id: integrationId,
                    org_id: orgId,
                    target_type: payload.target_type || 'ISSUE',
                    target_id: payload.target_id || '',
                    status: 'FAILED',
                    error: errorMessage,
                    payload_hash: payloadHash,
                });
                throw error; // Re-throw to indicate failure
            }
        }
    }
}
