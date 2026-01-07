/**
 * Export Routes
 * Handles audit pack generation and status checking
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { generateAuditPack, AuditPackOptions } from './audit-pack.js';
import { requireCapability } from '../plans/capability-middleware.js';
import { Capability } from '../plans/capabilities.js';

// Store pack status in memory (in production, use Redis or database)
const packStatus = new Map<string, { status: 'processing' | 'completed' | 'failed'; result?: any; error?: string }>();

export function setupExportRoutes(app: express.Application) {
  // ============================================================================
  // POST /api/exports/audit-pack - Generate audit pack
  // ============================================================================
  // Requires EXPORT_JSON capability (audit pack includes JSON)
  app.post('/api/exports/audit-pack', requireCapability(Capability.EXPORT_JSON), async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const options: AuditPackOptions = {
        evaluationId: req.body.evaluationId,
        dateFrom: req.body.dateFrom,
        dateTo: req.body.dateTo,
        projectId: req.body.projectId || context.projectId,
        env: req.body.env || context.env,
        includeAllIssues: req.body.includeAllIssues !== false, // Default true
      };

      // Validate options
      if (!options.evaluationId && (!options.dateFrom || !options.dateTo)) {
        return res.status(400).json({ error: 'Either evaluationId or dateFrom/dateTo must be provided' });
      }

      // Generate pack ID immediately
      const packId = `pack-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Set status to processing
      packStatus.set(packId, { status: 'processing' });

      // Generate pack asynchronously
      generateAuditPack(options, context.orgId, supabaseAdmin)
        .then((result) => {
          packStatus.set(packId, { status: 'completed', result });
        })
        .catch((error) => {
          console.error('Audit pack generation error:', error);
          packStatus.set(packId, { status: 'failed', error: error.message });
        });

      // Return pack ID immediately
      res.json({
        packId,
        status: 'processing',
        message: 'Audit pack generation started. Use GET /api/exports/audit-pack/:packId/status to check progress.',
      });
    } catch (e: any) {
      console.error('Create audit pack error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/exports/audit-pack/:packId/status - Check pack generation status
  // ============================================================================
  app.get('/api/exports/audit-pack/:packId/status', async (req, res) => {
    try {
      const { packId } = req.params;
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const status = packStatus.get(packId);

      if (!status) {
        return res.status(404).json({ error: 'Pack not found' });
      }

      if (status.status === 'completed' && status.result) {
        res.json({
          packId,
          status: 'completed',
          downloadUrl: status.result.downloadUrl,
          files: status.result.files,
          checksum: status.result.checksum,
        });
      } else if (status.status === 'failed') {
        res.json({
          packId,
          status: 'failed',
          error: status.error,
        });
      } else {
        res.json({
          packId,
          status: 'processing',
          message: 'Pack generation in progress...',
        });
      }
    } catch (e: any) {
      console.error('Get pack status error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });
}

