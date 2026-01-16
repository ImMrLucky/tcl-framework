import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { getWebhookIntegration, deliverWebhook } from '../integrations/webhooks.js';

/**
 * Setup issue snapshots and locks API routes
 */
export function setupIssueSnapshotsRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/issues/:issueId/snapshots - Get snapshots for an issue
  // ============================================================================
  app.get('/api/issues/:issueId/snapshots', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { issueId } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: snapshots, error: snapshotsError } = await supabaseAdmin
        .from('issue_snapshots')
        .select('*')
        .eq('org_id', context.orgId)
        .eq('issue_id', issueId)
        .order('created_at', { ascending: false });

      if (snapshotsError) {
        return res.status(500).json({ error: `Failed to fetch snapshots: ${snapshotsError.message}` });
      }

      res.json({ snapshots: snapshots || [] });
    } catch (error: any) {
      console.error('Get issue snapshots error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // GET /api/issues/:issueId/lock - Get lock status for an issue
  // ============================================================================
  app.get('/api/issues/:issueId/lock', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { issueId } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: lock, error: lockError } = await supabaseAdmin
        .from('issue_locks')
        .select('*')
        .eq('org_id', context.orgId)
        .eq('issue_id', issueId)
        .eq('status', 'LOCKED')
        .order('locked_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lockError) {
        return res.status(500).json({ error: `Failed to fetch lock: ${lockError.message}` });
      }

      res.json({ lock: lock || null });
    } catch (error: any) {
      console.error('Get issue lock error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // POST /api/issues/:issueId/lock - Lock an issue (creates snapshot)
  // ============================================================================
  app.post(
    '/api/issues/:issueId/lock',
    requireEntitlement('legalHold'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { issueId } = req.params;
        const { reason, issueSnapshot, evaluationId, projectId, evidenceSetHash, inputHash, engineVersion } = req.body;

        if (!issueSnapshot) {
          return res.status(400).json({ error: 'issueSnapshot is required' });
        }

        if (!evaluationId) {
          return res.status(400).json({ error: 'evaluationId is required' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Check if issue is already locked
        const { data: existingLock } = await supabaseAdmin
          .from('issue_locks')
          .select('id')
          .eq('org_id', context.orgId)
          .eq('issue_id', issueId)
          .eq('status', 'LOCKED')
          .maybeSingle();

        if (existingLock) {
          return res.status(409).json({ error: 'Issue is already locked' });
        }

        // Create snapshot first
        const { data: snapshot, error: snapshotError } = await supabaseAdmin
          .from('issue_snapshots')
          .insert({
            org_id: context.orgId,
            project_id: projectId || null,
            evaluation_id: evaluationId,
            issue_id: issueId,
            snapshot_json: issueSnapshot,
            evidence_set_hash: evidenceSetHash || null,
            input_hash: inputHash || null,
            engine_version: engineVersion || null,
            created_by_user_id: context.userId,
          })
          .select()
          .single();

        if (snapshotError) {
          return res.status(500).json({ error: `Failed to create snapshot: ${snapshotError.message}` });
        }

        // Create lock
        const { data: lock, error: lockError } = await supabaseAdmin
          .from('issue_locks')
          .insert({
            org_id: context.orgId,
            issue_id: issueId,
            status: 'LOCKED',
            locked_by_user_id: context.userId,
            reason: reason || null,
            snapshot_id: snapshot.id,
          })
          .select()
          .single();

        if (lockError) {
          // Rollback snapshot if lock creation fails
          await supabaseAdmin.from('issue_snapshots').delete().eq('id', snapshot.id);
          return res.status(500).json({ error: `Failed to create lock: ${lockError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'issue.lock',
          targetType: 'issue_lock',
          targetId: lock.id,
          meta: {
            issueId,
            reason,
            snapshotId: snapshot.id,
          },
        });

        // Emit webhook event if webhook integration is active
        try {
          const webhookIntegration = await getWebhookIntegration(context.orgId, supabaseAdmin);
          if (webhookIntegration) {
            const config = webhookIntegration.config_json as any;
            const enabledEvents = config.enabled_events || [];
            if (enabledEvents.includes('issue.locked') || enabledEvents.includes('*')) {
              await deliverWebhook(
                webhookIntegration.id,
                context.orgId,
                'issue.locked',
                {
                  event_type: 'issue.locked',
                  timestamp: new Date().toISOString(),
                  org_id: context.orgId,
                  issue_id: issueId,
                  lock: {
                    id: lock.id,
                    reason,
                    snapshot_id: snapshot.id,
                  },
                },
                config
              ).catch((error) => {
                console.error('Failed to deliver webhook for issue lock:', error);
              });
            }
          }
        } catch (webhookError) {
          console.error('Webhook delivery error (non-fatal):', webhookError);
        }

        res.json({ success: true, lock, snapshot });
      } catch (error: any) {
        console.error('Lock issue error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // POST /api/issues/:issueId/unlock - Unlock an issue
  // ============================================================================
  app.post(
    '/api/issues/:issueId/unlock',
    requireEntitlement('legalHold'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { issueId } = req.params;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Get existing lock
        const { data: lock, error: lockError } = await supabaseAdmin
          .from('issue_locks')
          .select('*')
          .eq('org_id', context.orgId)
          .eq('issue_id', issueId)
          .eq('status', 'LOCKED')
          .maybeSingle();

        if (lockError) {
          return res.status(500).json({ error: `Failed to fetch lock: ${lockError.message}` });
        }

        if (!lock) {
          return res.status(404).json({ error: 'Issue is not locked' });
        }

        // Unlock (update status)
        const { data: updatedLock, error: updateError } = await supabaseAdmin
          .from('issue_locks')
          .update({
            status: 'UNLOCKED',
            unlocked_by_user_id: context.userId,
            unlocked_at: new Date().toISOString(),
          })
          .eq('id', lock.id)
          .select()
          .single();

        if (updateError) {
          return res.status(500).json({ error: `Failed to unlock issue: ${updateError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'issue.unlock',
          targetType: 'issue_lock',
          targetId: lock.id,
          meta: { issueId },
        });

        res.json({ success: true, lock: updatedLock });
      } catch (error: any) {
        console.error('Unlock issue error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/issues/:issueId/snapshots/:snapshotId - Get specific snapshot
  // ============================================================================
  app.get('/api/issues/:issueId/snapshots/:snapshotId', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { issueId, snapshotId } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: snapshot, error: snapshotError } = await supabaseAdmin
        .from('issue_snapshots')
        .select('*')
        .eq('id', snapshotId)
        .eq('org_id', context.orgId)
        .eq('issue_id', issueId)
        .single();

      if (snapshotError) {
        return res.status(404).json({ error: 'Snapshot not found' });
      }

      res.json({ snapshot });
    } catch (error: any) {
      console.error('Get snapshot error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });
}

