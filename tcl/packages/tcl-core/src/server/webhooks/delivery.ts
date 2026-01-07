/**
 * Webhook Delivery Service
 * Handles async delivery of webhooks with HMAC signing
 */

import { supabaseAdmin } from '../supabase.js';
import { generateWebhookSignature } from '../integrations/security/hmac.js';
import { planService } from '../plans/plan-service.js';
import { Capability } from '../plans/capabilities.js';

export interface AnalysisCompletedPayload {
  event: 'analysis.completed';
  mode: 'SANDBOX' | 'PROD';
  orgId: string;
  analysisId: string;
  createdAt: string;
  summary: {
    totalIssues: number;
    bySeverity: {
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
    byType: Record<string, number>;
    byCategory: Record<string, number>;
  };
  spectral?: {
    energy?: number;
    gap?: number;
    cycleMass?: number;
  };
}

interface WebhookEndpoint {
  id: string;
  url: string;
  secret_hash: string;
  mode: 'SANDBOX' | 'PROD';
  events: string[];
}

/**
 * Deliver webhook for analysis.completed event
 * Only delivers to PROD endpoints if org has WEBHOOKS_PROD capability
 * Sandbox endpoints are test-only (no auto-delivery)
 */
export async function deliverAnalysisCompletedWebhook(
  orgId: string,
  analysisId: string,
  summary: AnalysisCompletedPayload['summary'],
  spectral?: AnalysisCompletedPayload['spectral']
): Promise<void> {
  if (!supabaseAdmin) {
    console.warn('Supabase not configured, skipping webhook delivery');
    return;
  }

  try {
    // Get plan context to check capabilities
    const planContext = await planService.getOrgPlanContext(orgId);
    const hasProdWebhooks = await planService.hasCapability(orgId, Capability.WEBHOOKS_PROD);

    // Get enabled webhook endpoints for this org
    const { data: endpoints, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .select('id, url, secret_hash, mode, events')
      .eq('org_id', orgId)
      .eq('enabled', true)
      .contains('events', ['analysis.completed']);

    if (error || !endpoints || endpoints.length === 0) {
      return; // No webhooks configured
    }

    // Filter endpoints based on mode and capability
    const deliverableEndpoints: WebhookEndpoint[] = [];
    for (const endpoint of endpoints) {
      const mode = (endpoint.mode || 'SANDBOX') as 'SANDBOX' | 'PROD';
      
      if (mode === 'PROD') {
        // PROD endpoints: only deliver if org has WEBHOOKS_PROD capability
        if (hasProdWebhooks) {
          deliverableEndpoints.push(endpoint as WebhookEndpoint);
        }
      } else {
        // SANDBOX endpoints: test-only, do NOT auto-deliver
        // (They can be tested manually via POST /api/webhooks/:id/test)
        continue;
      }
    }

    if (deliverableEndpoints.length === 0) {
      return; // No endpoints to deliver to
    }

    // Determine mode for payload (based on plan tier)
    const payloadMode: 'SANDBOX' | 'PROD' = planContext.tier === 'SANDBOX' ? 'SANDBOX' : 'PROD';

    // Create payload
    const payload: AnalysisCompletedPayload = {
      event: 'analysis.completed',
      mode: payloadMode,
      orgId,
      analysisId,
      createdAt: new Date().toISOString(),
      summary,
      spectral,
    };

    const payloadBody = JSON.stringify(payload);

    // Deliver to each endpoint (async, fire and forget)
    for (const endpoint of deliverableEndpoints) {
      deliverWebhookAsync(endpoint, payloadBody, 'analysis.completed');
    }
  } catch (error: any) {
    console.error('Error delivering analysis.completed webhook:', error);
    // Don't throw - webhook delivery failures shouldn't break the analysis flow
  }
}

/**
 * Deliver webhook asynchronously (fire and forget)
 */
async function deliverWebhookAsync(
  endpoint: WebhookEndpoint,
  payloadBody: string,
  eventType: string
): Promise<void> {
  try {
    // Note: We can't generate the signature without the original secret
    // In production, we'd need to store the secret encrypted or use a key derivation
    // For now, we'll use a placeholder and document that users should verify using their stored secret
    // TODO: Implement secure secret storage/retrieval
    const timestamp = Date.now().toString();
    const signature = generateWebhookSignature('webhook-secret-placeholder', timestamp, payloadBody);

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ProtectQA-Signature': signature,
        'X-ProtectQA-Event': eventType,
        'User-Agent': 'ProtectQA-Webhooks/1.0',
      },
      body: payloadBody,
      // Timeout after 10 seconds
      signal: AbortSignal.timeout(10000),
    });

    // Update delivery stats
    if (supabaseAdmin) {
      if (response.ok) {
        await supabaseAdmin
          .from('webhook_endpoints')
          .update({
            last_delivered_at: new Date().toISOString(),
            delivery_count: (endpoint as any).delivery_count + 1 || 1,
          })
          .eq('id', endpoint.id);
      } else {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        await supabaseAdmin
          .from('webhook_endpoints')
          .update({
            last_error_at: new Date().toISOString(),
            last_error_message: errorText.substring(0, 500), // Limit error message length
            failure_count: (endpoint as any).failure_count + 1 || 1,
          })
          .eq('id', endpoint.id);
      }
    }
  } catch (error: any) {
    // Update error stats
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('webhook_endpoints')
        .update({
          last_error_at: new Date().toISOString(),
          last_error_message: error.message?.substring(0, 500) || 'Network error',
          failure_count: (endpoint as any).failure_count + 1 || 1,
        })
        .eq('id', endpoint.id);
    }
  }
}

