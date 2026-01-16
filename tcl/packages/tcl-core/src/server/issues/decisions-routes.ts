import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { generateIssueIdFromIssue } from './issue-id-generator.js';
import type { IssueV2 } from '../../types.js';
import { getWebhookIntegration, deliverWebhook } from '../integrations/webhooks.js';

/**
 * Setup issue decisions API routes
 */
export function setupIssueDecisionsRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/issues/:issueId/decision - Get decision for an issue
  // ============================================================================
  app.get('/api/issues/:issueId/decision', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { issueId } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get decision
      const { data: decision, error: decisionError } = await supabaseAdmin
        .from('issue_decisions')
        .select('*')
        .eq('org_id', context.orgId)
        .eq('issue_id', issueId)
        .maybeSingle();

      if (decisionError) {
        return res.status(500).json({ error: `Failed to fetch decision: ${decisionError.message}` });
      }

      if (!decision) {
        return res.status(404).json({ error: 'Decision not found' });
      }

      res.json({ decision });
    } catch (error: any) {
      console.error('Get issue decision error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // POST /api/issues/:issueId/decision - Create or update decision
  // ============================================================================
  app.post(
    '/api/issues/:issueId/decision',
    requireEntitlement('issueDecisions'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { issueId } = req.params;
        const {
          disposition,
          severityOverride,
          assignedToUserId,
          notes,
          expiresAt,
          evaluationId,
          projectId,
        } = req.body;

        if (!disposition) {
          return res.status(400).json({ error: 'disposition is required' });
        }

        // Validate disposition
        const validDispositions = [
          'OPEN',
          'ACKNOWLEDGED',
          'REMEDIATED',
          'ACCEPTED_RISK',
          'FALSE_POSITIVE',
          'REQUIRES_FOLLOWUP',
          'ESCALATED',
        ];
        if (!validDispositions.includes(disposition)) {
          return res.status(400).json({ error: `Invalid disposition: ${disposition}` });
        }

        // Require expires_at for ACCEPTED_RISK
        if (disposition === 'ACCEPTED_RISK' && !expiresAt) {
          return res.status(400).json({ error: 'expiresAt is required when disposition is ACCEPTED_RISK' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Check if decision already exists
        const { data: existingDecision } = await supabaseAdmin
          .from('issue_decisions')
          .select('id')
          .eq('org_id', context.orgId)
          .eq('issue_id', issueId)
          .maybeSingle();

        const decisionData: any = {
          org_id: context.orgId,
          issue_id: issueId,
          disposition,
          created_by_user_id: context.userId,
          updated_at: new Date().toISOString(),
        };

        if (projectId) decisionData.project_id = projectId;
        if (evaluationId) decisionData.evaluation_id = evaluationId;
        if (severityOverride) decisionData.severity_override = severityOverride;
        if (assignedToUserId) decisionData.assigned_to_user_id = assignedToUserId;
        if (notes) decisionData.notes = notes;
        if (expiresAt) decisionData.expires_at = expiresAt;

        let decision;
        let eventType: 'CREATED' | 'UPDATED' = 'CREATED';

        if (existingDecision) {
          // Update existing decision
          const { data: updatedDecision, error: updateError } = await supabaseAdmin
            .from('issue_decisions')
            .update(decisionData)
            .eq('id', existingDecision.id)
            .select()
            .single();

          if (updateError) {
            return res.status(500).json({ error: `Failed to update decision: ${updateError.message}` });
          }

          decision = updatedDecision;
          eventType = 'UPDATED';
        } else {
          // Create new decision
          const { data: newDecision, error: createError } = await supabaseAdmin
            .from('issue_decisions')
            .insert(decisionData)
            .select()
            .single();

          if (createError) {
            return res.status(500).json({ error: `Failed to create decision: ${createError.message}` });
          }

          decision = newDecision;
        }

        // Create event log entry
        await supabaseAdmin
          .from('issue_decision_events')
          .insert({
            decision_id: decision.id,
            event_type: eventType,
            payload_json: {
              disposition,
              severityOverride,
              assignedToUserId,
              notes: notes ? notes.substring(0, 500) : undefined, // Truncate for event log
            },
            actor_user_id: context.userId,
          });

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: `issue.decision.${eventType.toLowerCase()}`,
          targetType: 'issue_decision',
          targetId: decision.id,
          meta: {
            issueId,
            disposition,
          },
        });

        // Emit webhook event if webhook integration is active
        try {
          const webhookIntegration = await getWebhookIntegration(context.orgId, supabaseAdmin);
          if (webhookIntegration) {
            const config = webhookIntegration.config_json as any;
            const enabledEvents = config.enabled_events || [];
            if (enabledEvents.includes('issue.decision.updated') || enabledEvents.includes('*')) {
              await deliverWebhook(
                webhookIntegration.id,
                context.orgId,
                'issue.decision.updated',
                {
                  event_type: 'issue.decision.updated',
                  timestamp: new Date().toISOString(),
                  org_id: context.orgId,
                  issue_id: issueId,
                  decision: {
                    id: decision.id,
                    disposition,
                    severityOverride,
                    assignedToUserId,
                    notes,
                    expiresAt,
                  },
                },
                config
              ).catch((error) => {
                console.error('Failed to deliver webhook for decision update:', error);
                // Don't fail the request if webhook fails
              });
            }
          }
        } catch (webhookError) {
          console.error('Webhook delivery error (non-fatal):', webhookError);
        }

        res.json({ success: true, decision });
      } catch (error: any) {
        console.error('Create/update issue decision error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/issues/:issueId/decision/history - Get decision event history
  // ============================================================================
  app.get('/api/issues/:issueId/decision/history', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { issueId } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get decision first
      const { data: decision } = await supabaseAdmin
        .from('issue_decisions')
        .select('id')
        .eq('org_id', context.orgId)
        .eq('issue_id', issueId)
        .maybeSingle();

      if (!decision) {
        return res.status(404).json({ error: 'Decision not found' });
      }

      // Get events
      const { data: events, error: eventsError } = await supabaseAdmin
        .from('issue_decision_events')
        .select('*')
        .eq('decision_id', decision.id)
        .order('created_at', { ascending: false });

      if (eventsError) {
        return res.status(500).json({ error: `Failed to fetch events: ${eventsError.message}` });
      }

      res.json({ events: events || [] });
    } catch (error: any) {
      console.error('Get decision history error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // POST /api/issues/bulk-decisions - Bulk create/update decisions
  // ============================================================================
  app.post(
    '/api/issues/bulk-decisions',
    requireEntitlement('issueDecisions'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { issueIds, disposition, severityOverride, assignedToUserId, notes, expiresAt } = req.body;

        if (!issueIds || !Array.isArray(issueIds) || issueIds.length === 0) {
          return res.status(400).json({ error: 'issueIds array is required' });
        }

        if (!disposition) {
          return res.status(400).json({ error: 'disposition is required' });
        }

        // Validate disposition
        const validDispositions = [
          'OPEN',
          'ACKNOWLEDGED',
          'REMEDIATED',
          'ACCEPTED_RISK',
          'FALSE_POSITIVE',
          'REQUIRES_FOLLOWUP',
          'ESCALATED',
        ];
        if (!validDispositions.includes(disposition)) {
          return res.status(400).json({ error: `Invalid disposition: ${disposition}` });
        }

        // Require expires_at for ACCEPTED_RISK
        if (disposition === 'ACCEPTED_RISK' && !expiresAt) {
          return res.status(400).json({ error: 'expiresAt is required when disposition is ACCEPTED_RISK' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Process each issue
        const results: Array<{ issueId: string; success: boolean; error?: string }> = [];
        
        for (const issueId of issueIds) {
          try {
            // Check if decision exists
            const { data: existingDecision } = await supabaseAdmin
              .from('issue_decisions')
              .select('id')
              .eq('org_id', context.orgId)
              .eq('issue_id', issueId)
              .maybeSingle();

            const decisionData: any = {
              org_id: context.orgId,
              issue_id: issueId,
              disposition,
              created_by_user_id: context.userId,
              updated_at: new Date().toISOString(),
            };

            if (severityOverride) decisionData.severity_override = severityOverride;
            if (assignedToUserId) decisionData.assigned_to_user_id = assignedToUserId;
            if (notes) decisionData.notes = notes;
            if (expiresAt) decisionData.expires_at = expiresAt;

            let decision;

            if (existingDecision) {
              // Update existing
              const { data: updatedDecision, error: updateError } = await supabaseAdmin
                .from('issue_decisions')
                .update(decisionData)
                .eq('id', existingDecision.id)
                .select()
                .single();

              if (updateError) {
                results.push({ issueId, success: false, error: updateError.message });
                continue;
              }

              decision = updatedDecision;
            } else {
              // Create new
              const { data: newDecision, error: createError } = await supabaseAdmin
                .from('issue_decisions')
                .insert(decisionData)
                .select()
                .single();

              if (createError) {
                results.push({ issueId, success: false, error: createError.message });
                continue;
              }

              decision = newDecision;
            }

            // Create event log entry
            await supabaseAdmin
              .from('issue_decision_events')
              .insert({
                decision_id: decision.id,
                event_type: existingDecision ? 'UPDATED' : 'CREATED',
                payload_json: {
                  disposition,
                  severityOverride,
                  assignedToUserId,
                  notes: notes ? notes.substring(0, 500) : undefined,
                },
                actor_user_id: context.userId,
              });

            results.push({ issueId, success: true });
          } catch (error: any) {
            results.push({ issueId, success: false, error: error.message });
          }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'issue.decision.bulk',
          targetType: 'issue_decision',
          meta: {
            issueCount: issueIds.length,
            successCount,
            failureCount,
            disposition,
          },
        });

        res.json({
          success: true,
          results,
          summary: {
            total: issueIds.length,
            success: successCount,
            failed: failureCount,
          },
        });
      } catch (error: any) {
        console.error('Bulk decisions error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );
}

