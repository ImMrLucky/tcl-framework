/**
 * Background Job Worker
 * Processes ingestion jobs asynchronously
 */

import { supabaseAdmin } from '../supabase.js';
import { downloadFileFromSupabase } from './storage-supabase.js';
import { readAsset } from './storage.js'; // Keep for backward compatibility
import { normalizeTranscriptBuffer } from '../transcripts/normalize.js';
import { transcribeAudio } from '../transcription.js';
import { computeVerificationDiff } from '../verify/diff.js';
import { withTranscriptionSlot } from '../asr/limit.js';

/**
 * Read asset content (from Supabase Storage or local filesystem for backward compatibility)
 */
async function readAssetContent(asset: any): Promise<Buffer> {
  // Prefer Supabase Storage if bucket/object_path are available
  if (asset.bucket && asset.object_path) {
    try {
      return await downloadFileFromSupabase(asset.bucket, asset.object_path);
    } catch (error: any) {
      console.error(`[Worker] Failed to download from Supabase Storage (${asset.bucket}/${asset.object_path}):`, error);
      throw error;
    }
  }
  
  // Fallback to local filesystem (backward compatibility)
  if (asset.storage_url) {
    try {
      return await readAsset(asset.storage_url);
    } catch (error: any) {
      console.error(`[Worker] Failed to read from local storage (${asset.storage_url}):`, error);
      throw error;
    }
  }
  
  throw new Error(`Asset ${asset.id} has no storage location (missing bucket/object_path and storage_url)`);
}

// In-memory job queue (simple implementation)
const jobQueue: string[] = [];
let isProcessing = false;

/**
 * Enqueue a job for processing
 */
export async function enqueueJob(jobId: string): Promise<void> {
  if (!jobQueue.includes(jobId)) {
    jobQueue.push(jobId);
  }
  
  // Start processing if not already running
  if (!isProcessing) {
    processJobQueue().catch(err => {
      console.error('Job queue processing error:', err);
      isProcessing = false;
    });
  }
}

/**
 * Process jobs from the queue
 */
async function processJobQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  while (jobQueue.length > 0) {
    const jobId = jobQueue.shift();
    if (!jobId) break;

    try {
      await processJob(jobId);
    } catch (error: any) {
      console.error(`Error processing job ${jobId}:`, error);
      await updateJobStatus(jobId, 'FAILED', {
        code: 'PROCESSING_ERROR',
        message: error.message || 'Unknown error',
      });
    }
  }

  isProcessing = false;
}

/**
 * Process a single job
 */
async function processJob(jobId: string): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Get job
  const { data: job, error: jobError } = await supabaseAdmin
    .from('ingestion_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error('Job not found');
  }

  // Get assets for this job
  const { data: assets, error: assetsError } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  if (assetsError) {
    throw new Error(`Failed to fetch assets: ${assetsError.message}`);
  }

  const audioAsset = assets.find(a => a.type === 'AUDIO');
  const transcriptAsset = assets.find(a => a.type === 'TRANSCRIPT_UPLOADED');

  // Process based on mode
  if (job.mode === 'TRANSCRIPT_ONLY') {
    await processTranscriptOnly(job, transcriptAsset!);
  } else if (job.mode === 'AUDIO_ONLY') {
    await processAudioOnly(job, audioAsset!);
  } else if (job.mode === 'AUDIO_PLUS_TRANSCRIPT') {
    await processAudioPlusTranscript(job, audioAsset!, transcriptAsset!);
  }
}

/**
 * Process TRANSCRIPT_ONLY mode
 */
async function processTranscriptOnly(job: any, transcriptAsset: any): Promise<void> {
  // Read and normalize transcript
  const transcriptBuffer = await readAssetContent(transcriptAsset);
  const normalized = await normalizeTranscriptBuffer(transcriptBuffer, transcriptAsset.metadata_json?.filename || 'transcript.txt');

  // Update progress
  await updateJobProgress(job.id, 'ANALYZING', 30);

  // Create conversation
  const conversationId = await createConversation(
    job.org_id,
    job.project_id,
    job.env,
    normalized.text,
    job.created_by_user_id
  );

  // Run analysis
  await updateJobProgress(job.id, 'ANALYZING', 50);

  const evaluationId = await runAnalysis({
    orgId: job.org_id,
    projectId: job.project_id,
    env: job.env,
    conversationId,
    transcript: normalized.text,
    userId: job.created_by_user_id,
    verificationLevel: 'TRANSCRIPT_ONLY',
    transcriptAssetId: transcriptAsset.id,
    jobId: job.id,
  });

  // Store normalized transcript asset
  const normalizedBuffer = Buffer.from(normalized.text, 'utf-8');
  const { data: normalizedAsset, error: assetError } = await supabaseAdmin!
    .from('assets')
    .insert({
      org_id: job.org_id,
      job_id: job.id,
      type: 'TRANSCRIPT_NORMALIZED',
      storage_url: transcriptAsset.storage_url, // Reuse storage
      content_hash: transcriptAsset.content_hash,
      mime_type: 'text/plain',
      metadata_json: normalized.metadata || {},
    })
    .select('id')
    .single();

  // Update job as complete
  await updateJobStatus(job.id, 'COMPLETE', null, {
    analysisRunId: evaluationId,
    verificationReportId: null,
  });
}

