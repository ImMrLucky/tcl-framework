import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { logAudit } from '../supabase.js';
import { s3Connector } from './s3-connector.js';
import { dropboxConnector } from './dropbox-connector.js';
import { gdriveConnector } from './gdrive-connector.js';
import type { ConnectorProvider } from './connector-provider.js';
import { decryptSecret } from '../security/secret-crypto.js';
import { ensureDropboxAccessToken, ensureGDriveAccessToken } from './token-refresh.js';

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
  // Get all secrets for this connector type
  const { data: secrets, error } = await supabase!
    .from('integration_secrets')
    .select('key, ciphertext')
    .eq('org_id', orgId)
    .eq('integration_kind', connectorType.toUpperCase());

  if (error || !secrets || secrets.length === 0) {
    return null;
  }

  const secretsMap: Record<string, string> = {};
  for (const secret of secrets) {
    try {
      secretsMap[secret.key] = decryptSecret(secret.ciphertext);
    } catch (decryptError: any) {
      console.error(`Failed to decrypt secret ${secret.key}:`, decryptError);
      // Continue - will fail when connector tries to use it
    }
  }

  // For S3, parse config from encrypted JSON
  if (connectorType.toUpperCase() === 'S3' && secretsMap['config']) {
    try {
      const config = JSON.parse(secretsMap['config']);
      Object.assign(secretsMap, config);
    } catch (parseError) {
      console.error('Failed to parse S3 config:', parseError);
    }
  }

  return secretsMap;
}

/**
 * Check if dev connector secrets from client are allowed
 */
