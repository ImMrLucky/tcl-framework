/**
 * Slack Alert Connector
 * Sends alerts to Slack via incoming webhook
 */

import { ExportConnector, ConnectorContext } from './base.js';
import type { DeliveryAttempt } from '../types.js';
import { supabaseAdmin } from '../server/supabase.js';
import fetch from 'node-fetch';

export class SlackAlertConnector extends ExportConnector {
  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    const webhookUrl = this.context.secrets.webhook_url;
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return { valid: false, error: 'Missing Slack webhook URL' };
    }
    return { valid: true };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const webhookUrl = this.context.secrets.webhook_url;
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test message from ProtectQA' }),
      });

      return { success: response.ok };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async execute(payload: any): Promise<{ success: boolean; data?: any; error?: string }> {
    const result = await this.export(payload.evaluationId, payload.evaluationData);
    return {
      success: result.status === 'success',
      data: result,
      error: result.error_message || undefined,
    };
  }

  async export(evaluationId: string, evaluationData: any): Promise<DeliveryAttempt> {
    const webhookUrl = this.context.secrets.webhook_url;
    const triggerRules = this.context.config.trigger_rules || {};

    // Check if evaluation matches trigger rules
    const scores = evaluationData.scores || {};
    const overall = scores.overall || 0;

    // Default triggers: risk level or policy violations
    const shouldAlert =
      triggerRules.min_risk_level &&
      overall < triggerRules.min_risk_level
        ? true
        : triggerRules.on_policy_violation &&
          (evaluationData.report?.contradictions?.length || 0) > 0
        ? true
        : triggerRules.on_ungrounded &&
          (evaluationData.report?.missingEvidence?.length || 0) > 0
        ? true
        : false;

    if (!shouldAlert) {
      // Create delivery attempt marked as skipped
      const { data: attempt } = await supabaseAdmin
        .from('delivery_attempts')
        .insert({
          org_id: this.context.orgId,
          integration_id: this.context.integrationId,
          evaluation_id: evaluationId,
          attempt_number: 1,
          status: 'success',
          payload: { skipped: true, reason: 'Trigger rules not met' },
          completed_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      return attempt;
    }

    // Create delivery attempt
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
      // Build Slack message
      const riskLevel =
        overall >= 80 ? 'Low' : overall >= 60 ? 'Medium' : overall >= 40 ? 'High' : 'Critical';

      const message = {
        text: `ProtectQA Alert: ${riskLevel} Risk Detected`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🚨 ${riskLevel} Risk Alert`,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Compliance Score:*\n${overall}`,
              },
              {
                type: 'mrkdwn',
                text: `*Risk Level:*\n${riskLevel}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Policy Violations:* ${evaluationData.report?.contradictions?.length || 0}\n*Ungrounded Claims:* ${evaluationData.report?.missingEvidence?.length || 0}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Evaluation',
                },
                url: `${process.env.FRONTEND_URL || 'https://app.protectqa.com'}/evaluations/${evaluationId}`,
              },
            ],
          },
        ],
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      const responseBody = await response.text();

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

