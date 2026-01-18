/**
 * Convert Canonical Transcript to Conversation
 * 
 * Helper functions to create conversations and optionally evaluations
 * from canonical transcript format.
 */

import { supabaseAdmin } from '../supabase.js';
import type { CanonicalTranscript } from './canonical-transcript.js';
import { createIngestionJob } from '../ingest/jobs.js';
import { enqueueJob } from '../ingest/worker.js';

export interface ConversationCreationResult {
  conversation_id: string;
  evaluation_id?: string;
  warnings?: string[];
}

/**
 * Create a conversation from a canonical transcript
 */
export async function createConversationFromCanonical(
  orgId: string,
  projectId: string,
  env: string,
  userId: string,
  transcript: CanonicalTranscript,
  options?: {
    title?: string;
    channel?: string;
    representativeId?: string | null;
    templateId?: string | null;
    autoAnalyze?: boolean;
  }
): Promise<ConversationCreationResult> {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Convert canonical turns to raw text format
  const rawText = transcript.turns
    .map(t => {
      if (t.speaker_raw) {
        return `${t.speaker_raw}: ${t.text}`;
      }
      return t.text;
    })
    .join('\n');

  // Build metadata
  const metadata: any = {
    source: transcript.source,
    canonicalFormat: true,
    turnsCount: transcript.turns.length,
  };

  // Add speaker role map if we can infer it
  const speakerRoleMap: Record<string, string> = {};
  transcript.turns.forEach(t => {
    if (t.speaker_raw && !speakerRoleMap[t.speaker_raw]) {
      // Simple heuristic - can be enhanced later
      const lower = t.speaker_raw.toLowerCase();
      if (lower.includes('agent') || lower.includes('rep') || lower.includes('advisor')) {
        speakerRoleMap[t.speaker_raw] = 'REPRESENTATIVE';
      } else if (lower.includes('customer') || lower.includes('client') || lower.includes('caller')) {
        speakerRoleMap[t.speaker_raw] = 'CUSTOMER';
      } else {
        speakerRoleMap[t.speaker_raw] = 'UNKNOWN';
      }
    }
  });

  if (Object.keys(speakerRoleMap).length > 0) {
    metadata.speakerRoleMap = speakerRoleMap;
  }

  // Merge with transcript metadata
  if (transcript.metadata) {
    Object.assign(metadata, transcript.metadata);
  }

  // Create conversation
  const { data: conversation, error: convError } = await supabaseAdmin
    .from('conversations')
    .insert({
      org_id: orgId,
      project_id: projectId || null,
      env: env || 'sandbox',
      external_id: transcript.conversation_id || null,
      title: options?.title || transcript.source.file_name || 'Batch Import',
      content: rawText,
      representative_id: options?.representativeId || null,
      metadata: metadata,
    })
    .select('id')
    .single();

  if (convError) {
    throw new Error(`Failed to create conversation: ${convError.message}`);
  }

  const result: ConversationCreationResult = {
    conversation_id: conversation.id,
  };

  // Optionally create evaluation immediately
  if (options?.autoAnalyze) {
    try {
      // Create ingestion job for analysis
      const jobId = await createIngestionJob(
        orgId,
        projectId || '',
        env,
        userId,
        'TRANSCRIPT_ONLY',
        options?.title || transcript.source.file_name,
        options?.channel || 'call',
        options?.representativeId || null
      );

      // Link conversation to job
      await supabaseAdmin
        .from('ingestion_jobs')
        .update({ conversation_id: conversation.id })
        .eq('id', jobId);

      // Enqueue for processing
      await enqueueJob(jobId);

      // Note: evaluation_id will be set when job completes
      // For now, we'll need to poll or update later
    } catch (error: any) {
      result.warnings = result.warnings || [];
      result.warnings.push(`Failed to auto-analyze: ${error.message}`);
    }
  }

  return result;
}

/**
 * Create multiple conversations from canonical transcripts
 */
export async function createConversationsFromCanonicalBatch(
  orgId: string,
  projectId: string,
  env: string,
  userId: string,
  transcripts: CanonicalTranscript[],
  options?: {
    title?: string;
    channel?: string;
    representativeId?: string | null;
    templateId?: string | null;
    autoAnalyze?: boolean;
  }
): Promise<Array<ConversationCreationResult & { transcript: CanonicalTranscript }>> {
  const results: Array<ConversationCreationResult & { transcript: CanonicalTranscript }> = [];

  for (const transcript of transcripts) {
    try {
      const result = await createConversationFromCanonical(
        orgId,
        projectId,
        env,
        userId,
        transcript,
        {
          ...options,
          title: transcript.metadata?.title || options?.title || transcript.source.file_name,
        }
      );
      results.push({ ...result, transcript });
    } catch (error: any) {
      results.push({
        conversation_id: '',
        transcript,
        warnings: [`Failed to create conversation: ${error.message}`],
      });
    }
  }

  return results;
}