/**
 * Process AUDIO_ONLY mode
 */
async function processAudioOnly(job: any, audioAsset: any): Promise<void> {
  // Update progress
  await updateJobProgress(job.id, 'TRANSCRIBING', 20);
  console.log(`[Worker] Starting transcription for job ${job.id}, audio size: ${audioAsset.size_bytes} bytes`);

  // Transcribe audio (with concurrency limit and timeout)
  const audioBuffer = await readAssetContent(audioAsset);
  
  // Add timeout to transcription (30 minutes for large files)
  const transcriptionTimeout = 30 * 60 * 1000; // 30 minutes
  const transcriptionPromise = withTranscriptionSlot(async () => {
    return await transcribeAudio(audioBuffer, audioAsset.metadata_json?.filename || 'audio.wav');
  });
  
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`Transcription timeout after ${transcriptionTimeout/1000/60} minutes`)), transcriptionTimeout)
  );
  
  let transcriptionResult;
  try {
    transcriptionResult = await Promise.race([transcriptionPromise, timeoutPromise]);
    console.log(`[Worker] Transcription completed for job ${job.id}`);
  } catch (error: any) {
    console.error(`[Worker] Transcription failed for job ${job.id}:`, error.message);
    throw error;
  }

  // Store ASR transcript asset
  const transcriptText = transcriptionResult.transcript || transcriptionResult.text || '';
  const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
  
  const { data: asrAsset, error: asrError } = await supabaseAdmin!
    .from('assets')
    .insert({
      org_id: job.org_id,
      job_id: job.id,
      type: 'TRANSCRIPT_ASR',
      storage_url: audioAsset.storage_url.replace(/\.(wav|mp3|m4a)$/, '.txt'), // Placeholder
      content_hash: require('crypto').createHash('sha256').update(transcriptBuffer).digest('hex'),
      mime_type: 'text/plain',
      metadata_json: {
        language: transcriptionResult.language,
        durationMs: transcriptionResult.durationMs,
        vadStats: transcriptionResult.vadStats,
      },
    })
    .select('id')
    .single();

  if (asrError) {
    throw new Error(`Failed to store ASR transcript: ${asrError.message}`);
  }

  // Update progress
  await updateJobProgress(job.id, 'ANALYZING', 60);

  // Create conversation
  const conversationId = await createConversation(
    job.org_id,
    job.project_id,
    job.env,
    transcriptText,
    job.created_by_user_id
  );

  // Run analysis
  const evaluationId = await runAnalysis({
    orgId: job.org_id,
    projectId: job.project_id,
    env: job.env,
    conversationId,
    transcript: transcriptText,
    userId: job.created_by_user_id,
    verificationLevel: 'AUDIO_VERIFIED',
    transcriptAssetId: asrAsset.id,
    jobId: job.id,
  });

  // Update job as complete
  await updateJobStatus(job.id, 'COMPLETE', null, {
    analysisRunId: evaluationId,
    verificationReportId: null,
  });
}

/**
 * Process AUDIO_PLUS_TRANSCRIPT mode
 */
