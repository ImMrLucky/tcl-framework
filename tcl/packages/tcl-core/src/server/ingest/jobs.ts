/**
 * Ingestion Jobs API
 * Handles job creation, file uploads, and status polling
 */

import express from 'express';
import multer from 'multer';
import { getOrgContext } from '../auth-context.js';
import { requireCapability } from '../plans/capability-middleware.js';
import { Capability } from '../plans/capabilities.js';
import { supabaseAdmin } from '../supabase.js';
import { storeAsset, AssetType } from './storage.js';
import { normalizeTranscriptBuffer } from '../transcripts/normalize.js';
import { enqueueJob } from './worker.js';

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 500 * 1024 * 1024, // 500MB max
    files: 2, // Max 2 files (audio + transcript)
  },
  fileFilter: (req, file, cb) => {
    // Accept all files - validation happens in uploadJobFiles
    cb(null, true);
  },
});

export type IngestionMode = 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT';
export type JobStatus = 'UPLOADED' | 'TRANSCRIBING' | 'ANALYZING' | 'VERIFYING' | 'COMPLETE' | 'FAILED';

export interface CreateJobRequest {
  mode: IngestionMode;
  options?: {
    analyzeImmediately?: boolean;
  };
}

export interface CreateJobResponse {
  jobId: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  progress: {
    stage: string | null;
    pct: number;
  };
  result: {
    analysisRunId: string | null;
    verificationReportId: string | null;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Create a new ingestion job
 */
export async function createIngestionJob(
  orgId: string,
  projectId: string,
  env: string,
  userId: string,
  mode: IngestionMode
): Promise<string> {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('ingestion_jobs')
    .insert({
      org_id: orgId,
      project_id: projectId,
      env,
      created_by_user_id: userId,
      mode,
      status: 'UPLOADED',
      progress_json: { stage: null, pct: 0 },
      result_json: { analysisRunId: null, verificationReportId: null },
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create job: ${error.message}`);
  }

  return data.id;
}

/**
 * Upload files for a job
 */
export async function uploadJobFiles(
  jobId: string,
  orgId: string,
  audioFile?: Express.Multer.File,
  transcriptFile?: Express.Multer.File
): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Get job to validate mode (also verify org_id for security)
  const { data: job, error: jobError } = await supabaseAdmin
    .from('ingestion_jobs')
    .select('mode, status, org_id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .single();

  if (jobError) {
    console.error('[Upload] Job lookup error:', {
      code: jobError.code,
      message: jobError.message,
      details: jobError.details,
      hint: jobError.hint,
    });
    
    if (jobError.code === 'PGRST116') {
      throw new Error(`Job not found: ${jobId}`);
    }
    throw new Error(`Database error looking up job: ${jobError.message}`);
  }
  
  if (!job) {
    throw new Error(`Job not found: ${jobId} (does not exist or does not belong to this organization)`);
  }
  
  console.log(`[Upload] Job found: mode=${job.mode}, status=${job.status}`);

  if (job.status !== 'UPLOADED') {
    throw new Error('Job already has files uploaded');
  }

  const assets: Array<{ type: AssetType; buffer: Buffer; filename: string; metadata: any }> = [];

  // Validate files match mode
  if (job.mode === 'TRANSCRIPT_ONLY') {
    if (audioFile) {
      throw new Error('TRANSCRIPT_ONLY mode does not accept audio files');
    }
    if (!transcriptFile) {
      throw new Error('TRANSCRIPT_ONLY mode requires a transcript file');
    }
    assets.push({
      type: 'TRANSCRIPT_UPLOADED',
      buffer: transcriptFile.buffer,
      filename: transcriptFile.originalname,
      metadata: {},
    });
  } else if (job.mode === 'AUDIO_ONLY') {
    if (!audioFile) {
      throw new Error('AUDIO_ONLY mode requires an audio file');
    }
    if (transcriptFile) {
      throw new Error('AUDIO_ONLY mode does not accept transcript files (use AUDIO_PLUS_TRANSCRIPT)');
    }
    assets.push({
      type: 'AUDIO',
      buffer: audioFile.buffer,
      filename: audioFile.originalname,
      metadata: {},
    });
  } else if (job.mode === 'AUDIO_PLUS_TRANSCRIPT') {
    if (!audioFile) {
      throw new Error('AUDIO_PLUS_TRANSCRIPT mode requires an audio file');
    }
    if (!transcriptFile) {
      throw new Error('AUDIO_PLUS_TRANSCRIPT mode requires a transcript file');
    }
    assets.push({
      type: 'AUDIO',
      buffer: audioFile.buffer,
      filename: audioFile.originalname,
      metadata: {},
    });
    assets.push({
      type: 'TRANSCRIPT_UPLOADED',
      buffer: transcriptFile.buffer,
      filename: transcriptFile.originalname,
      metadata: {},
    });
  }

  // Store assets
  const assetIds: string[] = [];
  for (const asset of assets) {
    try {
      console.log(`[Upload] Storing asset: type=${asset.type}, filename=${asset.filename}, size=${asset.buffer.length}`);
      
      const stored = await storeAsset(
        asset.buffer,
        asset.type,
        orgId,
        jobId,
        asset.filename,
        asset.metadata
      );

      console.log(`[Upload] Asset stored at: ${stored.storageUrl}`);

      // Save to database
      const { data: dbAsset, error: assetError } = await supabaseAdmin
        .from('assets')
        .insert({
          org_id: orgId,
          job_id: jobId,
          type: asset.type,
          storage_url: stored.storageUrl,
          content_hash: stored.contentHash,
          mime_type: stored.mimeType,
          metadata_json: stored.metadata,
        })
        .select('id')
        .single();

      if (assetError) {
        console.error(`[Upload] Database error storing asset:`, assetError);
        throw new Error(`Failed to store asset in database: ${assetError.message} (code: ${assetError.code})`);
      }

      console.log(`[Upload] Asset saved to database with ID: ${dbAsset.id}`);
      assetIds.push(dbAsset.id);
    } catch (error: any) {
      console.error(`[Upload] Error processing asset ${asset.type}:`, error);
      throw new Error(`Failed to process ${asset.type} asset: ${error.message}`);
    }
  }

  // Update job status and enqueue processing
  let newStatus: JobStatus = 'UPLOADED';
  if (job.mode === 'TRANSCRIPT_ONLY') {
    newStatus = 'ANALYZING';
  } else if (job.mode === 'AUDIO_ONLY') {
    newStatus = 'TRANSCRIBING';
  } else if (job.mode === 'AUDIO_PLUS_TRANSCRIPT') {
    newStatus = 'VERIFYING'; // Will analyze transcript immediately, then verify
  }

  const { error: updateError } = await supabaseAdmin
    .from('ingestion_jobs')
    .update({
      status: newStatus,
      progress_json: { stage: newStatus, pct: 10 },
    })
    .eq('id', jobId);

  if (updateError) {
    throw new Error(`Failed to update job: ${updateError.message}`);
  }

  // Enqueue job for background processing
  await enqueueJob(jobId);
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string, orgId: string): Promise<JobStatusResponse> {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  const { data: job, error } = await supabaseAdmin
    .from('ingestion_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .single();

  if (error || !job) {
    throw new Error('Job not found');
  }

  return {
    jobId: job.id,
    status: job.status as JobStatus,
    progress: job.progress_json as { stage: string | null; pct: number },
    result: job.result_json as { analysisRunId: string | null; verificationReportId: string | null },
    error: job.error_code && job.error_message
      ? { code: job.error_code, message: job.error_message }
      : undefined,
  };
}

/**
 * Register ingestion job endpoints
 */
export function registerIngestionJobRoutes(app: express.Express) {
  // Create job
  app.post(
    '/api/ingest/jobs',
    requireCapability(Capability.ANALYZE_MANUAL_UPLOAD),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        if (!context || context.error || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const body = req.body as CreateJobRequest;
        if (!body.mode || !['TRANSCRIPT_ONLY', 'AUDIO_ONLY', 'AUDIO_PLUS_TRANSCRIPT'].includes(body.mode)) {
          return res.status(400).json({ error: 'Invalid mode' });
        }

        const jobId = await createIngestionJob(
          context.orgId,
          context.projectId,
          context.env,
          context.userId,
          body.mode
        );

        res.json({ jobId } as CreateJobResponse);
      } catch (e: any) {
        console.error('Create job error:', e);
        res.status(500).json({ error: e.message || 'Failed to create job' });
      }
    }
  );

  // Upload files
  app.post(
    '/api/ingest/jobs/:jobId/upload',
    requireCapability(Capability.ANALYZE_MANUAL_UPLOAD),
    (req, res, next) => {
      // Wrap multer in error handler
      upload.fields([
        { name: 'audio', maxCount: 1 },
        { name: 'transcript', maxCount: 1 },
      ])(req, res, (err: any) => {
        if (err) {
          console.error('[Upload] Multer error:', err);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 500MB' });
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'Unexpected file field. Only "audio" and "transcript" are allowed' });
          }
          return res.status(400).json({ error: `File upload error: ${err.message}` });
        }
        next();
      });
    },
    async (req, res) => {
      let context: any = null;
      let files: any = null;
      
      try {
        console.log('[Upload] Received upload request for job:', req.params.jobId);
        
        // Get context first
        context = await getOrgContext(req);
        if (!context || context.error) {
          console.error('[Upload] Auth error:', context?.error);
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        console.log('[Upload] Context:', { orgId: context.orgId, projectId: context.projectId });

        const { jobId } = req.params;
        files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        
        if (!files) {
          console.error('[Upload] No files object in request');
          return res.status(400).json({ error: 'No files received. Make sure Content-Type is multipart/form-data' });
        }

        const audioFile = files.audio?.[0];
        const transcriptFile = files.transcript?.[0];

        console.log('[Upload] Files parsed:', {
          hasAudio: !!audioFile,
          hasTranscript: !!transcriptFile,
          audioSize: audioFile?.size,
          transcriptSize: transcriptFile?.size,
        });

        await uploadJobFiles(jobId, context.orgId, audioFile, transcriptFile);

        console.log('[Upload] Upload successful');
        res.json({ success: true });
      } catch (e: any) {
        console.error('[Upload] Error:', e);
        console.error('[Upload] Error stack:', e.stack);
        console.error('[Upload] Job ID:', req.params.jobId);
        console.error('[Upload] Org ID:', context?.orgId);
        console.error('[Upload] Files received:', {
          hasFiles: !!files,
          audio: !!files?.audio?.[0],
          transcript: !!files?.transcript?.[0],
        });
        
        // Check if it's a multer error
        if (e.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 500MB' });
        }
        if (e.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'Unexpected file field' });
        }
        
        res.status(500).json({ 
          error: e.message || 'Failed to upload files',
          details: process.env.NODE_ENV === 'development' ? e.stack : undefined
        });
      }
    }
  );

  // Get job status
  app.get('/api/ingest/jobs/:jobId', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { jobId } = req.params;
      const status = await getJobStatus(jobId, context.orgId);

      res.json(status);
    } catch (e: any) {
      console.error('Get job status error:', e);
      res.status(500).json({ error: e.message || 'Failed to get job status' });
    }
  });
}

