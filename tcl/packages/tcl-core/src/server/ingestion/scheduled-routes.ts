/**
 * Scheduled Ingestion API Routes (SPEC 2)
 * 
 * Handles creation and management of ingestion sources and schedules
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { requirePermission } from '../permissions/middleware.js';

/**
 * Setup scheduled ingestion routes
 */
export function setupScheduledIngestionRoutes(app: express.Application) {
  // ============================================================================
  // Data Sources Management
  // ============================================================================

  // GET /api/ingest/sources - List sources
  app.get('/api/ingest/sources', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Database not configured' });
      }

      const { data: sources, error } = await supabaseAdmin
        .from('ingest_sources')
        .select('*')
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: `Failed to fetch sources: ${error.message}` });
      }

      res.json({ sources: sources || [] });
    } catch (error: any) {
      console.error('Get sources error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // POST /api/ingest/sources - Create source
  app.post(
    '/api/ingest/sources',
    requireEntitlement('batchIngestion'),
    requirePermission('create_batches'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { type, config_json, name, description } = req.body;

        if (!type || !config_json) {
          return res.status(400).json({ error: 'type and config_json are required' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Database not configured' });
        }

        const { data: source, error: sourceError } = await supabaseAdmin
          .from('ingest_sources')
          .insert({
            org_id: context.orgId,
            created_by_user_id: context.userId,
            type,
            config_json,
            name: name || null,
            description: description || null,
            enabled: true,
          })
          .select()
          .single();

        if (sourceError) {
          return res.status(500).json({ error: `Failed to create source: ${sourceError.message}` });
        }

        res.json({ source });
      } catch (error: any) {
        console.error('Create source error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // POST /api/ingest/sources/:id/test - Test source connection
  app.post('/api/ingest/sources/:id/test', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Database not configured' });
      }

      const { data: source, error: sourceError } = await supabaseAdmin
        .from('ingest_sources')
        .select('*')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();

      if (sourceError || !source) {
        return res.status(404).json({ error: 'Source not found' });
      }

      // TODO: Implement connection testing based on source type
      // For now, return success
      res.json({ success: true, message: 'Connection test not yet implemented' });
    } catch (error: any) {
      console.error('Test source error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // Schedules Management
  // ============================================================================

  // GET /api/ingest/schedules - List schedules
  app.get('/api/ingest/schedules', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Database not configured' });
      }

      const { data: schedules, error } = await supabaseAdmin
        .from('ingest_schedules')
        .select(`
          *,
          ingest_sources (
            id,
            name,
            type,
            config_json
          )
        `)
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: `Failed to fetch schedules: ${error.message}` });
      }

      res.json({ schedules: schedules || [] });
    } catch (error: any) {
      console.error('Get schedules error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // POST /api/ingest/schedules - Create schedule
  app.post(
    '/api/ingest/schedules',
    requireEntitlement('batchIngestion'),
    requirePermission('create_batches'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { source_id, name, rrule, template_id, mode, dedupe_strategy } = req.body;

        if (!source_id || !name || !rrule) {
          return res.status(400).json({ error: 'source_id, name, and rrule are required' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Database not configured' });
        }

        // Verify source belongs to org
        const { data: source } = await supabaseAdmin
          .from('ingest_sources')
          .select('id')
          .eq('id', source_id)
          .eq('org_id', context.orgId)
          .single();

        if (!source) {
          return res.status(404).json({ error: 'Source not found' });
        }

        // Calculate next run time
        const nextRunAt = calculateNextRunTime(rrule);

        const { data: schedule, error: scheduleError } = await supabaseAdmin
          .from('ingest_schedules')
          .insert({
            org_id: context.orgId,
            source_id,
            created_by_user_id: context.userId,
            name,
            rrule,
            template_id: template_id || null,
            mode: mode || 'AUDIO_PLUS_TRANSCRIPT',
            dedupe_strategy: dedupe_strategy || 'object_key_etag',
            enabled: true,
            next_run_at: nextRunAt,
          })
          .select()
          .single();

        if (scheduleError) {
          return res.status(500).json({ error: `Failed to create schedule: ${scheduleError.message}` });
        }

        res.json({ schedule });
      } catch (error: any) {
        console.error('Create schedule error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // PATCH /api/ingest/schedules/:id - Update schedule
  app.patch(
    '/api/ingest/schedules/:id',
    requireEntitlement('batchIngestion'),
    requirePermission('create_batches'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id } = req.params;
        const updates: any = {};

        if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
        if (req.body.name) updates.name = req.body.name;
        if (req.body.rrule) {
          updates.rrule = req.body.rrule;
          updates.next_run_at = calculateNextRunTime(req.body.rrule);
        }
        if (req.body.template_id !== undefined) updates.template_id = req.body.template_id;
        if (req.body.mode) updates.mode = req.body.mode;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Database not configured' });
        }

        const { data: schedule, error: updateError } = await supabaseAdmin
          .from('ingest_schedules')
          .update(updates)
          .eq('id', id)
          .eq('org_id', context.orgId)
          .select()
          .single();

        if (updateError || !schedule) {
          return res.status(updateError ? 500 : 404).json({ 
            error: updateError?.message || 'Schedule not found' 
          });
        }

        res.json({ schedule });
      } catch (error: any) {
        console.error('Update schedule error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // GET /api/ingest/schedules/:id/runs - Get schedule run history
  app.get('/api/ingest/schedules/:id/runs', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Database not configured' });
      }

      // Verify schedule belongs to org
      const { data: schedule } = await supabaseAdmin
        .from('ingest_schedules')
        .select('id')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();

      if (!schedule) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      const { data: runs, error: runsError } = await supabaseAdmin
        .from('ingest_schedule_runs')
        .select('*')
        .eq('schedule_id', id)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (runsError) {
        return res.status(500).json({ error: `Failed to fetch runs: ${runsError.message}` });
      }

      res.json({ runs: runs || [] });
    } catch (error: any) {
      console.error('Get schedule runs error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });
}

/**
 * Calculate next run time from RRULE
 */
function calculateNextRunTime(rruleText: string): string {
  try {
    // Simple RRULE parsing - for production, use a proper RRULE library
    // For now, support common patterns:
    // - "FREQ=HOURLY" -> 1 hour from now
    // - "FREQ=DAILY" -> 24 hours from now
    // - "FREQ=WEEKLY" -> 7 days from now
    // - Cron format: "0 * * * *" (hourly at minute 0)
    
    const now = new Date();
    let nextRun: Date;

    if (rruleText.includes('FREQ=HOURLY')) {
      nextRun = new Date(now.getTime() + 60 * 60 * 1000);
    } else if (rruleText.includes('FREQ=DAILY')) {
      nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    } else if (rruleText.includes('FREQ=WEEKLY')) {
      nextRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      // Default to 1 hour if parsing fails
      nextRun = new Date(now.getTime() + 60 * 60 * 1000);
    }

    return nextRun.toISOString();
  } catch (error: any) {
    console.error('[Scheduled Routes] Failed to parse RRULE:', error);
    // Default to 1 hour from now
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }
}

