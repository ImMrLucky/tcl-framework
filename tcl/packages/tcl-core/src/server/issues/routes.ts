/**
 * Issue Workflow Routes
 * Handles issue triage: status, assignment, comments, and activity log
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';

export function setupIssueWorkflowRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/issues-v2 - List issues with filters and pagination
  // ============================================================================
  app.get('/api/issues-v2', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get user ID from token if available
      const authHeader = req.headers.authorization;
      let userId: string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
        userId = user?.id;
      }

      // Parse query parameters
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string | undefined;
      const severityDisplay = req.query.severityDisplay as string | undefined;
      const verificationLevel = req.query.verificationLevel as string | undefined;
      const category = req.query.category as string | undefined;
      const type = req.query.type as string | undefined;
      const assigneeUserId = req.query.assigneeUserId as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const evaluationId = req.query.evaluationId as string | undefined;

      // Build evaluation query
      let evalQuery = supabaseAdmin
        .from('evaluations')
        .select('id, report, created_at')
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (evaluationId) {
        evalQuery = evalQuery.eq('id', evaluationId);
      }

      if (dateFrom || dateTo) {
        if (dateFrom) {
          evalQuery = evalQuery.gte('created_at', dateFrom);
        }
        if (dateTo) {
          evalQuery = evalQuery.lte('created_at', dateTo);
        }
      }

      const { data: evaluations, error: evalError } = await evalQuery;

      if (evalError) {
        return res.status(500).json({ error: evalError.message });
      }

      if (!evaluations || evaluations.length === 0) {
        return res.json({ issues: [], total: 0 });
      }

      // Extract all issues from evaluations
      const allIssues: any[] = [];
      for (const eval_ of evaluations) {
        const report = eval_.report as any;
        const issues = report?.issues || report?.topIssuesV2 || report?.allIssuesV2 || [];
        
        for (const issue of issues) {
          // Add evaluation metadata
          allIssues.push({
            ...issue,
            evaluationId: eval_.id,
            evaluationCreatedAt: eval_.created_at,
          });
        }
      }

      // Get workflow records for all issue IDs
      const issueIds = allIssues.map(i => i.issueId).filter(Boolean);
      const { data: workflows, error: workflowError } = await supabaseAdmin
        .from('issue_workflow')
        .select('*')
        .in('issue_id', issueIds)
        .eq('org_id', context.orgId);

      if (workflowError) {
        console.error('Error fetching workflows:', workflowError);
      }

      // Create a map of issue_id -> workflow
      const workflowMap = new Map((workflows || []).map(w => [w.issue_id, w]));

      // Merge issues with workflow data
      let enrichedIssues = allIssues.map(issue => {
        const workflow = workflowMap.get(issue.issueId);
        return {
          ...issue,
          status: workflow?.status || 'OPEN',
          assigneeUserId: workflow?.assignee_user_id || null,
          workflowUpdatedAt: workflow?.updated_at || null,
        };
      });

      // Apply filters
      if (status) {
        enrichedIssues = enrichedIssues.filter(i => i.status === status);
      }
      if (severityDisplay) {
        enrichedIssues = enrichedIssues.filter(i => i.severityDisplay === severityDisplay);
      }
      if (verificationLevel) {
        enrichedIssues = enrichedIssues.filter(i => i.verification?.level === verificationLevel);
      }
      if (category) {
        enrichedIssues = enrichedIssues.filter(i => i.category === category);
      }
      if (type) {
        enrichedIssues = enrichedIssues.filter(i => i.type === type);
      }
      if (assigneeUserId) {
        enrichedIssues = enrichedIssues.filter(i => i.assigneeUserId === assigneeUserId);
      }

      // Sort by riskScore descending, then by createdAt
      enrichedIssues.sort((a, b) => {
        const scoreA = a.score ?? (a.riskScore ?? 0) * 100;
        const scoreB = b.score ?? (b.riskScore ?? 0) * 100;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        const dateA = new Date(a.evaluationCreatedAt || a.audit?.createdAt || 0).getTime();
        const dateB = new Date(b.evaluationCreatedAt || b.audit?.createdAt || 0).getTime();
        return dateB - dateA;
      });

      // Paginate
      const total = enrichedIssues.length;
      const paginatedIssues = enrichedIssues.slice(offset, offset + limit);

      res.json({
        issues: paginatedIssues,
        total,
        limit,
        offset,
      });
    } catch (e: any) {
      console.error('Get issues-v2 error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/issues-v2/:issueId/status - Update issue status
  // ============================================================================
  app.post('/api/issues-v2/:issueId/status', async (req, res) => {
    try {
      const { issueId } = req.params;
      const { status } = req.body;

      if (!status || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be OPEN, ACKNOWLEDGED, RESOLVED, or FALSE_POSITIVE' });
      }

      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get user ID
      const authHeader = req.headers.authorization;
      let userId: string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
        userId = user?.id;
      }

      if (!userId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      // Get or create workflow record
      const { data: existingWorkflow } = await supabaseAdmin
        .from('issue_workflow')
        .select('*')
        .eq('issue_id', issueId)
        .eq('org_id', context.orgId)
        .maybeSingle();

      const oldStatus = existingWorkflow?.status || 'OPEN';

      // Upsert workflow record
      const { data: workflow, error: workflowError } = await supabaseAdmin
        .from('issue_workflow')
        .upsert({
          issue_id: issueId,
          org_id: context.orgId,
          status,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'issue_id',
        })
        .select()
        .single();

      if (workflowError) {
        return res.status(500).json({ error: workflowError.message });
      }

      // Log action
      await supabaseAdmin
        .from('issue_actions_log')
        .insert({
          issue_id: issueId,
          org_id: context.orgId,
          actor_user_id: userId,
          action_type: 'STATUS_CHANGE',
          payload_json: {
            oldStatus,
            newStatus: status,
          },
        });

      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'issue.status.update',
        targetType: 'issue',
        targetId: issueId,
        meta: { oldStatus, newStatus: status },
      });

      res.json({ success: true, workflow });
    } catch (e: any) {
      console.error('Update issue status error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/issues-v2/:issueId/assign - Assign issue to user
  // ============================================================================
  app.post('/api/issues-v2/:issueId/assign', async (req, res) => {
    try {
      const { issueId } = req.params;
      const { assigneeUserId } = req.body; // null to unassign

      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get actor user ID
      const authHeader = req.headers.authorization;
      let actorUserId: string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
        actorUserId = user?.id;
      }

      if (!actorUserId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      // Get existing workflow
      const { data: existingWorkflow } = await supabaseAdmin
        .from('issue_workflow')
        .select('*')
        .eq('issue_id', issueId)
        .eq('org_id', context.orgId)
        .maybeSingle();

      const oldAssignee = existingWorkflow?.assignee_user_id || null;

      // Upsert workflow record
      const { data: workflow, error: workflowError } = await supabaseAdmin
        .from('issue_workflow')
        .upsert({
          issue_id: issueId,
          org_id: context.orgId,
          assignee_user_id: assigneeUserId || null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'issue_id',
        })
        .select()
        .single();

      if (workflowError) {
        return res.status(500).json({ error: workflowError.message });
      }

      // Log action
      await supabaseAdmin
        .from('issue_actions_log')
        .insert({
          issue_id: issueId,
          org_id: context.orgId,
          actor_user_id: actorUserId,
          action_type: 'ASSIGNMENT',
          payload_json: {
            oldAssignee,
            newAssignee: assigneeUserId || null,
          },
        });

      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'issue.assign',
        targetType: 'issue',
        targetId: issueId,
        meta: { oldAssignee, newAssignee: assigneeUserId },
      });

      res.json({ success: true, workflow });
    } catch (e: any) {
      console.error('Assign issue error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/issues-v2/:issueId/comment - Add comment to issue
  // ============================================================================
  app.post('/api/issues-v2/:issueId/comment', async (req, res) => {
    try {
      const { issueId } = req.params;
      const { body } = req.body;

      if (!body || typeof body !== 'string' || body.trim().length === 0) {
        return res.status(400).json({ error: 'Comment body is required' });
      }

      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get user ID
      const authHeader = req.headers.authorization;
      let userId: string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
        userId = user?.id;
      }

      if (!userId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      // Ensure workflow record exists
      await supabaseAdmin
        .from('issue_workflow')
        .upsert({
          issue_id: issueId,
          org_id: context.orgId,
        }, {
          onConflict: 'issue_id',
        });

      // Insert comment
      const { data: comment, error: commentError } = await supabaseAdmin
        .from('issue_comments')
        .insert({
          issue_id: issueId,
          org_id: context.orgId,
          actor_user_id: userId,
          body: body.trim(),
        })
        .select()
        .single();

      if (commentError) {
        return res.status(500).json({ error: commentError.message });
      }

      // Log action
      await supabaseAdmin
        .from('issue_actions_log')
        .insert({
          issue_id: issueId,
          org_id: context.orgId,
          actor_user_id: userId,
          action_type: 'COMMENT',
          payload_json: {
            commentId: comment.id,
          },
        });

      res.json({ success: true, comment });
    } catch (e: any) {
      console.error('Add comment error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/issues-v2/:issueId/activity - Get activity log (comments + actions)
  // ============================================================================
  app.get('/api/issues-v2/:issueId/activity', async (req, res) => {
    try {
      const { issueId } = req.params;

      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get comments
      const { data: comments, error: commentsError } = await supabaseAdmin
        .from('issue_comments')
        .select('*, actor_user_id')
        .eq('issue_id', issueId)
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (commentsError) {
        return res.status(500).json({ error: commentsError.message });
      }

      // Get action log
      const { data: actions, error: actionsError } = await supabaseAdmin
        .from('issue_actions_log')
        .select('*, actor_user_id')
        .eq('issue_id', issueId)
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (actionsError) {
        return res.status(500).json({ error: actionsError.message });
      }

      // Get user profiles for actors
      const userIds = new Set<string>();
      (comments || []).forEach(c => c.actor_user_id && userIds.add(c.actor_user_id));
      (actions || []).forEach(a => a.actor_user_id && userIds.add(a.actor_user_id));

      const userProfiles: Record<string, any> = {};
      if (userIds.size > 0) {
        const { data: profiles } = await supabaseAdmin
          .from('profiles')
          .select('id, email, full_name')
          .in('id', Array.from(userIds));

        (profiles || []).forEach(p => {
          userProfiles[p.id] = p;
        });
      }

      // Combine and sort by created_at
      const activity = [
        ...(comments || []).map(c => ({
          type: 'comment' as const,
          id: c.id,
          actor: userProfiles[c.actor_user_id] || { id: c.actor_user_id },
          body: c.body,
          createdAt: c.created_at,
        })),
        ...(actions || []).map(a => ({
          type: 'action' as const,
          id: a.id,
          actor: userProfiles[a.actor_user_id] || { id: a.actor_user_id },
          actionType: a.action_type,
          payload: a.payload_json,
          createdAt: a.created_at,
        })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({ activity });
    } catch (e: any) {
      console.error('Get activity error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/issues-v2/bulk - Bulk actions (status change, assignment)
  // ============================================================================
  app.post('/api/issues-v2/bulk', async (req, res) => {
    try {
      const { issueIds, action, payload } = req.body;

      if (!Array.isArray(issueIds) || issueIds.length === 0) {
        return res.status(400).json({ error: 'issueIds must be a non-empty array' });
      }

      if (!action || !['status', 'assign'].includes(action)) {
        return res.status(400).json({ error: 'action must be "status" or "assign"' });
      }

      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get user ID
      const authHeader = req.headers.authorization;
      let userId: string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
        userId = user?.id;
      }

      if (!userId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      const results: any[] = [];
      const errors: any[] = [];

      for (const issueId of issueIds) {
        try {
          if (action === 'status') {
            const status = payload?.status;
            if (!status || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) {
              errors.push({ issueId, error: 'Invalid status' });
              continue;
            }

            await supabaseAdmin
              .from('issue_workflow')
              .upsert({
                issue_id: issueId,
                org_id: context.orgId,
                status,
                updated_at: new Date().toISOString(),
              }, {
                onConflict: 'issue_id',
              });

            await supabaseAdmin
              .from('issue_actions_log')
              .insert({
                issue_id: issueId,
                org_id: context.orgId,
                actor_user_id: userId,
                action_type: 'BULK_STATUS_CHANGE',
                payload_json: { status },
              });

            results.push({ issueId, success: true });
          } else if (action === 'assign') {
            const assigneeUserId = payload?.assigneeUserId;

            await supabaseAdmin
              .from('issue_workflow')
              .upsert({
                issue_id: issueId,
                org_id: context.orgId,
                assignee_user_id: assigneeUserId || null,
                updated_at: new Date().toISOString(),
              }, {
                onConflict: 'issue_id',
              });

            await supabaseAdmin
              .from('issue_actions_log')
              .insert({
                issue_id: issueId,
                org_id: context.orgId,
                actor_user_id: userId,
                action_type: 'BULK_ASSIGNMENT',
                payload_json: { assigneeUserId },
              });

            results.push({ issueId, success: true });
          }
        } catch (e: any) {
          errors.push({ issueId, error: e.message });
        }
      }

      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: `issue.bulk.${action}`,
        targetType: 'issue',
        meta: { issueIds, action, payload, resultsCount: results.length, errorsCount: errors.length },
      });

      res.json({ results, errors });
    } catch (e: any) {
      console.error('Bulk action error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });
}