const ALLOW_DEV_CONNECTOR_SECRETS_FROM_CLIENT = process.env.ALLOW_DEV_CONNECTOR_SECRETS_FROM_CLIENT === 'true';

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

        // Phase 0: Block secrets from client in production
        let connectorSecrets: Record<string, string> | null = null;
        
        if (ALLOW_DEV_CONNECTOR_SECRETS_FROM_CLIENT && secrets) {
          // Dev mode: allow secrets from request
          connectorSecrets = secrets;
        } else {
          // Production mode: only use secrets from database
          if (secrets) {
            console.warn(`Rejecting secrets from client for connector ${type} (production mode)`);
          }
          if (supabaseAdmin) {
            connectorSecrets = await getConnectorSecrets(context.orgId, type, supabaseAdmin);
          }
        }

        // For OAuth connectors (Dropbox/GDrive), ensure fresh token
        if (type.toUpperCase() === 'DROPBOX') {
          const freshToken = await ensureDropboxAccessToken(context.orgId);
          if (!freshToken) {
            return res.status(400).json({ 
              success: false, 
              error: 'Not connected. Use OAuth connect flow.' 
            });
          }
          connectorSecrets = { ...connectorSecrets, accessToken: freshToken.accessToken };
        } else if (type.toUpperCase() === 'GDRIVE') {
          const freshToken = await ensureGDriveAccessToken(context.orgId);
          if (!freshToken) {
            return res.status(400).json({ 
              success: false, 
              error: 'Not connected. Use OAuth connect flow.' 
            });
          }
          connectorSecrets = { ...connectorSecrets, accessToken: freshToken.accessToken };
        } else if (!connectorSecrets || Object.keys(connectorSecrets).length === 0) {
          return res.status(400).json({ 
            success: false, 
            error: 'Missing connector credentials' 
          });
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

        // Phase 0: Block secrets from query params in production
        let secrets: Record<string, string> | null = null;
        let config: Record<string, any> = {};

        // Never accept secrets via URL query params (security risk)
        if (req.query.secrets) {
          console.warn(`Rejecting secrets from query params for connector ${type} (security violation)`);
          return res.status(400).json({ error: 'Secrets cannot be passed via URL query parameters' });
        }

        // Config from query (non-sensitive)
        if (req.query.config) {
          try {
            config = JSON.parse(req.query.config as string);
          } catch (parseError) {
            return res.status(400).json({ error: 'Invalid config JSON' });
          }
        }

        // Get secrets from database
        if (ALLOW_DEV_CONNECTOR_SECRETS_FROM_CLIENT && req.query.secrets) {
          // Dev mode only: allow secrets from query (already rejected above, but keeping for clarity)
          try {
            secrets = JSON.parse(req.query.secrets as string);
          } catch (parseError) {
            return res.status(400).json({ error: 'Invalid secrets JSON' });
          }
        } else {
          // Production mode: only use secrets from database
          if (supabaseAdmin) {
            secrets = await getConnectorSecrets(context.orgId, type, supabaseAdmin);
          }
        }

        // For OAuth connectors (Dropbox/GDrive), ensure fresh token
        if (type.toUpperCase() === 'DROPBOX') {
          const freshToken = await ensureDropboxAccessToken(context.orgId);
          if (!freshToken) {
            return res.status(400).json({ 
              error: 'Not connected. Use OAuth connect flow.' 
            });
          }
          secrets = { ...secrets, accessToken: freshToken.accessToken };
        } else if (type.toUpperCase() === 'GDRIVE') {
          const freshToken = await ensureGDriveAccessToken(context.orgId);
          if (!freshToken) {
            return res.status(400).json({ 
              error: 'Not connected. Use OAuth connect flow.' 
            });
          }
          secrets = { ...secrets, accessToken: freshToken.accessToken };
        } else if (!secrets || Object.keys(secrets).length === 0) {
          return res.status(400).json({ 
            error: 'Missing connector credentials' 
          });
        }

        const result = await connector.list(
          { path, prefix, limit, offset, recursive },
          config,
          secrets || {}
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

  // ============================================================================
  // GET /api/connectors/:type/status - Get connector connection status
  // ============================================================================
  app.get(
    '/api/connectors/:type/status',
    requireEntitlement('batchIngestion'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { type } = req.params;
        const connectorType = type.toUpperCase();

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Get secrets from database
        const secrets = await getConnectorSecrets(context.orgId, type, supabaseAdmin);

        if (!secrets || Object.keys(secrets).length === 0) {
          return res.json({
            connected: false,
            displayInfo: null,
            error: 'Not connected',
          });
        }

        // For OAuth connectors, try to get account info
        let displayInfo: any = null;
        let error: string | null = null;

        if (connectorType === 'DROPBOX') {
          try {
            const freshToken = await ensureDropboxAccessToken(context.orgId);
            if (freshToken) {
              // Get account info
              const accountResponse = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${freshToken.accessToken}`,
                  'Content-Type': 'application/json',
                },
              });

              if (accountResponse.ok) {
                const account = await accountResponse.json();
                displayInfo = {
                  email: account.email,
                  name: account.name?.display_name || account.name?.given_name || 'Dropbox User',
                };
              } else {
                error = 'Failed to verify connection';
              }
            } else {
              error = 'Token refresh failed';
            }
          } catch (err: any) {
            error = err.message || 'Connection verification failed';
          }
        } else if (connectorType === 'GDRIVE') {
          try {
            const freshToken = await ensureGDriveAccessToken(context.orgId);
            if (freshToken) {
              // Get about info
              const aboutResponse = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
                headers: {
                  'Authorization': `Bearer ${freshToken.accessToken}`,
                },
              });

              if (aboutResponse.ok) {
                const about = await aboutResponse.json();
                displayInfo = {
                  email: about.user?.emailAddress,
                  name: about.user?.displayName || 'Google Drive User',
                };
              } else {
                error = 'Failed to verify connection';
              }
            } else {
              error = 'Token refresh failed';
            }
          } catch (err: any) {
            error = err.message || 'Connection verification failed';
          }
        } else if (connectorType === 'S3') {
          // For S3, just indicate connected if credentials exist
          displayInfo = {
            bucket: secrets.bucket || 'Not configured',
            region: secrets.region || 'Not configured',
            prefix: secrets.prefix || '',
            mode: secrets.roleArn ? 'ASSUME_ROLE' : 'STATIC_KEYS',
          };
        }

        res.json({
          connected: true,
          displayInfo,
          error,
        });
      } catch (error: any) {
        console.error('Get connector status error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // POST /api/connectors/s3/connect - Connect S3 (assume-role or static keys)
  // ============================================================================
  app.post(
    '/api/connectors/s3/connect',
    requireEntitlement('batchIngestion'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { mode, bucket, region, prefix, roleArn, externalId, accessKeyId, secretAccessKey } = req.body;

        if (!bucket || !region) {
          return res.status(400).json({ error: 'bucket and region are required' });
        }

        if (mode === 'ASSUME_ROLE') {
          if (!roleArn || !externalId) {
            return res.status(400).json({ error: 'roleArn and externalId are required for assume-role mode' });
          }
        } else if (mode === 'STATIC_KEYS') {
          const ALLOW_STATIC_KEYS = process.env.ALLOW_DEV_CONNECTOR_SECRETS_FROM_CLIENT === 'true';
          if (!ALLOW_STATIC_KEYS) {
            return res.status(400).json({ error: 'Static keys not allowed in production. Use assume-role mode.' });
          }
          if (!accessKeyId || !secretAccessKey) {
            return res.status(400).json({ error: 'accessKeyId and secretAccessKey are required for static keys mode' });
          }
        } else {
          return res.status(400).json({ error: 'mode must be ASSUME_ROLE or STATIC_KEYS' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Store config (bucket, region, prefix) - can be stored in integration_secrets with a special key
        // or we could create a separate table, but for simplicity, store as encrypted JSON
        const configJson = JSON.stringify({ bucket, region, prefix: prefix || '' });
        const encryptedConfig = encryptSecret(configJson);

        await supabaseAdmin
          .from('integration_secrets')
          .upsert({
            org_id: context.orgId,
            integration_kind: 'S3',
            key: 'config',
            ciphertext: encryptedConfig,
          }, {
            onConflict: 'org_id,integration_kind,key',
          });

        // Store credentials (encrypted)
        if (mode === 'ASSUME_ROLE') {
          const encryptedRoleArn = encryptSecret(roleArn);
          const encryptedExternalId = encryptSecret(externalId);

          await supabaseAdmin
            .from('integration_secrets')
            .upsert({
              org_id: context.orgId,
              integration_kind: 'S3',
              key: 'roleArn',
              ciphertext: encryptedRoleArn,
            }, {
              onConflict: 'org_id,integration_kind,key',
            });

          await supabaseAdmin
            .from('integration_secrets')
            .upsert({
              org_id: context.orgId,
              integration_kind: 'S3',
              key: 'externalId',
              ciphertext: encryptedExternalId,
            }, {
              onConflict: 'org_id,integration_kind,key',
            });
        } else {
          const encryptedAccessKeyId = encryptSecret(accessKeyId);
          const encryptedSecretAccessKey = encryptSecret(secretAccessKey);

          await supabaseAdmin
            .from('integration_secrets')
            .upsert({
              org_id: context.orgId,
              integration_kind: 'S3',
              key: 'accessKeyId',
              ciphertext: encryptedAccessKeyId,
            }, {
              onConflict: 'org_id,integration_kind,key',
            });

          await supabaseAdmin
            .from('integration_secrets')
            .upsert({
              org_id: context.orgId,
              integration_kind: 'S3',
              key: 'secretAccessKey',
              ciphertext: encryptedSecretAccessKey,
            }, {
              onConflict: 'org_id,integration_kind,key',
            });
        }

        // Test connection
        const connector = getConnectorProvider('S3');
        if (connector) {
          const testResult = await connector.testConnection(
            { bucket, region, prefix: prefix || '' },
            mode === 'ASSUME_ROLE' 
              ? { roleArn, externalId }
              : { accessKeyId, secretAccessKey }
          );

          if (!testResult.success) {
            return res.status(400).json({ error: testResult.error || 'Connection test failed' });
          }
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'connector.s3.connect',
          targetType: 'integration_secret',
          meta: { mode, bucket, region },
        });

        res.json({ success: true });
      } catch (error: any) {
        console.error('S3 connect error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );
}

