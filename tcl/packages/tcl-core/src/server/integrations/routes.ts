import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { encryptSecret } from '../security/secret-crypto.js';

/**
 * Setup integrations API routes
 */
export function setupIntegrationRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/integrations - List integrations
  // ============================================================================
  app.get('/api/integrations', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const kind = req.query.kind as string | undefined;

      let query = supabaseAdmin
        .from('enterprise_integrations')
        .select('*')
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });

      if (kind) {
        query = query.eq('kind', kind);
      }

      const { data: integrations, error } = await query;

      if (error) {
        return res.status(500).json({ error: `Failed to fetch integrations: ${error.message}` });
      }

      // Remove secrets from response (secrets are in separate table)
      const sanitizedIntegrations = (integrations || []).map((integration: any) => ({
        ...integration,
        // Ensure config_json doesn't contain secrets
        config_json: integration.config_json || {},
      }));

      res.json({ integrations: sanitizedIntegrations });
    } catch (error: any) {
      console.error('Get integrations error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // GET /api/integrations/:id - Get integration details
  // ============================================================================
  app.get('/api/integrations/:id', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: integration, error: integrationError } = await supabaseAdmin
        .from('enterprise_integrations')
        .select('*')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();

      if (integrationError) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      // Get recent exports for this integration
      const { data: recentExports } = await supabaseAdmin
        .from('integration_exports')
        .select('*')
        .eq('integration_id', id)
        .order('created_at', { ascending: false })
        .limit(10);

      res.json({
        integration: {
          ...integration,
          config_json: integration.config_json || {},
        },
        recentExports: recentExports || [],
      });
    } catch (error: any) {
      console.error('Get integration error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // POST /api/integrations - Create integration
  // ============================================================================
  app.post(
    '/api/integrations',
    requireEntitlement('integrations'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { kind, config, secrets } = req.body;

        if (!kind) {
          return res.status(400).json({ error: 'kind is required' });
        }

        const validKinds = ['JIRA', 'WEBHOOK', 'ZENDESK', 'SERVICENOW'];
        if (!validKinds.includes(kind)) {
          return res.status(400).json({ error: `Invalid kind: ${kind}. Must be one of: ${validKinds.join(', ')}` });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Create integration
        const { data: integration, error: integrationError } = await supabaseAdmin
          .from('enterprise_integrations')
          .insert({
            org_id: context.orgId,
            kind,
            status: 'ACTIVE',
            config_json: config || {},
            created_by_user_id: context.userId,
          })
          .select()
          .single();

        if (integrationError) {
          return res.status(500).json({ error: `Failed to create integration: ${integrationError.message}` });
        }

        // Store secrets if provided
        if (secrets && typeof secrets === 'object') {
          for (const [key, value] of Object.entries(secrets)) {
            if (value) {
              try {
                const encryptedValue = encryptSecret(value as string);
                const { error: secretError } = await supabaseAdmin
                  .from('integration_secrets')
                  .upsert({
                    org_id: context.orgId,
                    integration_id: integration.id,
                    integration_kind: kind,
                    key,
                    ciphertext: encryptedValue,
                  }, {
                    onConflict: 'org_id,integration_kind,key',
                  });

                if (secretError) {
                  console.error(`Failed to store secret ${key}:`, secretError);
                  // Continue even if secret storage fails
                }
              } catch (encryptError: any) {
                console.error(`Failed to encrypt secret ${key}:`, encryptError);
                // Continue even if encryption fails (will be caught by validation)
              }
            }
          }
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'integration.create',
          targetType: 'integration',
          targetId: integration.id,
          meta: { kind },
        });

        res.json({ success: true, integration });
      } catch (error: any) {
        console.error('Create integration error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // PATCH /api/integrations/:id - Update integration
  // ============================================================================
  app.patch(
    '/api/integrations/:id',
    requireEntitlement('integrations'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { id } = req.params;
        const { status, config, secrets } = req.body;

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Verify integration exists and belongs to org
        const { data: existingIntegration, error: fetchError } = await supabaseAdmin
          .from('enterprise_integrations')
          .select('id, kind')
          .eq('id', id)
          .eq('org_id', context.orgId)
          .single();

        if (fetchError || !existingIntegration) {
          return res.status(404).json({ error: 'Integration not found' });
        }

        // Build update object
        const updates: any = {};
        if (status !== undefined) {
          const validStatuses = ['ACTIVE', 'DISABLED'];
          if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status: ${status}` });
          }
          updates.status = status;
        }
        if (config !== undefined) {
          updates.config_json = config;
        }

        // Update integration
        const { data: updatedIntegration, error: updateError } = await supabaseAdmin
          .from('enterprise_integrations')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (updateError) {
          return res.status(500).json({ error: `Failed to update integration: ${updateError.message}` });
        }

        // Update secrets if provided
        if (secrets && typeof secrets === 'object') {
          for (const [key, value] of Object.entries(secrets)) {
            if (value) {
              try {
                const encryptedValue = encryptSecret(value as string);
                const { error: secretError } = await supabaseAdmin
                  .from('integration_secrets')
                  .upsert({
                    org_id: context.orgId,
                    integration_id: id,
                    integration_kind: existingIntegration.kind,
                    key,
                    ciphertext: encryptedValue,
                  }, {
                    onConflict: 'org_id,integration_kind,key',
                  });

                if (secretError) {
                  console.error(`Failed to update secret ${key}:`, secretError);
                }
              } catch (encryptError: any) {
                console.error(`Failed to encrypt secret ${key}:`, encryptError);
              }
            }
          }
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'integration.update',
          targetType: 'integration',
          targetId: id,
          meta: updates,
        });

        res.json({ success: true, integration: updatedIntegration });
      } catch (error: any) {
        console.error('Update integration error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // DELETE /api/integrations/:id - Delete integration
  // ============================================================================
  app.delete(
    '/api/integrations/:id',
    requireEntitlement('integrations'),
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

        // Verify integration exists and belongs to org
        const { data: existingIntegration, error: fetchError } = await supabaseAdmin
          .from('enterprise_integrations')
          .select('id, kind')
          .eq('id', id)
          .eq('org_id', context.orgId)
          .single();

        if (fetchError || !existingIntegration) {
          return res.status(404).json({ error: 'Integration not found' });
        }

        // Delete integration (cascade will delete secrets and exports)
        const { error: deleteError } = await supabaseAdmin
          .from('enterprise_integrations')
          .delete()
          .eq('id', id);

        if (deleteError) {
          return res.status(500).json({ error: `Failed to delete integration: ${deleteError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'integration.delete',
          targetType: 'integration',
          targetId: id,
          meta: { kind: existingIntegration.kind },
        });

        res.json({ success: true });
      } catch (error: any) {
        console.error('Delete integration error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/integrations/:id/exports - Get export history
  // ============================================================================
  app.get('/api/integrations/:id/exports', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Verify integration belongs to org
      const { data: integration } = await supabaseAdmin
        .from('enterprise_integrations')
        .select('id')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();

      if (!integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      const { data: exports, error: exportsError, count } = await supabaseAdmin
        .from('integration_exports')
        .select('*', { count: 'exact' })
        .eq('integration_id', id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (exportsError) {
        return res.status(500).json({ error: `Failed to fetch exports: ${exportsError.message}` });
      }

      res.json({
        exports: exports || [],
        total: count || 0,
        limit,
        offset,
      });
    } catch (error: any) {
      console.error('Get integration exports error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });
}
