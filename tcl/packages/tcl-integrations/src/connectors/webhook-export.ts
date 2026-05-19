/**
 * Webhook Export Connector
 * Sends evaluation results to customer webhook endpoints
 */

import { ExportConnector, ConnectorContext } from './base.js';
import type { DeliveryAttempt } from '../types.js';
import { supabaseAdmin } from '../server/supabase.js';
import { generateWebhookSignature } from '../security/hmac.js';
import fetch from 'node-fetch';

export class WebhookExportConnector extends ExportConnector {
  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    const url = this.context.config.url;
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'Missing or invalid webhook URL' };
    }
    return { valid: true };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const url = this.context.config.url;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });

      return { success: response.ok };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async execute(payload: any): Promise<{ success: boolean; data?: any; error?: string }> {
    const attempt = await this.export(payload.evaluationId, payload.evaluationData);
    return this.deliveryResult(attempt);
  }

  async export(evaluationId: string, evaluationData: any): Promise<DeliveryAttempt> {
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

      const headers: Record<string, string> = {
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
    } catch (error: any) {
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

