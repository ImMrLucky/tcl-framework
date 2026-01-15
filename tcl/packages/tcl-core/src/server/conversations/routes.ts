/**
 * Conversation Drafts Routes
 * Handles draft conversation lifecycle: audio upload, transcription, status tracking
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { checkUserPermission } from '../supabase.js';
// Transcription will be handled by the ingestion worker
// We'll queue the job and let the worker process it

export function setupConversationRoutes(app: express.Application) {
  console.log('Setting up conversation routes...');

  // ============================================================================
  // POST /api/conversations/drafts/audio - Create draft conversation with audio
  // ============================================================================
  app.post('/api/conversations/drafts/audio', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { title, audioAssetId, projectId } = req.body;

      if (!audioAssetId) {
        return res.status(400).json({ error: 'audioAssetId is required' });
      }

      console.log('[Draft] Looking up asset:', { audioAssetId, orgId: context.orgId, projectId });

      // Verify audio asset exists and belongs to org
      // Retry up to 3 times with exponential backoff (in case of timing issues)
      let asset: any = null;
      let lastError: any = null;
      
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          // Wait before retry: 100ms, 200ms, 400ms
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        }

        const { data: assetCheck, error: checkError } = await supabaseAdmin
          .from('assets')
          .select('id, org_id, object_path, size_bytes, bucket')
          .eq('id', audioAssetId)
          .maybeSingle();

        if (checkError) {
          lastError = checkError;
          console.error(`[Draft] Error checking asset (attempt ${attempt + 1}):`, checkError);
          if (attempt === 2) {
            return res.status(500).json({ error: `Database error: ${checkError.message}` });
          }
          continue;
        }

        if (!assetCheck) {
          console.warn(`[Draft] Asset not found (attempt ${attempt + 1}):`, { audioAssetId, orgId: context.orgId });
          if (attempt === 2) {
            return res.status(404).json({ error: 'Audio asset not found. Please ensure the upload completed successfully.' });
          }
          continue;
        }

        // Verify org_id matches
        if (assetCheck.org_id !== context.orgId) {
          console.error('Asset org_id mismatch:', {
            assetOrgId: assetCheck.org_id,
            contextOrgId: context.orgId,
            audioAssetId,
          });
          return res.status(403).json({ error: 'Access denied: asset belongs to different organization' });
        }

        asset = assetCheck;
        break;
      }

      if (!asset) {
        return res.status(404).json({ error: 'Audio asset not found after retries' });
      }

      // Create draft conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .insert({
          org_id: context.orgId,
          project_id: projectId || context.projectId || null,
          env: context.env || 'sandbox',
          title: title || (asset.object_path ? asset.object_path.split('/').pop() || 'Untitled Audio' : 'Untitled Audio'),
          content: null, // No content yet for audio-only drafts
          draft_status: 'DRAFT_AUDIO_UPLOADED',
          audio_asset_id: audioAssetId,
          created_by: context.userId,
        })
        .select('id, org_id, project_id, env, title, draft_status, audio_asset_id, created_at, updated_at')
        .single();

      if (convError) {
        console.error('Error creating draft conversation:', convError);
        return res.status(500).json({ error: `Failed to create draft: ${convError.message}` });
      }

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'conversation.draft.create',
        targetType: 'conversation',
        targetId: conversation.id,
        meta: { projectId: conversation.project_id, audioAssetId },
      });

      res.json({
        draft: {
          id: conversation.id,
          status: conversation.draft_status,
          title: conversation.title,
          updatedAt: conversation.updated_at,
          audioAssetId: conversation.audio_asset_id,
        },
      });
    } catch (error: any) {
      console.error('Error creating audio draft:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // POST /api/conversations/:id/transcribe - Start transcription for a draft
  // ============================================================================
  app.post('/api/conversations/:id/transcribe', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { id } = req.params;

      // Get conversation and verify access
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id, org_id, project_id, draft_status, audio_asset_id')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .maybeSingle();

      if (convError || !conversation) {
        return res.status(404).json({ error: 'Conversation not found or access denied' });
      }

      // Verify draft status allows transcription
      if (conversation.draft_status !== 'DRAFT_AUDIO_UPLOADED' && 
          conversation.draft_status !== 'TRANSCRIPTION_FAILED') {
        return res.status(400).json({ 
          error: `Cannot transcribe: conversation status is ${conversation.draft_status}` 
        });
      }

      if (!conversation.audio_asset_id) {
        return res.status(400).json({ error: 'No audio asset found for this conversation' });
      }

      // Update status to QUEUED (will be set to TRANSCRIBING by worker)
      const { error: updateError } = await supabaseAdmin
        .from('conversations')
        .update({
          draft_status: 'TRANSCRIPTION_QUEUED',
          transcription_error: null, // Clear any previous errors
        })
        .eq('id', id);

      if (updateError) {
        console.error('Error updating conversation status:', updateError);
        return res.status(500).json({ error: `Failed to queue transcription: ${updateError.message}` });
      }

      // Get audio asset details
      const { data: audioAsset, error: assetError } = await supabaseAdmin
        .from('assets')
        .select('id, bucket, object_path, filename')
        .eq('id', conversation.audio_asset_id)
        .maybeSingle();

      if (assetError || !audioAsset) {
        return res.status(404).json({ error: 'Audio asset not found' });
      }

      // Start transcription asynchronously
      // For now, we'll update the status and let the ingestion worker handle it
      // The worker will process audio-only jobs and update the conversation status
      try {
        // Store transcription metadata
        const { data: existingConv } = await supabaseAdmin
          .from('conversations')
          .select('metadata')
          .eq('id', id)
          .single();

        const metadata = (existingConv?.metadata as any) || {};
        metadata.transcriptionStartedAt = new Date().toISOString();

        await supabaseAdmin
          .from('conversations')
          .update({
            metadata,
          })
          .eq('id', id);

        // Note: Actual transcription will be handled by the ingestion worker
        // when it processes audio-only ingestion jobs. The worker will:
        // 1. Download audio from Supabase Storage
        // 2. Transcribe using ASR service  
        // 3. Update conversation with transcript and status (TRANSCRIPT_READY or TRANSCRIPTION_FAILED)
        console.log(`[Transcription] Queued transcription for conversation ${id}`);

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'conversation.transcribe.start',
          targetType: 'conversation',
          targetId: id,
          meta: { audioAssetId: conversation.audio_asset_id },
        });

        res.json({
          success: true,
          message: 'Transcription queued',
          conversationId: id,
          status: 'TRANSCRIPTION_QUEUED',
        });
      } catch (transcribeError: any) {
        // Update status to failed
        await supabaseAdmin
          .from('conversations')
          .update({
            draft_status: 'TRANSCRIPTION_FAILED',
            transcription_error: transcribeError.message || 'Failed to start transcription',
          })
          .eq('id', id);

        throw transcribeError;
      }
    } catch (error: any) {
      console.error('Error starting transcription:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // GET /api/conversations/drafts - List draft conversations
  // ============================================================================
  app.get('/api/conversations/drafts', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const projectId = req.query.projectId as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      // Build query for drafts (non-evaluated conversations with draft_status)
      let query = supabaseAdmin
        .from('conversations')
        .select(`
          id,
          org_id,
          project_id,
          env,
          title,
          draft_status,
          audio_asset_id,
          transcript_asset_id,
          transcription_error,
          evaluation_id,
          created_at,
          updated_at,
          created_by
        `)
        .eq('org_id', context.orgId)
        .not('draft_status', 'is', null)
        .is('evaluation_id', null) // Only non-evaluated drafts
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (projectId) {
        query = query.eq('project_id', projectId);
      } else if (context.projectId) {
        query = query.eq('project_id', context.projectId);
      }

      const { data: drafts, error } = await query;

      if (error) {
        console.error('Error fetching drafts:', error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        drafts: drafts || [],
        total: drafts?.length || 0,
      });
    } catch (error: any) {
      console.error('Error listing drafts:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // GET /api/conversations/:id - Get conversation details (for polling)
  // ============================================================================
  app.get('/api/conversations/:id', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { id } = req.params;

      const { data: conversation, error } = await supabaseAdmin
        .from('conversations')
        .select(`
          id,
          org_id,
          project_id,
          env,
          title,
          draft_status,
          audio_asset_id,
          transcript_asset_id,
          transcription_error,
          evaluation_id,
          created_at,
          updated_at
        `)
        .eq('id', id)
        .eq('org_id', context.orgId)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found or access denied' });
      }

      res.json({ conversation });
    } catch (error: any) {
      console.error('Error fetching conversation:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // DELETE /api/conversations/:id - Delete draft conversation
  // ============================================================================
  app.delete('/api/conversations/:id', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { id } = req.params;

      // Get conversation and verify access + permissions
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id, org_id, created_by, draft_status')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .maybeSingle();

      if (convError || !conversation) {
        return res.status(404).json({ error: 'Conversation not found or access denied' });
      }

      // Check permission: creator OR admin
      const isCreator = conversation.created_by === context.userId;
      const isAdmin = await checkUserPermission(context.userId, context.orgId, 'configure');

      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Only the creator or an admin can delete this draft' });
      }

      // Delete conversation (cascade will handle related records)
      const { error: deleteError } = await supabaseAdmin
        .from('conversations')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting conversation:', deleteError);
        return res.status(500).json({ error: deleteError.message });
      }

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'conversation.delete',
        targetType: 'conversation',
        targetId: id,
        meta: { draftStatus: conversation.draft_status },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // POST /api/conversations/:id/evaluate - Create evaluation from conversation
  // ============================================================================
  app.post('/api/conversations/:id/evaluate', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { id } = req.params;

      // Get conversation and verify access
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id, org_id, project_id, env, draft_status, transcript_asset_id, audio_asset_id, raw_text, content, created_by')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .maybeSingle();

      if (convError || !conversation) {
        return res.status(404).json({ error: 'Conversation not found or access denied' });
      }

      // Verify transcript is ready
      if (conversation.draft_status !== 'TRANSCRIPT_READY') {
        return res.status(400).json({ 
          error: `Cannot create evaluation: conversation status is ${conversation.draft_status}. Transcript must be ready.` 
        });
      }

      if (!conversation.transcript_asset_id) {
        return res.status(400).json({ error: 'No transcript asset found for this conversation' });
      }

      // Get transcript text
      const transcriptText = conversation.raw_text || conversation.content;
      if (!transcriptText) {
        return res.status(400).json({ error: 'No transcript text found in conversation' });
      }

      // Import runAnalysis from worker
      const { runAnalysis } = await import('../ingest/worker.js');

      // Create evaluation using runAnalysis
      const evaluationId = await runAnalysis({
        orgId: context.orgId,
        projectId: conversation.project_id || context.projectId || '',
        env: conversation.env || context.env || 'sandbox',
        conversationId: conversation.id,
        transcript: transcriptText,
        normalizedConversation: null, // Will be normalized by runAnalysis
        userId: conversation.created_by || context.userId,
        verificationLevel: conversation.audio_asset_id ? 'AUDIO_PLUS_TRANSCRIPT' : 'TRANSCRIPT_ONLY',
        transcriptAssetId: conversation.transcript_asset_id,
        jobId: null, // No job ID for direct evaluation creation
        ingestionMode: conversation.audio_asset_id ? 'AUDIO_PLUS_TRANSCRIPT' : 'TRANSCRIPT_ONLY',
        provenance: {
          source: 'direct_evaluation',
          audioAssetId: conversation.audio_asset_id || null,
          transcriptAssetId: conversation.transcript_asset_id,
        },
      });

      // Update conversation status to EVALUATED
      await supabaseAdmin
        .from('conversations')
        .update({
          draft_status: 'EVALUATED',
          evaluation_id: evaluationId,
        })
        .eq('id', id);

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'conversation.evaluate',
        targetType: 'conversation',
        targetId: id,
        meta: { evaluationId },
      });

      res.json({
        success: true,
        evaluationId,
        conversationId: id,
      });
    } catch (error: any) {
      console.error('Error creating evaluation from conversation:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // GET /api/assets/:id/download - Get download URL for an asset
  // ============================================================================
  app.get('/api/assets/:id/download', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { id } = req.params;

      // Get asset details
      const { data: asset, error: assetError } = await supabaseAdmin
        .from('assets')
        .select('id, org_id, bucket, object_path, filename')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .maybeSingle();

      if (assetError || !asset) {
        return res.status(404).json({ error: 'Asset not found or access denied' });
      }

      // Generate signed URL for download (expires in 1 hour)
      const { data: signedUrlData, error: urlError } = await supabaseAdmin
        .storage
        .from(asset.bucket)
        .createSignedUrl(asset.object_path, 3600); // 1 hour expiry

      if (urlError || !signedUrlData) {
        return res.status(500).json({ error: 'Failed to generate download URL' });
      }

      res.json({
        downloadUrl: signedUrlData.signedUrl,
        filename: asset.filename || 'download',
        bucket: asset.bucket,
        objectPath: asset.object_path,
      });
    } catch (error: any) {
      console.error('Error getting asset download URL:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  console.log('Conversation routes registered successfully');
}

