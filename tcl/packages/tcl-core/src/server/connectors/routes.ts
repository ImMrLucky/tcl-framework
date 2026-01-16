import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { logAudit } from '../supabase.js';
import { s3Connector } from './s3-connector.js';
import { dropboxConnector } from './dropbox-connector.js';
import { gdriveConnector } from './gdrive-connector.js';
import type { ConnectorProvider } from './connector-provider.js';

/**
 * Get connector provider by type
 */
function getConnectorProvider(type: string): ConnectorProvider | null {
  switch (type.toUpperCase()) {
    case 'S3':
      return s3Connector;
    case 'DROPBOX':
      return dropboxConnector;
    case 'GDRIVE':
      return gdriveConnector;
    default:
      return null;
  }
}

/**
 * Get connector secrets from database
 */
async function getConnectorSecrets(
  orgId: string,
  connectorType: string,
  supabase: typeof supabaseAdmin
): Promise<Record<string, string> | null> {
  const { data: secrets, error } = await supabase!
    .from('integration_secrets')
    .select('key, ciphertext')
    .eq('org_id', orgId)
    .eq('integration_kind', connectorType.toUpperCase())
    .in('key', ['accessKeyId', 'secretAccessKey', 'accessToken']); // Common secret keys

  if (error || !secrets || secrets.length === 0) {
    return null;
  }

  const secretsMap: Record<string, string> = {};
  for (const secret of secrets) {
    // TODO: Decrypt ciphertext in production
    secretsMap[secret.key] = secret.ciphertext;
  }

  return secretsMap;
}

/**
 * Setup connector API routes
 */
export function setupConnectorRoutes(app: express.Application) {
  // ============================================================================
  // POST /api/connectors/:type/test - Test connector connection
  // ============================================================================
  app.post(
    '/api/connectors/:type/test',
    requireEntitlement('batchIngestion'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { type } = req.params;
        const { config, secrets } = req.body;

        const connector = getConnectorProvider(type);
        if (!connector) {
          return res.status(400).json({ error: `Unsupported connector type: ${type}` });
        }

        // If secrets not provided, try to get from database
        let connectorSecrets = secrets;
        if (!connectorSecrets && supabaseAdmin) {
          connectorSecrets = await getConnectorSecrets(context.orgId, type, supabaseAdmin) || {};
        }

        const result = await connector.testConnection(config || {}, connectorSecrets || {});

        res.json(result);
      } catch (error: any) {
        console.error('Test connector error:', error);
        res.status(500).json({ success: false, error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/connectors/:type/list - List objects from connector
  // ============================================================================
  app.get(
    '/api/connectors/:type/list',
    requireEntitlement('batchIngestion'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { type } = req.params;
        const path = req.query.path as string | undefined;
        const prefix = req.query.prefix as string | undefined;
        const limit = parseInt(req.query.limit as string) || 100;
        const offset = parseInt(req.query.offset as string) || 0;
        const recursive = req.query.recursive === 'true';

        const connector = getConnectorProvider(type);
        if (!connector) {
          return res.status(400).json({ error: `Unsupported connector type: ${type}` });
        }

        // Get config and secrets from request or database
        const config = req.query.config ? JSON.parse(req.query.config as string) : {};
        let secrets = req.query.secrets ? JSON.parse(req.query.secrets as string) : {};

        if (!secrets || Object.keys(secrets).length === 0) {
          if (supabaseAdmin) {
            secrets = await getConnectorSecrets(context.orgId, type, supabaseAdmin) || {};
          }
        }

        const result = await connector.list(
          { path, prefix, limit, offset, recursive },
          config,
          secrets
        );

        res.json(result);
      } catch (error: any) {
        console.error('List connector objects error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // POST /api/connectors/:type/batch-from-selection - Create batch from selected objects
  // ============================================================================
  app.post(
    '/api/connectors/:type/batch-from-selection',
    requireEntitlement('batchIngestion'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { type } = req.params;
        const { selection, config } = req.body;

        if (!selection || !Array.isArray(selection) || selection.length === 0) {
          return res.status(400).json({ error: 'selection array is required and must not be empty' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Create batch
        const { data: batch, error: batchError } = await supabaseAdmin
          .from('ingestion_batches')
          .insert({
            org_id: context.orgId,
            project_id: config?.projectId || context.projectId || null,
            env: config?.env || context.env || 'sandbox',
            created_by_user_id: context.userId,
            source_type: type.toUpperCase(),
            status: 'CREATED',
            config_json: config || {},
            progress_json: {
              total: selection.length,
              queued: 0,
              running: 0,
              complete: 0,
              failed: 0,
            },
          })
          .select()
          .single();

        if (batchError) {
          return res.status(500).json({ error: `Failed to create batch: ${batchError.message}` });
        }

        // Create batch items from selection
        const batchItems = selection.map((obj: any) => ({
          batch_id: batch.id,
          status: 'PENDING',
          mode: obj.mode || (obj.isDirectory ? 'TRANSCRIPT_ONLY' : 'AUDIO_PLUS_TRANSCRIPT'),
          title: obj.name || 'Untitled',
          channel: obj.channel || null,
          source_ref: {
            type: type.toUpperCase(),
            id: obj.id,
            path: obj.path,
            name: obj.name,
            size: obj.size,
            mimeType: obj.mimeType,
            ...obj.metadata,
          },
        }));

        const { data: createdItems, error: itemsError } = await supabaseAdmin
          .from('ingestion_batch_items')
          .insert(batchItems)
          .select();

        if (itemsError) {
          // Rollback batch
          await supabaseAdmin.from('ingestion_batches').delete().eq('id', batch.id);
          return res.status(500).json({ error: `Failed to create batch items: ${itemsError.message}` });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'batch_ingestion.create_from_connector',
          targetType: 'ingestion_batch',
          targetId: batch.id,
          meta: {
            connectorType: type,
            itemCount: selection.length,
          },
        });

        res.json({
          success: true,
          batch: {
            ...batch,
            itemCount: createdItems?.length || 0,
          },
        });
      } catch (error: any) {
        console.error('Create batch from selection error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );
}

