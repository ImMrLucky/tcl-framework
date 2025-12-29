/**
 * Artifact Processing
 * Handles normalization and storage of conversation artifacts
 */

import type { ConversationArtifact, Channel } from '../types.js';
import { supabaseAdmin } from '../../supabase.js';
import crypto from 'crypto';

export interface ProcessedArtifact {
  artifactId: string;
  normalizedText?: string;
}

/**
 * Process artifacts and create database records
 */
export async function processArtifacts(
  orgId: string,
  projectId: string,
  env: 'sandbox' | 'production',
  conversationId: string,
  artifacts: ConversationArtifact[]
): Promise<ProcessedArtifact[]> {
  const processed: ProcessedArtifact[] = [];
  let normalizedText: string | null = null;

  for (const artifact of artifacts) {
    const artifactData: any = {
      org_id: orgId,
      project_id: projectId,
      env,
      conversation_id: conversationId,
      artifact_type: artifact.type,
      content_type: artifact.content_type,
      filename: artifact.filename,
      storage_ref: artifact.storage_ref || {},
    };

    // Process based on artifact type
    switch (artifact.type) {
      case 'transcript_text':
        artifactData.content_text = artifact.text;
        if (artifact.text) {
          normalizedText = artifact.text; // Use transcript as normalized text
        }
        break;

      case 'chat_messages':
        artifactData.content_json = { messages: artifact.messages || [] };
        // Generate normalized text from chat messages
        if (artifact.messages && artifact.messages.length > 0) {
          normalizedText = normalizeChatMessages(artifact.messages);
        }
        break;

      case 'email_thread':
        artifactData.content_json = { thread: artifact.text || '' };
        if (artifact.text) {
          normalizedText = artifact.text;
        }
        break;

      case 'audio_recording':
      case 'attachment':
      case 'evidence_doc':
        // Store reference only
        artifactData.storage_ref = artifact.storage_ref || {};
        break;
    }

    // Insert artifact
    if (!supabaseAdmin) {
      console.error('Supabase not configured');
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from('conversation_artifacts')
      .insert(artifactData)
      .select('id')
      .single();

    if (error) {
      console.error('Failed to insert artifact:', error);
      continue;
    }

    processed.push({
      artifactId: data.id,
      normalizedText: normalizedText || undefined,
    });
  }

  // Update conversation content and raw_text (if column exists) with normalized text
  if (normalizedText && supabaseAdmin) {
    // Try to update raw_text first (if column exists), fallback to content
    const updateData: any = { content: normalizedText };
    
    // Check if raw_text column exists and update it too
    try {
      await supabaseAdmin
        .from('conversations')
        .update({ ...updateData, raw_text: normalizedText })
        .eq('id', conversationId);
    } catch (error: any) {
      // If raw_text doesn't exist, just update content
      if (error.code === '42703') { // column does not exist
        await supabaseAdmin
          .from('conversations')
          .update(updateData)
          .eq('id', conversationId);
      } else {
        throw error;
      }
    }
  }

  return processed;
}

/**
 * Normalize chat messages into transcript format
 */
function normalizeChatMessages(messages: Array<{ ts: string; author: string; text: string }>): string {
  return messages
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .map((msg) => `${msg.author}: ${msg.text}`)
    .join('\n');
}

/**
 * Check idempotency and return existing conversation if found
 */
export async function checkIdempotency(
  orgId: string,
  provider: string,
  externalId: string
): Promise<string | null> {
  if (!supabaseAdmin) return null;

  const keyHash = crypto
    .createHash('sha256')
    .update(`${provider}.${externalId}`)
    .digest('hex');

  const { data } = await supabaseAdmin
    .from('idempotency_keys')
    .select('conversation_id')
    .eq('org_id', orgId)
    .eq('key_hash', keyHash)
    .single();

  return data?.conversation_id || null;
}

/**
 * Store idempotency key
 */
export async function storeIdempotencyKey(
  orgId: string,
  provider: string,
  externalId: string,
  conversationId: string
): Promise<void> {
  if (!supabaseAdmin) return;

  const keyHash = crypto
    .createHash('sha256')
    .update(`${provider}.${externalId}`)
    .digest('hex');

  await supabaseAdmin.from('idempotency_keys').insert({
    org_id: orgId,
    key_hash: keyHash,
    provider,
    external_id: externalId,
    conversation_id: conversationId,
  });
}

