/**
 * Integration Routes
 * Integrated into TCL Core Express server
 * Modular design - can be separated if needed
 */

import express from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { verifyApiKeyExtended } from '../supabase.js';
import { verifyWebhookSignature, generateWebhookSignature } from './security/hmac.js';
import { processArtifacts, checkIdempotency, storeIdempotencyKey } from './artifacts/processor.js';
import type { WebhookIngestPayload, RealtimeSessionStart, RealtimeChunk, RealtimeFinalize } from './types.js';

// Reuse getOrgContext from express.ts
async function getOrgContext(
  req: express.Request
): Promise<{ orgId: string; projectId: string; env: 'sandbox' | 'production' } | null> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.substring(7);
    const verified = await verifyApiKeyExtended(key);
    if (verified) {
      return {
        orgId: verified.orgId,
        projectId: verified.projectId,
        env: verified.env as 'sandbox' | 'production',
      };
    }
  }
  // TODO: Support user session JWT
  return null;
}

export function setupIntegrationRoutes(app: express.Application) {
  // ============================================================================
  // WEBHOOK INGEST v2
  // ============================================================================

  app.post('/webhooks/:path_token', async (req, res) => {
    try {
      const { path_token } = req.params;
      // Get raw body for HMAC verification
      const rawBody = Buffer.isBuffer(req.body) 
        ? req.body.toString('utf8')
        : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
      const body = JSON.parse(rawBody) as WebhookIngestPayload;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get webhook token and integration
      const { data: webhookToken, error: tokenError } = await supabaseAdmin
        .from('webhook_tokens')
        .select('*, integrations(*)')
        .eq('path_token', path_token)
        .single();

      if (tokenError || !webhookToken) {
        return res.status(404).json({ error: 'Invalid webhook token' });
      }

      const integration = webhookToken.integrations;

      // Verify HMAC signature
      const timestamp = req.headers['x-protectqa-timestamp'] as string;
      const signature = req.headers['x-protectqa-signature'] as string;

      if (!timestamp || !signature) {
        return res.status(401).json({ error: 'Missing signature headers' });
      }

      const secret = webhookToken.secret;
      if (!verifyWebhookSignature(secret, timestamp, signature, rawBody)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Get org context
      const orgContext = {
        orgId: integration.org_id,
        projectId: integration.project_id,
        env: integration.env,
      };

      // Check idempotency
      const existingConvId = await checkIdempotency(
        orgContext.orgId,
        'webhook',
        body.external_id
      );

      let conversationId: string;

      if (existingConvId) {
        conversationId = existingConvId;
        // Update existing conversation
        if (supabaseAdmin) {
          await supabaseAdmin
            .from('conversations')
            .update({
              title: body.title || undefined,
              metadata: body.meta || {},
            })
            .eq('id', conversationId);
        }
      } else {
        // Create new conversation
        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }
        const { data: conversation, error: convError } = await supabaseAdmin
          .from('conversations')
          .insert({
            org_id: orgContext.orgId,
            project_id: orgContext.projectId,
            env: orgContext.env,
            external_id: body.external_id,
            title: body.title,
            content: '', // Will be updated from artifacts
            metadata: body.meta || {},
          })
          .select('id')
          .single();

        if (convError) {
          return res.status(500).json({ error: 'Failed to create conversation' });
        }

        conversationId = conversation.id;

        // Store idempotency key
        await storeIdempotencyKey(
          orgContext.orgId,
          'webhook',
          body.external_id,
          conversationId
        );
      }

      // Process artifacts
      if (body.artifacts && body.artifacts.length > 0) {
        await processArtifacts(
          orgContext.orgId,
          orgContext.projectId,
          orgContext.env,
          conversationId,
          body.artifacts
        );
      }

      // Auto-start evaluation if requested
      if (body.auto_start_evaluation) {
        // Trigger evaluation via internal validate function
        // This is integrated - we can call validate directly
        try {
          // Lazy load validate function (same pattern as express.ts)
          const { validate } = await import('../../orchestrator.js');
          const transcriptText = body.artifacts?.find(a => a.type === 'transcript_text')?.text || 
                                 body.artifacts?.find(a => a.type === 'chat_messages')?.messages
                                   ?.map(m => `${m.author}: ${m.text}`).join('\n') || '';
          
          if (transcriptText) {
            // Call validate asynchronously (don't wait for result)
            validate({
              question: transcriptText,
              answer: '',
              sources: [],
              options: {},
            }).catch(err => {
              console.error('Evaluation failed (non-blocking):', err);
            });
          }
        } catch (error) {
          console.error('Failed to trigger evaluation:', error);
          // Don't fail the webhook if evaluation fails
        }
      }

      res.json({
        success: true,
        conversation_id: conversationId,
        existing: !!existingConvId,
      });
    } catch (error: any) {
      console.error('Webhook ingest error:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // ============================================================================
  // REAL-TIME INGESTION
  // ============================================================================

  // Start real-time session
  app.post('/v1/realtime/sessions/start', async (req, res) => {
    try {
      const body = req.body as RealtimeSessionStart;
      const orgContext = await getOrgContext(req);

      if (!orgContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: session, error } = await supabaseAdmin
        .from('realtime_sessions')
        .insert({
          org_id: orgContext.orgId,
          project_id: orgContext.projectId,
          env: orgContext.env,
          channel: body.channel,
          metadata: body.meta || {},
          status: 'active',
        })
        .select('id')
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to create session' });
      }

      res.json({ session_id: session.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add chunk to session
  app.post('/v1/realtime/sessions/:session_id/chunk', async (req, res) => {
    try {
      const { session_id } = req.params;
      const body = req.body as RealtimeChunk;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get session
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('realtime_sessions')
        .select('*')
        .eq('id', session_id)
        .eq('status', 'active')
        .single();

      if (sessionError || !session) {
        return res.status(404).json({ error: 'Session not found or not active' });
      }

      // Create or get conversation
      let conversationId = session.conversation_id;

      if (!conversationId) {
        const { data: conversation, error: convError } = await supabaseAdmin
          .from('conversations')
          .insert({
            org_id: session.org_id,
            project_id: session.project_id,
            env: session.env,
            title: `Real-time ${session.channel}`,
            content: '', // Will be updated from artifacts
            metadata: session.meta || {},
          })
          .select('id')
          .single();

        if (convError) {
          return res.status(500).json({ error: 'Failed to create conversation' });
        }

        conversationId = conversation.id;

        // Update session with conversation ID
        if (supabaseAdmin) {
          await supabaseAdmin
            .from('realtime_sessions')
            .update({ conversation_id: conversationId })
            .eq('id', session_id);
        }
      }

      // Create artifact from chunk
      const artifact: any = {
        type: body.type === 'chat_messages' ? 'chat_messages' : 'transcript_text',
      };

      if (body.type === 'chat_messages' && body.messages) {
        artifact.messages = body.messages;
      } else if (body.text) {
        artifact.text = body.text;
      }

      await processArtifacts(
        session.org_id,
        session.project_id,
        session.env,
        conversationId,
        [artifact]
      );

      res.json({ success: true, conversation_id: conversationId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Finalize session
  app.post('/v1/realtime/sessions/:session_id/finalize', async (req, res) => {
    try {
      const { session_id } = req.params;
      const body = req.body as RealtimeFinalize;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get session
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('realtime_sessions')
        .select('*')
        .eq('id', session_id)
        .eq('status', 'active')
        .single();

      if (sessionError || !session) {
        return res.status(404).json({ error: 'Session not found or not active' });
      }

      // Update session status
      await supabaseAdmin
        .from('realtime_sessions')
        .update({
          status: 'finalized',
          finalized_at: new Date().toISOString(),
        })
        .eq('id', session_id);

      // Auto-start evaluation if requested
      if (body.auto_start_evaluation && session.conversation_id) {
        try {
          // Get conversation content
          const { data: conversation } = await supabaseAdmin
            .from('conversations')
            .select('content, raw_text')
            .eq('id', session.conversation_id)
            .single();

          const transcriptText = conversation?.raw_text || conversation?.content;
          if (transcriptText) {
            // Call validate asynchronously (don't wait for result)
            const { validate } = await import('../../orchestrator.js');
            validate({
              question: transcriptText,
              answer: '',
              sources: [],
              options: {},
            }).catch(err => {
              console.error('Evaluation failed (non-blocking):', err);
            });
          }
        } catch (error) {
          console.error('Failed to trigger evaluation:', error);
        }
      }

      res.json({ success: true, conversation_id: session.conversation_id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // INTEGRATION MANAGEMENT
  // ============================================================================

  // List integrations
  app.get('/integrations', async (req, res) => {
    try {
      const orgContext = await getOrgContext(req);

      if (!orgContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data, error } = await supabaseAdmin
        .from('integrations')
        .select('*')
        .eq('org_id', orgContext.orgId)
        .eq('project_id', orgContext.projectId)
        .eq('env', orgContext.env);

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch integrations' });
      }

      // Remove secrets from response
      const safeData = data.map((i: any) => {
        const { secrets, ...rest } = i;
        return rest;
      });

      res.json({ integrations: safeData });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create integration
  app.post('/integrations', async (req, res) => {
    try {
      const orgContext = await getOrgContext(req);

      if (!orgContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { name, integration_type, config, secrets, is_beta } = req.body;

      const { data, error } = await supabaseAdmin!
        .from('integrations')
        .insert({
          org_id: orgContext.orgId,
          project_id: orgContext.projectId,
          env: orgContext.env,
          name,
          integration_type,
          config: config || {},
          secrets: secrets || {}, // Should be encrypted in production
          is_beta: is_beta || false,
          is_active: true,
        })
        .select('*')
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to create integration' });
      }

      // Create webhook token if webhook_ingest
      if (integration_type === 'webhook_ingest') {
        const pathToken = crypto.randomUUID();
        const secret = crypto.randomBytes(32).toString('hex');

        await supabaseAdmin.from('webhook_tokens').insert({
          integration_id: data.id,
          path_token: pathToken,
          secret,
        });

        res.json({
          ...data,
          webhook_url: `/webhooks/${pathToken}`,
        });
      } else {
        res.json(data);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger S3 Drop ingestion
  app.post('/integrations/:integration_id/ingest', async (req, res) => {
    try {
      const orgContext = await getOrgContext(req);
      if (!orgContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { integration_id } = req.params;
      const { since, limit } = req.body;

      // Get integration
      const { data: integration, error: intError } = await supabaseAdmin
        .from('integrations')
        .select('*')
        .eq('id', integration_id)
        .eq('org_id', orgContext.orgId)
        .eq('env', orgContext.env)
        .single();

      if (intError || !integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      if (integration.integration_type !== 's3_drop') {
        return res.status(400).json({ error: 'Integration is not an S3 Drop connector' });
      }

      // Import and instantiate connector
      const { S3DropConnector } = await import('./connectors/s3-drop.js');
      const connector = new S3DropConnector({
        orgId: orgContext.orgId,
        projectId: orgContext.projectId || '',
        env: orgContext.env,
        integrationId: integration.id,
        config: integration.config || {},
        secrets: integration.secrets || {},
      });

      // Run ingestion
      const result = await connector.ingest({ since, limit });

      res.json({
        success: true,
        conversation_id: result.conversationId,
        artifacts_created: result.artifacts.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