async function processAudioPlusTranscript(job: any, audioAsset: any, transcriptAsset: any): Promise<void> {
  // Step 1: Analyze uploaded transcript immediately
  await updateJobProgress(job.id, 'ANALYZING', 20);

  const transcriptBuffer = await readAssetContent(transcriptAsset);
  const normalized = await normalizeTranscriptBuffer(transcriptBuffer, transcriptAsset.metadata_json?.filename || 'transcript.txt');

  // Create conversation
  const conversationId = await createConversation(
    job.org_id,
    job.project_id,
    job.env,
    normalized.text,
    job.created_by_user_id
  );

  // Run analysis on uploaded transcript
  const evaluationId = await runAnalysis({
    orgId: job.org_id,
    projectId: job.project_id,
    env: job.env,
    conversationId,
    transcript: normalized.text,
    userId: job.created_by_user_id,
    verificationLevel: 'TRANSCRIPT_PROVIDED',
    transcriptAssetId: transcriptAsset.id,
    jobId: job.id,
  });

  // Step 2: Transcribe audio in background
  await updateJobProgress(job.id, 'VERIFYING', 50);

  const audioBuffer = await readAssetContent(audioAsset);
  const transcriptionResult = await withTranscriptionSlot(async () => {
    return await transcribeAudio(audioBuffer, audioAsset.metadata_json?.filename || 'audio.wav');
  });

  // Store ASR transcript
  const asrText = transcriptionResult.transcript || transcriptionResult.text || '';
  const asrBuffer = Buffer.from(asrText, 'utf-8');
  
  const { data: asrAsset, error: asrError } = await supabaseAdmin!
    .from('assets')
    .insert({
      org_id: job.org_id,
      job_id: job.id,
      type: 'TRANSCRIPT_ASR',
      storage_url: audioAsset.storage_url.replace(/\.(wav|mp3|m4a)$/, '.txt'),
      content_hash: require('crypto').createHash('sha256').update(asrBuffer).digest('hex'),
      mime_type: 'text/plain',
      metadata_json: {
        language: transcriptionResult.language,
        durationMs: transcriptionResult.durationMs,
        vadStats: transcriptionResult.vadStats,
      },
    })
    .select('id')
    .single();

  if (asrError) {
    throw new Error(`Failed to store ASR transcript: ${asrError.message}`);
  }

  // Step 3: Compute verification diff
  await updateJobProgress(job.id, 'VERIFYING', 80);

  const verificationReport = await computeVerificationDiff(
    job.org_id,
    job.id,
    transcriptAsset.id,
    asrAsset.id,
    normalized.text,
    asrText
  );

  // Check if mismatch is beyond threshold
  const mismatchThreshold = parseFloat(process.env.VERIFY_MISMATCH_THRESHOLD || '0.20');
  let finalVerificationLevel = 'TRANSCRIPT_PROVIDED';
  
  if (verificationReport.summary_json.mismatchScore > mismatchThreshold) {
    finalVerificationLevel = 'MISMATCH_FLAGGED';
    
    // Update evaluation with mismatch flag
    await supabaseAdmin!
      .from('evaluations')
      .update({ verification_level: 'MISMATCH_FLAGGED' })
      .eq('id', evaluationId);
  }

  // Update job as complete
  await updateJobStatus(job.id, 'COMPLETE', null, {
    analysisRunId: evaluationId,
    verificationReportId: verificationReport.id,
  });
}

/**
 * Helper: Create conversation
 */
async function createConversation(
  orgId: string,
  projectId: string,
  env: string,
  content: string,
  userId: string
): Promise<string> {
  const { data, error } = await supabaseAdmin!
    .from('conversations')
    .insert({
      org_id: orgId,
      project_id: projectId,
      env,
      content,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create conversation: ${error.message}`);
  }

  return data.id;
}

/**
 * Helper: Run analysis from transcript
 * Extracts claims and runs the full analysis pipeline
 */
async function runAnalysis(input: {
  orgId: string;
  projectId: string;
  env: string;
  conversationId: string;
  transcript: string;
  userId: string;
  verificationLevel: string;
  transcriptAssetId: string;
  jobId: string;
}): Promise<string> {
  // Use the existing validate function to run the full pipeline
  // This ensures consistency with the /validate endpoint
  const { validate } = await import('../../orchestrator.js');
  
  const validateInput = {
    question: input.transcript,
    answer: '',
    sources: [] as Array<{ id: string; text: string }>,
    options: {
      conversationId: input.conversationId,
    } as any,
  };

  const validateOutput = await validate(validateInput);

  // Get the evaluation ID from the output
  // The validate function creates an evaluation internally
  // We need to find it by conversationId
  const { data: evaluation, error: evalError } = await supabaseAdmin!
    .from('evaluations')
    .select('id')
    .eq('conversation_id', input.conversationId)
    .eq('org_id', input.orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (evalError || !evaluation) {
    throw new Error(`Failed to find evaluation: ${evalError?.message || 'not found'}`);
  }

  // Update evaluation with job/asset links
  await supabaseAdmin!
    .from('evaluations')
    .update({
      job_id: input.jobId,
      transcript_asset_id: input.transcriptAssetId,
      verification_level: input.verificationLevel,
    })
    .eq('id', evaluation.id);

  return evaluation.id;
}

/**
 * Helper: Update job progress
 */
async function updateJobProgress(jobId: string, stage: string, pct: number): Promise<void> {
  await supabaseAdmin!
    .from('ingestion_jobs')
    .update({
      progress_json: { stage, pct },
    })
    .eq('id', jobId);
}

/**
 * Helper: Update job status
 */
async function updateJobStatus(
  jobId: string,
  status: string,
  error: { code: string; message: string } | null,
  result?: { analysisRunId: string | null; verificationReportId: string | null }
): Promise<void> {
  const update: any = {
    status,
    progress_json: { stage: status, pct: 100 },
  };

  if (error) {
    update.error_code = error.code;
    update.error_message = error.message;
  }

  if (result) {
    update.result_json = result;
  }

  await supabaseAdmin!
    .from('ingestion_jobs')
    .update(update)
    .eq('id', jobId);
}

