/**
 * Background Job Worker
 * Processes ingestion jobs asynchronously
 */

import { supabaseAdmin } from '../supabase.js';
import { downloadFileFromSupabase } from './storage-supabase.js';
import { readAsset } from './storage.js'; // Keep for backward compatibility
import { normalizeTranscriptBuffer } from '../transcripts/normalize.js';
import { transcribeAudio, type TranscriptionResult } from '../transcription.js';
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

  // Skip if job is not in a processing state (READY jobs must be started via /start endpoint)
  if (job.status === 'READY' || job.status === 'UPLOADED') {
    console.log(`[Worker] Skipping job ${jobId} - status is ${job.status}, waiting for /start`);
    return;
  }

  // Get assets for this job (use asset_id fields from ingestion_jobs)
  let audioAsset: any = null;
  let transcriptAsset: any = null;

  if (job.audio_asset_id) {
    const { data: audio, error: audioError } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('id', job.audio_asset_id)
      .single();
    if (audioError) {
      console.error(`[Worker] Failed to fetch audio asset ${job.audio_asset_id}:`, audioError);
    } else {
      audioAsset = audio;
    }
  }

  if (job.transcript_asset_id) {
    const { data: transcript, error: transcriptError } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('id', job.transcript_asset_id)
      .single();
    if (transcriptError) {
      console.error(`[Worker] Failed to fetch transcript asset ${job.transcript_asset_id}:`, transcriptError);
    } else {
      transcriptAsset = transcript;
    }
  }

  // Fallback: also check legacy job_id-based assets for backward compatibility
  if (!audioAsset || !transcriptAsset) {
    const { data: assets, error: assetsError } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (!assetsError && assets) {
      if (!audioAsset) {
        audioAsset = assets.find((a: any) => a.kind === 'audio' || a.type === 'AUDIO');
      }
      if (!transcriptAsset) {
        transcriptAsset = assets.find((a: any) => a.kind === 'transcript' || a.type === 'TRANSCRIPT_UPLOADED');
      }
    }
  }

  // Process based on mode and status
  if (job.mode === 'TRANSCRIPT_ONLY') {
    if (!transcriptAsset) {
      throw new Error('Transcript asset required for TRANSCRIPT_ONLY mode');
    }
    await processTranscriptOnly(job, transcriptAsset);
  } else if (job.mode === 'AUDIO_ONLY') {
    if (!audioAsset) {
      throw new Error('Audio asset required for AUDIO_ONLY mode');
    }
    if (job.status === 'TRANSCRIBING') {
      await processAudioOnly(job, audioAsset);
    } else {
      throw new Error(`Invalid status ${job.status} for AUDIO_ONLY mode`);
    }
  } else if (job.mode === 'AUDIO_PLUS_TRANSCRIPT') {
    if (!transcriptAsset) {
      throw new Error('Transcript asset required for AUDIO_PLUS_TRANSCRIPT mode');
    }
    await processAudioPlusTranscript(job, audioAsset, transcriptAsset);
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
  
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error(`Transcription timeout after ${transcriptionTimeout/1000/60} minutes`)), transcriptionTimeout)
  );
  
  let transcriptionResult: TranscriptionResult;
  try {
    transcriptionResult = await Promise.race([transcriptionPromise, timeoutPromise]) as TranscriptionResult;
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

  // Step 2: Transcribe audio in background (optional - don't block on failure)
  // Evaluation is already complete, so audio transcription/verification is optional
  let verificationReportId: string | null = null;

  if (audioAsset) {
    try {
      await updateJobProgress(job.id, 'VERIFYING', 50);
      const audioBuffer = await readAssetContent(audioAsset);
      const transcriptionResult = await withTranscriptionSlot(async () => {
        return await transcribeAudio(audioBuffer, audioAsset.metadata_json?.filename || 'audio.wav');
      });

      // Store ASR transcript
      const asrText = transcriptionResult.transcript || transcriptionResult.text || '';
      const asrBuffer = Buffer.from(asrText, 'utf-8');
      
      const { data: asrAssetData, error: asrError } = await supabaseAdmin!
        .from('assets')
        .insert({
          org_id: job.org_id,
          job_id: job.id,
          kind: 'transcript',
          type: 'TRANSCRIPT_ASR',
          storage_url: audioAsset.storage_url?.replace(/\.(wav|mp3|m4a)$/, '.txt') || null,
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
        console.warn(`[Worker] Failed to store ASR transcript for job ${job.id}:`, asrError.message);
      } else {
        // Step 3: Compute verification diff
        await updateJobProgress(job.id, 'VERIFYING', 80);

        const verificationReport = await computeVerificationDiff(
          job.org_id,
          job.id,
          transcriptAsset.id,
          asrAssetData.id,
          normalized.text,
          asrText
        );

        verificationReportId = verificationReport.id;

        // Check if mismatch is beyond threshold
        const mismatchThreshold = parseFloat(process.env.VERIFY_MISMATCH_THRESHOLD || '0.20');
        
        if (verificationReport.summary_json.mismatchScore > mismatchThreshold) {
          // Update evaluation with mismatch flag
          await supabaseAdmin!
            .from('evaluations')
            .update({ verification_level: 'MISMATCH_FLAGGED' })
            .eq('id', evaluationId);
        }
      }
    } catch (audioError: any) {
      // Audio transcription/verification failed, but evaluation is already complete
      console.warn(`[Worker] Audio transcription/verification failed for job ${job.id}, but evaluation is complete:`, audioError.message);
    }
  }

  // Update job as complete (evaluation is already done, audio verification is optional)
  await updateJobStatus(job.id, 'COMPLETE', null, {
    analysisRunId: evaluationId,
    verificationReportId: verificationReportId,
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

  // The validate function does NOT create evaluations - we need to create it ourselves
  // Format scores for database (similar to /validate endpoint)
  const scoresForDb = {
    truth: validateOutput.scores.truth ?? null,
    consistency: validateOutput.scores.consistency ?? null,
    coherence: validateOutput.scores.coherence ?? null,
    overall: validateOutput.scores.overall ?? null,
  };

  // Build proper IssueV2 objects using expandIssueCandidates and rankIssuesV2
  // This matches what the /validate endpoint does
  let allIssuesV2: any[] = [];
  let topIssuesV2: any[] = [];
  let issueSummaryV2: any = null;

  try {
    const { expandIssueCandidates } = await import('../../analysis/issue-expansion.js');
    const { rankIssuesV2 } = await import('../../analysis/risk-ranking.js');

    // Get graph data from report
    const graphData = validateOutput.report?.graph;
    const graphSupports = graphData?.supports || [];
    const graphContradictions = graphData?.contradictions || [];
    const graphGrounding = graphData?.grounding || [];

    // Map claims to format expected by expandIssueCandidates
    const claimsForIssues = (validateOutput.report?.claims || []).map((c: any) => ({
      id: c.id,
      text: c.text,
      confidence: c.confidenceMetrics?.groundingScore ?? c.confidence ?? 0,
      evidence: c.evidence || [],
      meta: {
        speaker: c.meta?.speaker,
        turnIndex: c.meta?.turnIndex
      },
      claimType: c.claimType,
      isAuditable: c.isAuditable,
      topicTags: c.topicTags || [],
      hasAbsoluteLanguage: c.hasAbsoluteLanguage || false,
      hasMoney: c.hasMoney || false
    }));

    // Determine evidence mode based on verification level
    const evidenceMode = input.verificationLevel === 'TRANSCRIPT_ONLY' ? 'TRANSCRIPT_ONLY' : 'WITH_EVIDENCE';

    // Expand issues from graph (creates proper IssueV2 format)
    const expansionResult = expandIssueCandidates({
      claims: claimsForIssues,
      contradictions: graphContradictions,
      supports: graphSupports,
      grounding: graphGrounding,
      runId: 'pending', // Will be updated after evaluation is created
      conversationId: input.conversationId,
      evidenceMode,
      audit: {
        engineVersion: validateOutput.engineVersion || process.env.ENGINE_VERSION || '0.2.0',
        scorerId: validateOutput.scorerId || 'unified-graph-v1',
        modelFingerprint: validateOutput.report?.manifest?.modelFingerprint,
        configHash: validateOutput.report?.manifest?.configHash,
        inputHash: validateOutput.report?.manifest?.inputHash,
      },
    });

    // Rank issues (deterministic) with scoring context
    const scoringContext = {
      mode: (evidenceMode === 'TRANSCRIPT_ONLY' ? 'transcript_only' : 'with_evidence') as 'transcript_only' | 'with_evidence',
      numSources: 0, // No external sources for ingestion jobs
      graphStatus: graphData?.debug?.graphStatus,
      templateId: validateOutput.report?.manifest?.templateId,
      isRegulatedTemplate: false,
    };
    const rankedResult = rankIssuesV2(expansionResult.allIssues, undefined, scoringContext);

    allIssuesV2 = rankedResult.allIssues;
    topIssuesV2 = rankedResult.topIssues;
    issueSummaryV2 = rankedResult.summary;
  } catch (issueError: any) {
    console.error(`[Worker] Failed to expand/rank issues, using fallback:`, issueError);
    // Fallback: use destructiveClaims if expansion fails
    allIssuesV2 = validateOutput.report?.destructiveClaims || [];
    topIssuesV2 = (validateOutput.report?.destructiveClaims || []).slice(0, 10);
  }

  // Build report with issues (similar to /validate endpoint)
  const reportWithIssues = {
    ...validateOutput.report,
    allIssuesV2,
    topIssuesV2,
    issueSummaryV2,
  };

  // Create the evaluation in the database
  const { data: insertedEvaluation, error: dbError } = await supabaseAdmin!
    .from('evaluations')
    .insert({
      org_id: input.orgId,
      project_id: input.projectId || null,
      conversation_id: input.conversationId || null,
      env: input.env,
      scores: scoresForDb,
      refusal: validateOutput.refusal || false,
      scorer_id: validateOutput.scorerId || null,
      engine_version: process.env.ENGINE_VERSION || '0.2.0',
      latency_ms: validateOutput.latency || 0,
      report: reportWithIssues,
      job_id: input.jobId,
      transcript_asset_id: input.transcriptAssetId,
      verification_level: input.verificationLevel,
    })
    .select('id')
    .single();

  if (dbError) {
    throw new Error(`Failed to create evaluation: ${dbError.message}`);
  }

  if (!insertedEvaluation) {
    throw new Error(`Failed to create evaluation: no ID returned`);
  }

  // Update runId in allIssuesV2 and topIssuesV2 if they exist (similar to /validate endpoint)
  if (insertedEvaluation.id && (allIssuesV2.length > 0 || topIssuesV2.length > 0)) {
    const { createHash } = await import('crypto');
    const updateRunId = (issue: any) => {
      if (issue && issue.runId === 'pending') {
        issue.runId = insertedEvaluation.id;
        // Regenerate issueId with correct runId
        const hash = createHash('sha256')
          .update(`${insertedEvaluation.id}:${issue.issueKey}`)
          .digest('hex')
          .substring(0, 16);
        issue.issueId = `issue_${hash}`;
      }
      return issue;
    };

    allIssuesV2 = allIssuesV2.map(updateRunId);
    topIssuesV2 = topIssuesV2.map(updateRunId);

    // Update the report in the database with the corrected runIds
    const updatedReport = {
      ...reportWithIssues,
      allIssuesV2,
      topIssuesV2,
    };

    await supabaseAdmin!
      .from('evaluations')
      .update({ report: updatedReport })
      .eq('id', insertedEvaluation.id);
  }

  return insertedEvaluation.id;
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

