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

      // Verify audio asset exists and belongs to org
      const { data: asset, error: assetError } = await supabaseAdmin
        .from('assets')
        .select('id, org_id, project_id, filename, file_size_bytes')
        .eq('id', audioAssetId)
        .eq('org_id', context.orgId)
        .maybeSingle();

      if (assetError || !asset) {
        return res.status(404).json({ error: 'Audio asset not found or access denied' });
      }

      // Create draft conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .insert({
          org_id: context.orgId,
          project_id: projectId || context.projectId || null,
          env: context.env || 'sandbox',
          title: title || asset.filename || 'Untitled Audio',
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

  console.log('Conversation routes registered successfully');
}

