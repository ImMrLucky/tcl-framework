/**
 * Evidence Routes
 * Provides evidence CRUD operations and coverage statistics
 * Part of ProtectQA Evidence/Policy System
 */

import express from 'express';
import multer from 'multer';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import fs from 'fs';
import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import {
  createEvidenceItem,
  getEvidenceItemById,
  listEvidenceItems,
  updateEvidenceItem,
  approveEvidenceItem,
  deprecateEvidenceItem,
  updateIndexingStatus,
  resolveEvidenceSet,
} from './service.js';
import {
  storeEvidenceFile,
  storeEvidenceFileFromBuffer,
  snapshotEvidenceLink,
  createEvidenceFileSignedUrl,
} from './storage.js';
import { logAudit } from '../supabase.js';

const fsUnlink = promisify(fs.unlink);
const fsMkdir = promisify(fs.mkdir);

// Configure multer for file uploads
const upload = multer({
  dest: join(tmpdir(), 'evidence-uploads'),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

export function setupEvidenceRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/evidence/coverage - Get evidence coverage statistics
  // ============================================================================
  app.get('/api/evidence/coverage', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const dateFrom = req.query.from as string | undefined;
      const dateTo = req.query.to as string | undefined;
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build evaluation query
      let evalQuery = supabaseAdmin
        .from('evaluations')
        .select('id, report, created_at')
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (projectId) {
        evalQuery = evalQuery.eq('project_id', projectId);
      }
      if (env) {
        evalQuery = evalQuery.eq('env', env);
      }
      if (dateFrom) {
        evalQuery = evalQuery.gte('created_at', dateFrom);
      }
      if (dateTo) {
        evalQuery = evalQuery.lte('created_at', dateTo);
      }

      const { data: evaluations, error: evalError } = await evalQuery;

      if (evalError) {
        return res.status(500).json({ error: evalError.message });
      }

      if (!evaluations || evaluations.length === 0) {
        return res.json({
          totalIssues: 0,
          externalVerified: 0,
          transcriptOnly: 0,
          none: 0,
          verifiedPercent: 0,
          transcriptOnlyPercent: 0,
          unverifiedPercent: 0,
          byCategory: {},
          byType: {},
        });
      }

      // Extract all issues from evaluations
      let totalIssues = 0;
      let externalVerified = 0;
      let transcriptOnly = 0;
      let none = 0;
      const byCategory: Record<string, { total: number; externalVerified: number; transcriptOnly: number; none: number }> = {};
      const byType: Record<string, { total: number; externalVerified: number; transcriptOnly: number; none: number }> = {};

      for (const eval_ of evaluations) {
        const report = eval_.report as any;
        const issues = report?.allIssuesV2 || report?.topIssuesV2 || report?.issues || [];

        for (const issue of issues) {
          totalIssues++;
          const verificationLevel = issue.verification?.level || 'NONE';
          const category = issue.category || 'other';
          const type = issue.type || 'OTHER';

          // Count by verification level
          if (verificationLevel === 'EXTERNAL_VERIFIED') {
            externalVerified++;
          } else if (verificationLevel === 'TRANSCRIPT_ONLY') {
            transcriptOnly++;
          } else {
            none++;
          }

          // Count by category
          if (!byCategory[category]) {
            byCategory[category] = { total: 0, externalVerified: 0, transcriptOnly: 0, none: 0 };
          }
          byCategory[category].total++;
          if (verificationLevel === 'EXTERNAL_VERIFIED') {
            byCategory[category].externalVerified++;
          } else if (verificationLevel === 'TRANSCRIPT_ONLY') {
            byCategory[category].transcriptOnly++;
          } else {
            byCategory[category].none++;
          }

          // Count by type
          if (!byType[type]) {
            byType[type] = { total: 0, externalVerified: 0, transcriptOnly: 0, none: 0 };
          }
          byType[type].total++;
          if (verificationLevel === 'EXTERNAL_VERIFIED') {
            byType[type].externalVerified++;
          } else if (verificationLevel === 'TRANSCRIPT_ONLY') {
            byType[type].transcriptOnly++;
          } else {
            byType[type].none++;
          }
        }
      }

      const verifiedPercent = totalIssues > 0 ? Math.round((externalVerified / totalIssues) * 100 * 10) / 10 : 0;
      const transcriptOnlyPercent = totalIssues > 0 ? Math.round((transcriptOnly / totalIssues) * 100 * 10) / 10 : 0;
      const unverifiedPercent = totalIssues > 0 ? Math.round((none / totalIssues) * 100 * 10) / 10 : 0;

      res.json({
        totalIssues,
        externalVerified,
        transcriptOnly,
        none,
        verifiedPercent,
        transcriptOnlyPercent,
        unverifiedPercent,
        byCategory,
        byType,
      });
    } catch (e: any) {
      console.error('Get evidence coverage error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/evidence/gaps - Get evidence gap recommendations
  // ============================================================================
  app.get('/api/evidence/gaps', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const dateFrom = req.query.from as string | undefined;
      const dateTo = req.query.to as string | undefined;
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build evaluation query
      let evalQuery = supabaseAdmin
        .from('evaluations')
        .select('id, report, created_at')
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (projectId) {
        evalQuery = evalQuery.eq('project_id', projectId);
      }
      if (env) {
        evalQuery = evalQuery.eq('env', env);
      }
      if (dateFrom) {
        evalQuery = evalQuery.gte('created_at', dateFrom);
      }
      if (dateTo) {
        evalQuery = evalQuery.lte('created_at', dateTo);
      }

      const { data: evaluations, error: evalError } = await evalQuery;

      if (evalError) {
        return res.status(500).json({ error: evalError.message });
      }

      if (!evaluations || evaluations.length === 0) {
        return res.json({ gaps: [] });
      }

      // Analyze gaps: collect recommended evidence from issues
      const gapMap = new Map<string, { count: number; categories: Set<string>; types: Set<string>; examples: string[] }>();

      for (const eval_ of evaluations) {
        const report = eval_.report as any;
        const issues = report?.allIssuesV2 || report?.topIssuesV2 || report?.issues || [];

        for (const issue of issues) {
          const verificationLevel = issue.verification?.level || 'NONE';
          
          // Only consider issues that need external evidence
          if (verificationLevel === 'TRANSCRIPT_ONLY' || verificationLevel === 'NONE') {
            // Check for recommended action with required evidence
            if (issue.recommendedAction?.requiredEvidence) {
              for (const evidence of issue.recommendedAction.requiredEvidence) {
                const key = evidence.toLowerCase().trim();
                if (!gapMap.has(key)) {
                  gapMap.set(key, {
                    count: 0,
                    categories: new Set(),
                    types: new Set(),
                    examples: [],
                  });
                }
                const gap = gapMap.get(key)!;
                gap.count++;
                if (issue.category) gap.categories.add(issue.category);
                if (issue.type) gap.types.add(issue.type);
                if (issue.what?.issueSummary && gap.examples.length < 3) {
                  gap.examples.push(issue.what.issueSummary);
                }
              }
            } else {
              // Infer evidence needs from category/type
              let inferredEvidence: string[] = [];
              const category = issue.category || '';
              const type = issue.type || '';

              if (category === 'billing' || type.includes('BILLING') || type.includes('FEE')) {
                inferredEvidence.push('billing policy document');
                inferredEvidence.push('billing ledger');
              }
              if (category === 'compliance' || type.includes('COMPLIANCE')) {
                inferredEvidence.push('compliance policy document');
              }
              if (category === 'disclosure' || type.includes('DISCLOSURE')) {
                inferredEvidence.push('disclosure policy document');
              }
              if (type.includes('CONTRADICTION')) {
                inferredEvidence.push('source of truth document');
              }

              for (const evidence of inferredEvidence) {
                const key = evidence.toLowerCase().trim();
                if (!gapMap.has(key)) {
                  gapMap.set(key, {
                    count: 0,
                    categories: new Set(),
                    types: new Set(),
                    examples: [],
                  });
                }
                const gap = gapMap.get(key)!;
                gap.count++;
                if (issue.category) gap.categories.add(issue.category);
                if (issue.type) gap.types.add(issue.type);
                if (issue.what?.issueSummary && gap.examples.length < 3) {
                  gap.examples.push(issue.what.issueSummary);
                }
              }
            }
          }
        }
      }

      // Convert to array and sort by count
      const gaps = Array.from(gapMap.entries())
        .map(([evidence, data]) => ({
          evidence,
          count: data.count,
          categories: Array.from(data.categories),
          types: Array.from(data.types),
          examples: data.examples,
          priority: data.count > 10 ? 'high' : data.count > 5 ? 'medium' : 'low',
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20); // Top 20 gaps

      res.json({ gaps });
    } catch (e: any) {
      console.error('Get evidence gaps error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/evidence/upload - Upload evidence file
  // ============================================================================
  app.post('/api/evidence/upload', upload.single('file'), async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const {
        scope,
        sourceType,
        title,
        description,
        tags,
        regions,
        projectId,
        conversationId,
        templateId,
        status,
        version,
        effectiveFrom,
        effectiveTo,
      } = req.body;

      if (!scope || !sourceType || !title) {
        return res.status(400).json({ 
          error: 'Missing required fields: scope, sourceType, title' 
        });
      }

      // Validate scope
      const validScopes = ['ORG', 'PROJECT', 'TEMPLATE', 'CONVERSATION'];
      if (!validScopes.includes(scope)) {
        return res.status(400).json({ error: `Invalid scope. Must be one of: ${validScopes.join(', ')}` });
      }

      // Validate sourceType
      const validSourceTypes = ['POLICY', 'RULESET', 'KNOWLEDGE', 'ACCOUNT_FACTS', 'LEGAL', 'URL_LINK', 'SYSTEM_EXPORT'];
      if (!validSourceTypes.includes(sourceType)) {
        return res.status(400).json({ error: `Invalid sourceType. Must be one of: ${validSourceTypes.join(', ')}` });
      }

      // Generate evidence ID
      const evidenceId = crypto.randomUUID();

      // Store file in Supabase Storage
      const storageResult = await storeEvidenceFile(
        req.file.path,
        context.orgId,
        evidenceId,
        scope as any,
        req.file.originalname
      );

      // Parse tags and regions (comma-separated strings)
      const tagsArray = tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : [];
      const regionsArray = regions ? (typeof regions === 'string' ? regions.split(',').map(r => r.trim()) : regions) : [];

      // Create evidence item
      const evidenceItem = await createEvidenceItem({
        orgId: context.orgId,
        projectId: projectId || (scope === 'PROJECT' ? context.projectId : undefined),
        conversationId: conversationId || (scope === 'CONVERSATION' ? undefined : undefined),
        templateId: templateId || (scope === 'TEMPLATE' ? undefined : undefined),
        scope: scope as any,
        sourceType: sourceType as any,
        title,
        description: description || undefined,
        tags: tagsArray,
        regions: regionsArray,
        storageKind: 'FILE',
        file: {
          mimeType: storageResult.mimeType,
          sizeBytes: storageResult.sizeBytes,
          sha256: storageResult.sha256,
          storagePath: storageResult.storagePath,
          originalName: req.file.originalname,
        },
        status: (status as any) || 'DRAFT',
        version: version || '1.0.0',
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
        createdBy: context.userId || 'system',
      });

      // Clean up temp file
      try {
        await fsUnlink(req.file.path);
      } catch (err) {
        console.warn('Failed to clean up temp file:', err);
      }

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'evidence.upload',
        targetType: 'evidence_item',
        targetId: evidenceItem.id,
      });

      res.json(evidenceItem);
    } catch (e: any) {
      console.error('Upload evidence error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/evidence/link - Add evidence link (with optional snapshot)
  // ============================================================================
  app.post('/api/evidence/link', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const {
        url,
        scope,
        sourceType,
        title,
        description,
        tags,
        regions,
        projectId,
        conversationId,
        templateId,
        snapshotNow,
        status,
        version,
        effectiveFrom,
        effectiveTo,
      } = req.body;

      if (!url || !scope || !sourceType || !title) {
        return res.status(400).json({ 
          error: 'Missing required fields: url, scope, sourceType, title' 
        });
      }

      // Validate URL
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      // Validate scope and sourceType (same as upload)
      const validScopes = ['ORG', 'PROJECT', 'TEMPLATE', 'CONVERSATION'];
      if (!validScopes.includes(scope)) {
        return res.status(400).json({ error: `Invalid scope. Must be one of: ${validScopes.join(', ')}` });
      }

      const validSourceTypes = ['POLICY', 'RULESET', 'KNOWLEDGE', 'ACCOUNT_FACTS', 'LEGAL', 'URL_LINK', 'SYSTEM_EXPORT'];
      if (!validSourceTypes.includes(sourceType)) {
        return res.status(400).json({ error: `Invalid sourceType. Must be one of: ${validSourceTypes.join(', ')}` });
      }

      // Generate evidence ID
      const evidenceId = crypto.randomUUID();

      // Snapshot link if requested
      let linkResult;
      if (snapshotNow === true || snapshotNow === 'true') {
        linkResult = await snapshotEvidenceLink(url, context.orgId, evidenceId);
      } else {
        linkResult = {
          url,
          fetchedAt: new Date().toISOString(),
        };
      }

      // Parse tags and regions
      const tagsArray = tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : [];
      const regionsArray = regions ? (typeof regions === 'string' ? regions.split(',').map(r => r.trim()) : regions) : [];

      // Create evidence item
      const evidenceItem = await createEvidenceItem({
        orgId: context.orgId,
        projectId: projectId || (scope === 'PROJECT' ? context.projectId : undefined),
        conversationId: conversationId || (scope === 'CONVERSATION' ? undefined : undefined),
        templateId: templateId || (scope === 'TEMPLATE' ? undefined : undefined),
        scope: scope as any,
        sourceType: sourceType as any,
        title,
        description: description || undefined,
        tags: tagsArray,
        regions: regionsArray,
        storageKind: 'LINK',
        link: {
          url: linkResult.url,
          fetchedAt: linkResult.fetchedAt,
          sha256: linkResult.sha256,
          snapshotStoragePath: linkResult.snapshotStoragePath,
        },
        status: (status as any) || 'DRAFT',
        version: version || '1.0.0',
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
        createdBy: context.userId || 'system',
      });

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'evidence.link',
        targetType: 'evidence_item',
        targetId: evidenceItem.id,
      });

      res.json(evidenceItem);
    } catch (e: any) {
      console.error('Add evidence link error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/evidence - List evidence items
  // ============================================================================
  app.get('/api/evidence', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const {
        projectId,
        conversationId,
        templateId,
        scope,
        sourceType,
        status,
        indexStatus,
        tags,
        limit,
        offset,
      } = req.query;

      const result = await listEvidenceItems({
        orgId: context.orgId,
        projectId: projectId as string || (scope === 'PROJECT' ? context.projectId : undefined),
        conversationId: conversationId as string,
        templateId: templateId as string,
        scope: scope as any,
        sourceType: sourceType as any,
        status: status as any,
        indexStatus: indexStatus as any,
        tags: tags ? (typeof tags === 'string' ? [tags] : tags as string[]) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });

      res.json(result);
    } catch (e: any) {
      console.error('List evidence error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/evidence/:id - Get evidence item by ID
  // ============================================================================
  app.get('/api/evidence/:id', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;

      const evidenceItem = await getEvidenceItemById(id, context.orgId);

      if (!evidenceItem) {
        return res.status(404).json({ error: 'Evidence item not found' });
      }

      res.json(evidenceItem);
    } catch (e: any) {
      console.error('Get evidence error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // PATCH /api/evidence/:id - Update evidence item
  // ============================================================================
  app.patch('/api/evidence/:id', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;
      const {
        title,
        description,
        tags,
        regions,
        status,
        version,
        effectiveFrom,
        effectiveTo,
        ruleMeta,
      } = req.body;

      const evidenceItem = await updateEvidenceItem(
        id,
        context.orgId,
        {
          title,
          description,
          tags: tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : undefined,
          regions: regions ? (typeof regions === 'string' ? regions.split(',').map(r => r.trim()) : regions) : undefined,
          status: status as any,
          version,
          effectiveFrom,
          effectiveTo,
          ruleMeta,
        },
        context.userId
      );

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'evidence.update',
        targetType: 'evidence_item',
        targetId: id,
      });

      res.json(evidenceItem);
    } catch (e: any) {
      console.error('Update evidence error:', e);
      if (e.message?.includes('not found')) {
        return res.status(404).json({ error: 'Evidence item not found' });
      }
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/evidence/:id/approve - Approve evidence item
  // ============================================================================
  app.post('/api/evidence/:id/approve', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!context.userId) {
        return res.status(401).json({ error: 'User authentication required for approval' });
      }

      const { id } = req.params;

      const evidenceItem = await approveEvidenceItem(id, context.orgId, context.userId);

      res.json(evidenceItem);
    } catch (e: any) {
      console.error('Approve evidence error:', e);
      if (e.message?.includes('not found')) {
        return res.status(404).json({ error: 'Evidence item not found' });
      }
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/evidence/:id/deprecate - Deprecate evidence item
  // ============================================================================
  app.post('/api/evidence/:id/deprecate', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!context.userId) {
        return res.status(401).json({ error: 'User authentication required for deprecation' });
      }

      const { id } = req.params;
      const { notes } = req.body;

      const evidenceItem = await deprecateEvidenceItem(id, context.orgId, context.userId, notes);

      res.json(evidenceItem);
    } catch (e: any) {
      console.error('Deprecate evidence error:', e);
      if (e.message?.includes('not found')) {
        return res.status(404).json({ error: 'Evidence item not found' });
      }
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/evidence/:id/reindex - Trigger reindexing of evidence item
  // ============================================================================
  app.post('/api/evidence/:id/reindex', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;

      // Update status to PENDING to trigger reindexing
      await updateIndexingStatus(id, 'PENDING');

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'evidence.reindex',
        targetType: 'evidence_item',
        targetId: id,
      });

      res.json({ success: true, message: 'Reindexing triggered' });
    } catch (e: any) {
      console.error('Reindex evidence error:', e);
      if (e.message?.includes('not found')) {
        return res.status(404).json({ error: 'Evidence item not found' });
      }
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/evidence/:id/download - Get signed URL for evidence file download
  // ============================================================================
  app.get('/api/evidence/:id/download', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;
      const expiresIn = req.query.expiresIn ? parseInt(req.query.expiresIn as string, 10) : 3600;

      const evidenceItem = await getEvidenceItemById(id, context.orgId);

      if (!evidenceItem) {
        return res.status(404).json({ error: 'Evidence item not found' });
      }

      if (evidenceItem.storageKind !== 'FILE' || !evidenceItem.file) {
        return res.status(400).json({ error: 'Evidence item is not a file' });
      }

      const signedUrl = await createEvidenceFileSignedUrl(evidenceItem.file.storagePath, expiresIn);

      res.json({ url: signedUrl, expiresIn });
    } catch (e: any) {
      console.error('Get evidence download URL error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/evidence/resolve - Resolve evidence set for evaluation
  // ============================================================================
  app.get('/api/evidence/resolve', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const {
        projectId,
        templateId,
        conversationId,
        simulationMode,
        includeOrg,
        includeProject,
        includeTemplate,
      } = req.query;

      const evidenceSet = await resolveEvidenceSet(
        context.orgId,
        projectId as string || context.projectId,
        templateId as string,
        conversationId as string,
        simulationMode === 'true' || simulationMode === true,
        includeOrg !== 'false',
        includeProject !== 'false',
        includeTemplate !== 'false'
      );

      res.json(evidenceSet);
    } catch (e: any) {
      console.error('Resolve evidence set error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });
}

