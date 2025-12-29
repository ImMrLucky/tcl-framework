/**
 * Webhook Export Connector
 * Sends evaluation results to customer webhook endpoints
 */
import { ExportConnector } from './base.js';
import { supabaseAdmin } from '../server/supabase.js';
import { generateWebhookSignature } from '../security/hmac.js';
import fetch from 'node-fetch';
export class WebhookExportConnector extends ExportConnector {
    async validateConfig() {
        const url = this.context.config.url;
        if (!url || typeof url !== 'string') {
            return { valid: false, error: 'Missing or invalid webhook URL' };
        }
        return { valid: true };
    }
    async testConnection() {
        try {
            const url = this.context.config.url;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ test: true }),
            });
            return { success: response.ok };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async execute(payload) {
        const result = await this.export(payload.evaluationId, payload.evaluationData);
        return {
            success: result.status === 'success',
            data: result,
            error: result.error_message || undefined,
        };
    }
    async export(evaluationId, evaluationData) {
        const url = this.context.config.url;
        const secret = this.context.secrets.secret || '';
        // Create delivery attempt record
        const { data: attempt, error: attemptError } = await supabaseAdmin
            .from('delivery_attempts')
            .insert({
            org_id: this.context.orgId,
            integration_id: this.context.integrationId,
            evaluation_id: evaluationId,
            attempt_number: 1,
            status: 'pending',
            payload: evaluationData,
        })
            .select('*')
            .single();
        if (attemptError) {
            throw new Error('Failed to create delivery attempt');
        }
        try {
            // Generate HMAC signature if secret provided
            const timestamp = Date.now().toString();
            const bodyString = JSON.stringify(evaluationData);
            const signature = secret
                ? generateWebhookSignature(secret, timestamp, bodyString)
                : undefined;
            const headers = {
                'Content-Type': 'application/json',
                'X-ProtectQA-Timestamp': timestamp,
            };
            if (signature) {
                headers['X-ProtectQA-Signature'] = signature;
            }
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: bodyString,
            });
            const responseBody = await response.text();
            // Update delivery attempt
            await supabaseAdmin
                .from('delivery_attempts')
                .update({
                status: response.ok ? 'success' : 'failed',
                response_status: response.status,
                response_body: responseBody,
                completed_at: new Date().toISOString(),
            })
                .eq('id', attempt.id);
            return {
                ...attempt,
                status: response.ok ? 'success' : 'failed',
                response_status: response.status,
                response_body: responseBody,
            };
        }
        catch (error) {
            // Schedule retry
            const nextRetryAt = new Date(Date.now() + Math.pow(2, attempt.attempt_number) * 1000);
            await supabaseAdmin
                .from('delivery_attempts')
                .update({
                status: 'retrying',
                error_message: error.message,
                next_retry_at: nextRetryAt.toISOString(),
            })
                .eq('id', attempt.id);
            return {
                ...attempt,
                status: 'retrying',
                error_message: error.message,
                next_retry_at: nextRetryAt.toISOString(),
            };
        }
    }
}
