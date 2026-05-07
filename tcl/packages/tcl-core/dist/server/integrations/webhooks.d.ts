import type { SupabaseClient } from '@supabase/supabase-js';
export interface WebhookConfig {
    endpoint_url: string;
    enabled_events: string[];
    signing_secret_id?: string;
    headers_json?: Record<string, string>;
}
export interface WebhookEvent {
    event_type: string;
    timestamp: string;
    org_id: string;
    payload: any;
}
/**
 * Get webhook integration for an org
 */
export declare function getWebhookIntegration(orgId: string, supabase: SupabaseClient): Promise<any | null>;
/**
 * Get webhook signing secret
 */
export declare function getWebhookSigningSecret(orgId: string, secretId: string, supabase: SupabaseClient): Promise<string | null>;
/**
 * Sign webhook payload
 */
export declare function signWebhookPayload(payload: string, secret: string): string;
/**
 * Create webhook delivery record
 */
export declare function createWebhookDelivery(integrationId: string, orgId: string, eventType: string, endpointUrl: string, payload: any, exportId?: string, supabase?: SupabaseClient): Promise<string>;
/**
 * Update webhook delivery status
 */
export declare function updateWebhookDelivery(deliveryId: string, updates: {
    status?: 'PENDING' | 'SENT' | 'FAILED' | 'RETRYING';
    responseStatusCode?: number;
    responseBody?: string;
    errorMessage?: string;
    attemptNumber?: number;
    nextRetryAt?: string;
    sentAt?: string;
    completedAt?: string;
}, supabase?: SupabaseClient): Promise<void>;
/**
 * Deliver webhook with retry logic
 */
export declare function deliverWebhook(integrationId: string, orgId: string, eventType: string, payload: any, config: WebhookConfig, exportId?: string): Promise<void>;
