import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { requirePermission } from '../permissions/middleware.js';
import { exportCaseAsJSON, exportCaseAsPDF, exportCaseAsZIP } from '../exports/case-exports.js';

/**
 * Setup cases API routes
 */
export function setupCasesRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/cases - List cases
  // ============================================================================
  app.get('/api/cases', requirePermission('view_cases'), async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string | undefined;

      let query = supabaseAdmin
        .from('cases')
        .select('*, case_issues(count)', { count: 'exact' })
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data: cases, error, count } = await query;

      if (error) {
        return res.status(500).json({ error: `Failed to fetch cases: ${error.message}` });
      }

      // Transform to include issue count
      const casesWithCounts = (cases || []).map((c: any) => ({
        ...c,
        issueCount: c.case_issues?.[0]?.count || 0,
        case_issues: undefined, // Remove nested data
      }));

      res.json({
        cases: casesWithCounts,
        total: count || 0,
        limit,
        offset,
      });
    } catch (error: any) {
      console.error('Get cases error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // GET /api/cases/:id - Get case details
  // ============================================================================
  app.get('/api/cases/:id', requirePermission('view_cases'), async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: case_, error: caseError } = await supabaseAdmin
        .from('cases')
        .select('*')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();

      if (caseError) {
        return res.status(404).json({ error: 'Case not found' });
      }

      // Get case issues
      const { data: caseIssues, error: issuesError } = await supabaseAdmin
        .from('case_issues')
        .select('*')
        .eq('case_id', id)
        .order('added_at', { ascending: false });

      if (issuesError) {
        console.error('Failed to fetch case issues:', issuesError);
      }

      res.json({
        case: case_,
        issues: caseIssues || [],
        issueCount: (caseIssues || []).length,
      });
    } catch (error: any) {
      console.error('Get case error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // POST /api/cases - Create case
  // ============================================================================
  app.post(
    '/api/cases',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { title, description, projectId, ownerUserId } = req.body;

        if (!title) {
          return res.status(400).json({ error: 'title is required' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        const { data: case_, error: caseError } = await supabaseAdmin
          .from('cases')
          .insert({
            org_id: context.orgId,
            project_id: projectId || null,
            title,
            description: description || null,
            status: 'OPEN',
            owner_user_id: ownerUserId || context.userId,
          })
          .select()
          .single();

        if (caseError) {
          return res.status(500).json({ error: `Failed to create case: ${caseError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'case.create',
          targetType: 'case',
          targetId: case_.id,
          meta: { title },
        });

        res.json({ success: true, case: case_ });
      } catch (error: any) {
        console.error('Create case error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // PATCH /api/cases/:id - Update case
  // ============================================================================
  app.patch(
    '/api/cases/:id',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id } = req.params;
        const { title, description, status, ownerUserId } = req.body;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Verify case exists and belongs to org
        const { data: existingCase, error: fetchError } = await supabaseAdmin
          .from('cases')
          .select('id')
          .eq('id', id)
          .eq('org_id', context.orgId)
          .single();

        if (fetchError || !existingCase) {
          return res.status(404).json({ error: 'Case not found' });
        }

        // Build update object
        const updates: any = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) {
          const validStatuses = ['OPEN', 'IN_REVIEW', 'CLOSED'];
          if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status: ${status}` });
          }
          updates.status = status;
        }
        if (ownerUserId !== undefined) updates.owner_user_id = ownerUserId;

        const { data: updatedCase, error: updateError } = await supabaseAdmin
          .from('cases')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (updateError) {
          return res.status(500).json({ error: `Failed to update case: ${updateError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'case.update',
          targetType: 'case',
          targetId: id,
          meta: updates,
        });

        res.json({ success: true, case: updatedCase });
      } catch (error: any) {
        console.error('Update case error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // DELETE /api/cases/:id - Delete case
  // ============================================================================
  app.delete(
    '/api/cases/:id',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id } = req.params;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Verify case exists and belongs to org
        const { data: existingCase, error: fetchError } = await supabaseAdmin
          .from('cases')
          .select('id, title')
          .eq('id', id)
          .eq('org_id', context.orgId)
          .single();

        if (fetchError || !existingCase) {
          return res.status(404).json({ error: 'Case not found' });
        }

        // Delete case (cascade will delete case_issues)
        const { error: deleteError } = await supabaseAdmin
          .from('cases')
          .delete()
          .eq('id', id);

        if (deleteError) {
          return res.status(500).json({ error: `Failed to delete case: ${deleteError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'case.delete',
          targetType: 'case',
          targetId: id,
          meta: { title: existingCase.title },
        });

        res.json({ success: true });
      } catch (error: any) {
        console.error('Delete case error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // POST /api/cases/:id/issues - Add issue to case
  // ============================================================================
  app.post(
    '/api/cases/:id/issues',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id: caseId } = req.params;
        const { issueId, evaluationId } = req.body;

        if (!issueId) {
          return res.status(400).json({ error: 'issueId is required' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Verify case exists and belongs to org
        const { data: case_, error: caseError } = await supabaseAdmin
          .from('cases')
          .select('id, org_id')
          .eq('id', caseId)
          .eq('org_id', context.orgId)
          .single();

        if (caseError || !case_) {
          return res.status(404).json({ error: 'Case not found' });
        }

        // Check if issue already in case
        const { data: existing } = await supabaseAdmin
          .from('case_issues')
          .select('id')
          .eq('case_id', caseId)
          .eq('issue_id', issueId)
          .eq('evaluation_id', evaluationId || null)
          .maybeSingle();

        if (existing) {
          return res.status(409).json({ error: 'Issue already in case' });
        }

        // Add issue to case
        const { data: caseIssue, error: addError } = await supabaseAdmin
          .from('case_issues')
          .insert({
            case_id: caseId,
            issue_id: issueId,
            evaluation_id: evaluationId || null,
            added_by_user_id: context.userId,
          })
          .select()
          .single();

        if (addError) {
          return res.status(500).json({ error: `Failed to add issue to case: ${addError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'case.issue.add',
          targetType: 'case_issue',
          targetId: caseIssue.id,
          meta: { caseId, issueId, evaluationId },
        });

        res.json({ success: true, caseIssue });
      } catch (error: any) {
        console.error('Add issue to case error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // DELETE /api/cases/:id/issues/:issueId - Remove issue from case
  // ============================================================================
  app.delete(
    '/api/cases/:id/issues/:issueId',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id: caseId, issueId } = req.params;
        const evaluationId = req.query.evaluationId as string | undefined;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Verify case exists and belongs to org
        const { data: case_, error: caseError } = await supabaseAdmin
          .from('cases')
          .select('id')
          .eq('id', caseId)
          .eq('org_id', context.orgId)
          .single();

        if (caseError || !case_) {
          return res.status(404).json({ error: 'Case not found' });
        }

        // Build delete query
        let deleteQuery = supabaseAdmin
          .from('case_issues')
          .delete()
          .eq('case_id', caseId)
          .eq('issue_id', issueId);

        if (evaluationId) {
          deleteQuery = deleteQuery.eq('evaluation_id', evaluationId);
        } else {
          deleteQuery = deleteQuery.is('evaluation_id', null);
        }

        const { error: deleteError } = await deleteQuery;

        if (deleteError) {
          return res.status(500).json({ error: `Failed to remove issue from case: ${deleteError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'case.issue.remove',
          targetType: 'case_issue',
          meta: { caseId, issueId, evaluationId },
        });

        res.json({ success: true });
      } catch (error: any) {
        console.error('Remove issue from case error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/cases/:id/export/json - Export case as JSON
  // ============================================================================
  app.get(
    '/api/cases/:id/export/json',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id } = req.params;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        const exportResult = await exportCaseAsJSON(id, context.orgId, supabaseAdmin);

        // Record export in ledger
        await supabaseAdmin.from('exports').insert({
          org_id: context.orgId,
          project_id: context.projectId || null,
          export_type: 'CASE',
          target_id: id,
          format: 'JSON',
          filename: exportResult.filename,
          file_size_bytes: Buffer.from(exportResult.data).length,
          checksum: exportResult.checksum,
          created_by_user_id: context.userId,
        });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
        res.send(exportResult.data);
      } catch (error: any) {
        console.error('Export case JSON error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/cases/:id/export/pdf - Export case as PDF
  // ============================================================================
  app.get(
    '/api/cases/:id/export/pdf',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id } = req.params;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        const exportResult = await exportCaseAsPDF(id, context.orgId, supabaseAdmin);

        // Get file size from stream
        const buffer = await streamToBuffer(exportResult.stream);

        // Record export in ledger
        await supabaseAdmin.from('exports').insert({
          org_id: context.orgId,
          project_id: context.projectId || null,
          export_type: 'CASE',
          target_id: id,
          format: 'PDF',
          filename: exportResult.filename,
          file_size_bytes: buffer.length,
          checksum: exportResult.checksum,
          created_by_user_id: context.userId,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
        res.send(buffer);
      } catch (error: any) {
        console.error('Export case PDF error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/cases/:id/export/zip - Export case as ZIP
  // ============================================================================
  app.get(
    '/api/cases/:id/export/zip',
    requireEntitlement('cases'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id } = req.params;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        const exportResult = await exportCaseAsZIP(id, context.orgId, supabaseAdmin);

        // Get file size from stream
        const buffer = await streamToBuffer(exportResult.stream);

        // Record export in ledger
        await supabaseAdmin.from('exports').insert({
          org_id: context.orgId,
          project_id: context.projectId || null,
          export_type: 'CASE',
          target_id: id,
          format: 'ZIP',
          filename: exportResult.filename,
          file_size_bytes: buffer.length,
          checksum: exportResult.checksum,
          created_by_user_id: context.userId,
        });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
        res.send(buffer);
      } catch (error: any) {
        console.error('Export case ZIP error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );
}

/**
 * Helper: Convert stream to buffer
 */
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

