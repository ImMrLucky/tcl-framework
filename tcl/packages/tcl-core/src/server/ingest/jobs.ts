/**
 * Ingestion Jobs API
 * Handles job creation, file uploads, and status polling
 */

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import { getOrgContext } from '../auth-context.js';
import { requireCapability } from '../plans/capability-middleware.js';
import { Capability } from '../plans/capabilities.js';
import { supabaseAdmin } from '../supabase.js';
import { storeUploadedAsset, createSignedUrl } from './storage-supabase.js';
import { enqueueJob } from './worker.js';
import crypto from 'crypto';
import { logUpload, logError } from '../utils/logger.js';

// Helper to get MIME type
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

const fsUnlink = promisify(fs.unlink);
const fsMkdir = promisify(fs.mkdir);

// Temp directory for uploads (will be cleaned up after upload to Supabase)
const UPLOAD_TEMP_DIR = join(tmpdir(), 'protectqa-uploads');

// Ensure temp directory exists (synchronous for multer)
function ensureUploadTempDirSync(): string {
  try {
    if (!fs.existsSync(UPLOAD_TEMP_DIR)) {
      fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
      logUpload('debug', `Created temp directory: ${UPLOAD_TEMP_DIR}`);
    }
    return UPLOAD_TEMP_DIR;
  } catch (error: any) {
    logError('Upload', 'Failed to create temp directory', error);
    throw new Error(`Failed to create upload temp directory: ${error.message}`);
  }
}

// Ensure directory exists on startup
try {
  ensureUploadTempDirSync();
} catch (error: any) {
  logError('Upload', 'Warning: Could not create temp directory on startup', error);
}

// Configure multer to use disk storage (not memory)
const upload = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dir = ensureUploadTempDirSync();
        cb(null, dir);
      } catch (error: any) {
        logError('Upload', 'Multer destination error', error);
        cb(error, '');
      }
    },
    filename: (req, file, cb) => {
      // Generate unique filename to avoid collisions
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      const ext = file.originalname.split('.').pop() || 'bin';
      cb(null, `upload-${uniqueSuffix}.${ext}`);
    },
  }),
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
  audioAssetId?: string;
  transcriptAssetId?: string;
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

        logUpload('debug', 'Creating job', { orgId, projectId, env, userId, mode });

  const { data, error } = await supabaseAdmin
    .from('ingestion_jobs')
    .insert({
      org_id: orgId,
      project_id: projectId,
      env: env || 'sandbox',
      created_by_user_id: userId,
      mode,
      status: 'UPLOADED',
      progress_json: { stage: null, pct: 0 },
      result_json: { analysisRunId: null, verificationReportId: null },
    })
    .select('id')
    .single();

  if (error) {
    logError('CreateJob', 'Database error', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    
    // Check for common database errors
    if (error.code === '23503') {
      throw new Error(`Foreign key constraint violation: ${error.message}. Check if org_id, project_id, or user_id exists.`);
    }
    if (error.code === '23505') {
      throw new Error(`Unique constraint violation: ${error.message}`);
    }
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      throw new Error(`Table 'ingestion_jobs' does not exist. Please run database migration 023_ingestion_jobs.sql`);
    }
    
    throw new Error(`Failed to create job: ${error.message} (code: ${error.code || 'unknown'})`);
  }

  if (!data || !data.id) {
    logError('CreateJob', 'No data returned from insert', { data, error });
    throw new Error('Job created but no ID returned from database');
  }

  logUpload('info', `Job created with ID: ${data.id}`);
  return data.id;
}

/**
 * Upload files for a job
 * Uses Supabase Storage (streaming, no RAM buffering)
 */
export async function uploadJobFiles(
  jobId: string,
  orgId: string,
  uploaderUserId: string | null,
  audioFile?: Express.Multer.File,
  transcriptFile?: Express.Multer.File
): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('DATABASE_NOT_CONFIGURED: Database not configured');
  }

  // Track temp files for cleanup
  const tempFiles: string[] = [];
  if (audioFile?.path) tempFiles.push(audioFile.path);
  if (transcriptFile?.path) tempFiles.push(transcriptFile.path);

  try {
    // Get job to validate mode (also verify org_id for security)
    const { data: job, error: jobError } = await supabaseAdmin
      .from('ingestion_jobs')
      .select('mode, status, org_id, project_id')
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
        throw new Error(`JOB_NOT_FOUND: Job not found: ${jobId}`);
      }
      throw new Error(`DATABASE_ERROR: Database error looking up job: ${jobError.message} (code: ${jobError.code || 'unknown'})`);
    }
    
    if (!job) {
      throw new Error(`JOB_NOT_FOUND: Job not found: ${jobId} (does not exist or does not belong to this organization)`);
    }
    
    console.log(`[Upload] Job found: mode=${job.mode}, status=${job.status}`);

    if (job.status !== 'UPLOADED') {
      throw new Error('JOB_ALREADY_UPLOADED: Job already has files uploaded');
    }

    // Validate files match mode
    if (job.mode === 'TRANSCRIPT_ONLY') {
      if (audioFile) {
        throw new Error('INVALID_MODE: TRANSCRIPT_ONLY mode does not accept audio files');
      }
      if (!transcriptFile || !transcriptFile.path) {
        throw new Error('MISSING_FILE: TRANSCRIPT_ONLY mode requires a transcript file');
      }
    } else if (job.mode === 'AUDIO_ONLY') {
      if (!audioFile || !audioFile.path) {
        throw new Error('MISSING_FILE: AUDIO_ONLY mode requires an audio file');
      }
      if (transcriptFile) {
        throw new Error('INVALID_MODE: AUDIO_ONLY mode does not accept transcript files (use AUDIO_PLUS_TRANSCRIPT)');
      }
    } else if (job.mode === 'AUDIO_PLUS_TRANSCRIPT') {
      if (!audioFile || !audioFile.path) {
        throw new Error('MISSING_FILE: AUDIO_PLUS_TRANSCRIPT mode requires an audio file');
      }
      if (!transcriptFile || !transcriptFile.path) {
        throw new Error('MISSING_FILE: AUDIO_PLUS_TRANSCRIPT mode requires a transcript file');
      }
    }

    // Store assets to Supabase Storage
    let audioAssetId: string | null = null;
    let transcriptAssetId: string | null = null;

    // Upload audio file if present
    if (audioFile?.path) {
      try {
        console.log(`[Upload] Storing audio asset: filename=${audioFile.originalname}, path=${audioFile.path}`);
        
        const stored = await storeUploadedAsset({
          kind: 'audio',
          orgId,
          projectId: job.project_id,
          conversationId: null, // conversation_id is not in ingestion_jobs table
          jobId,
          uploaderUserId,
          filePath: audioFile.path,
          originalName: audioFile.originalname || 'audio.wav',
        });

        console.log(`[Upload] Audio stored: bucket=${stored.bucket}, path=${stored.objectPath}, hash=${stored.sha256}`);

        // Save to database
        const insertData: any = {
          org_id: orgId,
          job_id: jobId,
          conversation_id: null, // conversation_id is not in ingestion_jobs table
          uploader_user_id: uploaderUserId,
          type: 'AUDIO',
          kind: 'audio',
          bucket: stored.bucket,
          object_path: stored.objectPath,
          storage_url: `${stored.bucket}/${stored.objectPath}`, // Keep for backward compatibility
          content_hash: stored.sha256,
          size_bytes: stored.sizeBytes,
          mime_type: stored.mimeType,
          metadata_json: {},
        };

        console.log(`[Upload] Inserting audio asset to database:`, {
          org_id: insertData.org_id,
          job_id: insertData.job_id,
          bucket: insertData.bucket,
          object_path: insertData.object_path,
        });

        const { data: dbAsset, error: assetError } = await supabaseAdmin
          .from('assets')
          .insert(insertData)
          .select('id')
          .single();

        if (assetError) {
          console.error(`[Upload] Database error storing audio asset:`, {
            code: assetError.code,
            message: assetError.message,
            details: assetError.details,
            hint: assetError.hint,
            insertData,
          });
          
          if (assetError.code === '42P01') {
            throw new Error('DATABASE_MIGRATION_REQUIRED: Table "assets" does not exist. Please run database migration 024_assets_supabase_storage.sql');
          }
          if (assetError.code === '42703') {
            throw new Error('DATABASE_MIGRATION_REQUIRED: Column "bucket" or "object_path" does not exist in assets table. Please run database migration 024_assets_supabase_storage.sql');
          }
          if (assetError.code === '23503') {
            throw new Error(`DATABASE_FK_VIOLATION: Foreign key constraint violation: ${assetError.message}. Check that job_id exists.`);
          }
          
          throw new Error(`DATABASE_ERROR: Failed to store audio asset in database: ${assetError.message} (code: ${assetError.code || 'unknown'})`);
        }

        if (!dbAsset || !dbAsset.id) {
          throw new Error('DATABASE_ERROR: Audio asset inserted but no ID returned from database');
        }

        audioAssetId = dbAsset.id;
        console.log(`[Upload] Audio asset saved to database with ID: ${audioAssetId}`);
      } catch (error: any) {
        console.error(`[Upload] Error processing audio asset:`, error);
        // Re-throw with actionable error code
        if (error.message.startsWith('STORAGE_') || error.message.startsWith('DATABASE_')) {
          throw error;
        }
        throw new Error(`STORAGE_UPLOAD_FAILED: Failed to process audio asset: ${error.message}`);
      }
    }

    // Upload transcript file if present
    if (transcriptFile?.path) {
      try {
        console.log(`[Upload] Storing transcript asset: filename=${transcriptFile.originalname}, path=${transcriptFile.path}`);
        
        const stored = await storeUploadedAsset({
          kind: 'transcript',
          orgId,
          projectId: job.project_id,
          conversationId: null, // conversation_id is not in ingestion_jobs table
          jobId,
          uploaderUserId,
          filePath: transcriptFile.path,
          originalName: transcriptFile.originalname || 'transcript.txt',
        });

        console.log(`[Upload] Transcript stored: bucket=${stored.bucket}, path=${stored.objectPath}, hash=${stored.sha256}`);

        // Save to database
        const insertData: any = {
          org_id: orgId,
          job_id: jobId,
          conversation_id: null, // conversation_id is not in ingestion_jobs table
          uploader_user_id: uploaderUserId,
          type: 'TRANSCRIPT_UPLOADED',
          kind: 'transcript',
          bucket: stored.bucket,
          object_path: stored.objectPath,
          storage_url: `${stored.bucket}/${stored.objectPath}`, // Keep for backward compatibility
          content_hash: stored.sha256,
          size_bytes: stored.sizeBytes,
          mime_type: stored.mimeType,
          metadata_json: {},
        };

        console.log(`[Upload] Inserting transcript asset to database:`, {
          org_id: insertData.org_id,
          job_id: insertData.job_id,
          bucket: insertData.bucket,
          object_path: insertData.object_path,
        });

        const { data: dbAsset, error: assetError } = await supabaseAdmin
          .from('assets')
          .insert(insertData)
          .select('id')
          .single();

        if (assetError) {
          console.error(`[Upload] Database error storing transcript asset:`, {
            code: assetError.code,
            message: assetError.message,
            details: assetError.details,
            hint: assetError.hint,
            insertData,
          });
          
          if (assetError.code === '42P01') {
            throw new Error('DATABASE_MIGRATION_REQUIRED: Table "assets" does not exist. Please run database migration 024_assets_supabase_storage.sql');
          }
          if (assetError.code === '42703') {
            throw new Error('DATABASE_MIGRATION_REQUIRED: Column "bucket" or "object_path" does not exist in assets table. Please run database migration 024_assets_supabase_storage.sql');
          }
          if (assetError.code === '23503') {
            throw new Error(`DATABASE_FK_VIOLATION: Foreign key constraint violation: ${assetError.message}. Check that job_id exists.`);
          }
          
          throw new Error(`DATABASE_ERROR: Failed to store transcript asset in database: ${assetError.message} (code: ${assetError.code || 'unknown'})`);
        }

        if (!dbAsset || !dbAsset.id) {
          throw new Error('DATABASE_ERROR: Transcript asset inserted but no ID returned from database');
        }

        transcriptAssetId = dbAsset.id;
        console.log(`[Upload] Transcript asset saved to database with ID: ${transcriptAssetId}`);
      } catch (error: any) {
        console.error(`[Upload] Error processing transcript asset:`, error);
        // Re-throw with actionable error code
        if (error.message.startsWith('STORAGE_') || error.message.startsWith('DATABASE_')) {
          throw error;
        }
        throw new Error(`STORAGE_UPLOAD_FAILED: Failed to process transcript asset: ${error.message}`);
      }
    }

    // Update job status with asset IDs
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
        audio_asset_id: audioAssetId,
        transcript_asset_id: transcriptAssetId,
      })
      .eq('id', jobId);

    if (updateError) {
      throw new Error(`DATABASE_ERROR: Failed to update job: ${updateError.message} (code: ${updateError.code || 'unknown'})`);
    }

    // Enqueue job for background processing
    try {
      await enqueueJob(jobId);
      console.log(`[Upload] Job ${jobId} enqueued for processing`);
    } catch (enqueueError: any) {
      console.error(`[Upload] Failed to enqueue job ${jobId}:`, enqueueError);
      // Don't fail the upload if enqueue fails - job can be processed later
    }
  } finally {
    // Always clean up temp files
    for (const tempPath of tempFiles) {
      try {
        if (fs.existsSync(tempPath)) {
          await fsUnlink(tempPath);
          console.log(`[Upload] Cleaned up temp file: ${tempPath}`);
        }
      } catch (cleanupError: any) {
        console.error(`[Upload] Failed to clean up temp file ${tempPath}:`, cleanupError);
        // Don't throw - cleanup errors shouldn't fail the upload
      }
    }
  }
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

  // Get asset IDs if they exist
  const audioAssetId = (job as any).audio_asset_id;
  const transcriptAssetId = (job as any).transcript_asset_id;

  return {
    jobId: job.id,
    status: job.status as JobStatus,
    progress: job.progress_json as { stage: string | null; pct: number },
    result: job.result_json as { analysisRunId: string | null; verificationReportId: string | null },
    error: job.error_code && job.error_message
      ? { code: job.error_code, message: job.error_message }
      : undefined,
    audioAssetId: audioAssetId || undefined,
    transcriptAssetId: transcriptAssetId || undefined,
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
        console.log('[CreateJob] Received request');
        console.log('[CreateJob] Body:', JSON.stringify(req.body));
        
        const context = await getOrgContext(req);
        if (!context || context.error) {
          console.error('[CreateJob] Auth error:', context?.error);
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        if (!context.userId) {
          console.error('[CreateJob] Missing userId in context');
          return res.status(401).json({ error: 'User ID not found in context' });
        }

        if (!context.projectId) {
          console.error('[CreateJob] Missing projectId in context');
          return res.status(400).json({ error: 'Project ID not found in context' });
        }

        console.log('[CreateJob] Context:', {
          orgId: context.orgId,
          projectId: context.projectId,
          env: context.env,
          userId: context.userId,
        });

        const body = req.body as CreateJobRequest;
        if (!body.mode || !['TRANSCRIPT_ONLY', 'AUDIO_ONLY', 'AUDIO_PLUS_TRANSCRIPT'].includes(body.mode)) {
          console.error('[CreateJob] Invalid mode:', body.mode);
          return res.status(400).json({ error: `Invalid mode: ${body.mode}. Must be one of: TRANSCRIPT_ONLY, AUDIO_ONLY, AUDIO_PLUS_TRANSCRIPT` });
        }

        console.log('[CreateJob] Creating job with mode:', body.mode);

        const jobId = await createIngestionJob(
          context.orgId,
          context.projectId,
          context.env || 'sandbox',
          context.userId,
          body.mode
        );

        console.log('[CreateJob] Job created successfully:', jobId);
        res.json({ jobId } as CreateJobResponse);
      } catch (e: any) {
        console.error('[CreateJob] Error:', e);
        console.error('[CreateJob] Error stack:', e.stack);
        console.error('[CreateJob] Request body:', req.body);
        console.error('[CreateJob] Request params:', req.params);
        console.error('[CreateJob] Request query:', req.query);
        
        // Check for specific error types
        if (e.message?.includes('does not exist')) {
          return res.status(500).json({ 
            error: e.message,
            hint: 'Please ensure database migration 023_ingestion_jobs.sql has been run'
          });
        }
        
        res.status(500).json({ 
          error: e.message || 'Failed to create job',
          details: process.env.NODE_ENV === 'development' ? e.stack : undefined
        });
      }
    }
  );

  // Upload files
  app.post(
    '/api/ingest/jobs/:jobId/upload',
    (req, res, next) => {
      console.log('[Upload] ========== UPLOAD REQUEST START ==========');
      console.log('[Upload] Method:', req.method);
      console.log('[Upload] Path:', req.path);
      console.log('[Upload] Job ID:', req.params.jobId);
      console.log('[Upload] Content-Type:', req.headers['content-type']);
      console.log('[Upload] Content-Length:', req.headers['content-length']);
      next();
    },
    requireCapability(Capability.ANALYZE_MANUAL_UPLOAD),
    (req, res, next) => {
      console.log('[Upload] Capability check passed, setting up multer...');
      // Wrap multer in error handler
      upload.fields([
        { name: 'audio', maxCount: 1 },
        { name: 'transcript', maxCount: 1 },
      ])(req, res, (err: any) => {
        if (err) {
          console.error('[Upload] Multer error:', err);
          console.error('[Upload] Multer error code:', err.code);
          console.error('[Upload] Multer error message:', err.message);
          console.error('[Upload] Multer error stack:', err.stack);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 500MB' });
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'Unexpected file field. Only "audio" and "transcript" are allowed' });
          }
          return res.status(400).json({ error: `File upload error: ${err.message}` });
        }
        console.log('[Upload] Multer parsing completed successfully');
        next();
      });
    },
    async (req, res, next) => {
      let context: any = null;
      let files: any = null;
      
      try {
        console.log('[Upload] Handler function started');
        console.log('[Upload] Received upload request for job:', req.params.jobId);
        
        // Get context first
        context = await getOrgContext(req);
        if (!context || context.error) {
          console.error('[Upload] Auth error:', context?.error);
          if (!res.headersSent) {
            return res.status(401).json({ error: context?.error || 'Authorization required' });
          }
          return;
        }

        console.log('[Upload] Context:', { orgId: context.orgId, projectId: context.projectId });

        const { jobId } = req.params;
        files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        
        if (!files) {
          console.error('[Upload] No files object in request');
          if (!res.headersSent) {
            return res.status(400).json({ error: 'No files received. Make sure Content-Type is multipart/form-data' });
          }
          return;
        }

        const audioFile = files.audio?.[0];
        const transcriptFile = files.transcript?.[0];

        console.log('[Upload] Files parsed:', {
          hasAudio: !!audioFile,
          hasTranscript: !!transcriptFile,
          audioSize: audioFile?.size,
          transcriptSize: transcriptFile?.size,
        });

        try {
          await uploadJobFiles(jobId, context.orgId, context.userId || null, audioFile, transcriptFile);
          console.log('[Upload] Upload successful');
          if (!res.headersSent) {
            res.json({ success: true });
          }
        } catch (uploadError: any) {
          // Re-throw to be caught by outer catch block
          throw uploadError;
        }
      } catch (e: any) {
        console.error('[Upload] ========== UPLOAD ERROR ==========');
        console.error('[Upload] Error message:', e.message);
        console.error('[Upload] Error code:', e.code);
        console.error('[Upload] Error stack:', e.stack);
        console.error('[Upload] Job ID:', req.params.jobId);
        console.error('[Upload] Org ID:', context?.orgId);
        console.error('[Upload] User ID:', context?.userId);
        console.error('[Upload] Files received:', {
          hasFiles: !!files,
          audio: !!files?.audio?.[0],
          transcript: !!files?.transcript?.[0],
          audioPath: files?.audio?.[0]?.path,
          transcriptPath: files?.transcript?.[0]?.path,
          audioSize: files?.audio?.[0]?.size,
          transcriptSize: files?.transcript?.[0]?.size,
        });
        console.error('[Upload] ===================================');
        
        // Ensure we always send a response
        if (res.headersSent) {
          console.error('[Upload] Response already sent, cannot send error response');
          return;
        }
        
        try {
          // Check if it's a multer error
          if (e.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
              error: 'LIMIT_FILE_SIZE',
              message: 'File too large. Maximum size is 500MB' 
            });
          }
          if (e.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ 
              error: 'LIMIT_UNEXPECTED_FILE',
              message: 'Unexpected file field' 
            });
          }
          
          // Extract error code and message
          const errorMessage = e.message || 'Failed to upload files';
          const errorCode = errorMessage.split(':')[0];
          const errorDetail = errorMessage.includes(':') ? errorMessage.split(':').slice(1).join(':').trim() : errorMessage;
          
          // Map error codes to HTTP status codes
          let statusCode = 500;
          if (errorCode.startsWith('JOB_NOT_FOUND') || errorCode.startsWith('MISSING_FILE') || errorCode.startsWith('INVALID_MODE')) {
            statusCode = 400;
          } else if (errorCode.startsWith('STORAGE_') || errorCode.startsWith('DATABASE_')) {
            statusCode = 500;
          }
          
          console.error('[Upload] Sending error response:', { statusCode, errorCode, errorDetail });
          res.status(statusCode).json({ 
            error: errorCode || 'INTERNAL_ERROR',
            message: errorDetail || errorMessage,
            details: process.env.NODE_ENV === 'development' ? e.stack : undefined
          });
        } catch (responseError: any) {
          // If JSON response fails, try plain text
          console.error('[Upload] Failed to send JSON error response:', responseError);
          if (!res.headersSent) {
            try {
              res.status(500).send(`Internal Server Error: ${e.message || 'Unknown error'}`);
            } catch (finalError) {
              console.error('[Upload] Failed to send any response:', finalError);
            }
          }
        }
      }
    }
  );

  // Get upload metadata for direct Supabase upload (bypasses Netlify 6MB limit)
  // Frontend will upload directly to Supabase Storage using this metadata
  app.post(
    '/api/ingest/jobs/:jobId/upload-metadata',
    requireCapability(Capability.ANALYZE_MANUAL_UPLOAD),
    async (req, res) => {
      try {
        const { jobId } = req.params;
        logUpload('debug', 'Upload metadata request received', { jobId, body: req.body });

        const context = await getOrgContext(req);
        if (!context || context.error) {
          logError('UploadMetadata', 'Auth error', context?.error);
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        logUpload('debug', 'Upload metadata context', {
          orgId: context.orgId,
          projectId: context.projectId,
          userId: context.userId,
        });

        const { kind, filename } = req.body as { kind: 'audio' | 'transcript'; filename: string };

        if (!kind || !['audio', 'transcript'].includes(kind)) {
          return res.status(400).json({ error: 'Invalid kind. Must be "audio" or "transcript"' });
        }

        if (!filename) {
          return res.status(400).json({ error: 'Filename is required' });
        }

        // Get job to verify ownership and get details in a single query
        logUpload('debug', 'Fetching job for upload metadata', { jobId, orgId: context.orgId });
        const { data: job, error: jobError } = await supabaseAdmin!
          .from('ingestion_jobs')
          .select('id, org_id, project_id')
          .eq('id', jobId)
          .maybeSingle();

        if (jobError) {
          logError('UploadMetadata', 'Database error', {
            error: jobError,
            message: jobError.message,
            code: jobError.code,
            details: jobError.details,
            hint: jobError.hint,
            jobId,
            orgId: context.orgId,
          });
          return res.status(500).json({ 
            error: 'DATABASE_ERROR', 
            message: `Failed to fetch job: ${jobError.message || 'Unknown database error'}` 
          });
        }

        if (!job) {
          logUpload('warn', `Job not found: ${jobId}`);
          return res.status(404).json({ error: 'Job not found' });
        }

        // Verify org ownership
        if (job.org_id !== context.orgId) {
          logUpload('warn', 'Job belongs to different org', {
            jobId,
            jobOrgId: job.org_id,
            userOrgId: context.orgId,
          });
          return res.status(403).json({ error: 'Access denied. Job belongs to a different organization.' });
        }

        // Generate object path
        // Note: conversation_id is not in ingestion_jobs, so we use jobId as the conversation identifier
        const assetId = crypto.randomUUID();
        const ext = filename.split('.').pop() || 'bin';
        const conversationOrJob = jobId; // Use jobId as conversation identifier
        const bucket = kind === 'audio' ? 'protectqa-audio' : 'protectqa-transcripts';
        const objectPath = `org/${context.orgId}/conv/${conversationOrJob}/${kind}/${assetId}.${ext}`;

        // Return upload metadata - frontend will use authenticated Supabase client to upload directly
        // Note: Frontend should use AuthService's Supabase client (with user's session token)
        res.json({
          bucket,
          objectPath,
          assetId,
          supabaseUrl: process.env.SUPABASE_URL, // Frontend already has this, but include for convenience
        });
      } catch (e: any) {
        logError('Upload', 'Error creating upload metadata', e);
        res.status(500).json({ 
          error: 'INTERNAL_ERROR',
          message: e.message || 'Failed to create upload metadata' 
        });
      }
    }
  );

  // Finalize upload after direct Supabase upload completes
  // Frontend calls this after successfully uploading to Supabase Storage
  app.post(
    '/api/ingest/jobs/:jobId/finalize-upload',
    requireCapability(Capability.ANALYZE_MANUAL_UPLOAD),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        if (!context || context.error) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { jobId } = req.params;
        const { 
          assetId, 
          bucket, 
          objectPath, 
          filename, 
          sizeBytes, 
          sha256,
          kind 
        } = req.body as {
          assetId: string;
          bucket: string;
          objectPath: string;
          filename: string;
          sizeBytes: number;
          sha256: string;
          kind: 'audio' | 'transcript';
        };

        // Validate inputs
        if (!assetId || !bucket || !objectPath || !filename || !kind) {
          return res.status(400).json({ error: 'Missing required fields: assetId, bucket, objectPath, filename, kind' });
        }

        if (!['audio', 'transcript'].includes(kind)) {
          return res.status(400).json({ error: 'Invalid kind. Must be "audio" or "transcript"' });
        }

        // Get job to verify ownership and get details in a single query
        logUpload('debug', 'Fetching job for finalize upload', { jobId, orgId: context.orgId });
        const { data: job, error: jobError } = await supabaseAdmin!
          .from('ingestion_jobs')
          .select('id, org_id, project_id')
          .eq('id', jobId)
          .maybeSingle();

        if (jobError) {
          logError('FinalizeUpload', 'Database error', {
            error: jobError,
            message: jobError.message,
            code: jobError.code,
            details: jobError.details,
            hint: jobError.hint,
            jobId,
            orgId: context.orgId,
          });
          return res.status(500).json({ 
            error: 'DATABASE_ERROR', 
            message: `Failed to fetch job: ${jobError.message || 'Unknown database error'}` 
          });
        }

        if (!job) {
          logUpload('warn', `Job not found: ${jobId}`);
          return res.status(404).json({ error: 'Job not found' });
        }

        // Verify org ownership
        if (job.org_id !== context.orgId) {
          logUpload('warn', 'Job belongs to different org', {
            jobId,
            jobOrgId: job.org_id,
            userOrgId: context.orgId,
          });
          return res.status(403).json({ error: 'Access denied. Job belongs to a different organization.' });
        }

        // Verify file exists in storage using download (strongest verification)
        // This ensures the file is actually accessible, not just listed
        const { data: fileContent, error: dlError } = await supabaseAdmin!
          .storage
          .from(bucket)
          .download(objectPath);

        if (dlError) {
          logError('FinalizeUpload', 'File not downloadable in storage', {
            bucket,
            objectPath,
            error: dlError.message,
          });
          return res.status(400).json({
            error: 'STORAGE_VERIFY_FAILED',
            message: `File not downloadable at ${bucket}/${objectPath}: ${dlError.message}. Upload likely failed or used wrong path encoding.`,
          });
        }

        // Verify we got actual content (not empty)
        if (!fileContent || (fileContent instanceof Blob && fileContent.size === 0)) {
          logError('FinalizeUpload', 'File exists but is empty', { bucket, objectPath });
          return res.status(400).json({
            error: 'STORAGE_VERIFY_FAILED',
            message: `File at ${bucket}/${objectPath} exists but is empty. Upload may have failed.`,
          });
        }

        // File verified successfully
        logUpload('debug', 'File verified in storage', {
          bucket,
          objectPath,
          size: fileContent instanceof Blob ? fileContent.size : 'unknown',
        });

        // Create asset record
        const assetType = kind === 'audio' ? 'AUDIO' : 'TRANSCRIPT_UPLOADED';
        const insertData: any = {
          org_id: context.orgId,
          job_id: jobId,
          conversation_id: null, // conversation_id is not in ingestion_jobs table
          uploader_user_id: context.userId || null,
          type: assetType,
          kind: kind,
          bucket: bucket,
          object_path: objectPath,
          storage_url: `${bucket}/${objectPath}`, // Keep for backward compatibility
          content_hash: sha256 || null,
          size_bytes: sizeBytes || null,
          mime_type: getMimeType(filename),
          metadata_json: {},
        };

        const { data: dbAsset, error: assetError } = await supabaseAdmin!
          .from('assets')
          .insert(insertData)
          .select('id')
          .single();

        if (assetError) {
          logError('Upload', 'Database error storing asset', {
            code: assetError.code,
            message: assetError.message,
            details: assetError.details,
            hint: assetError.hint,
          });
          
          if (assetError.code === '42P01') {
            return res.status(500).json({ 
              error: 'DATABASE_MIGRATION_REQUIRED',
              message: 'Table "assets" does not exist. Please run database migration 024_assets_supabase_storage.sql' 
            });
          }
          if (assetError.code === '42703') {
            return res.status(500).json({ 
              error: 'DATABASE_MIGRATION_REQUIRED',
              message: 'Column "bucket" or "object_path" does not exist in assets table. Please run database migration 024_assets_supabase_storage.sql' 
            });
          }
          
          return res.status(500).json({ 
            error: 'DATABASE_ERROR',
            message: `Failed to store asset in database: ${assetError.message} (code: ${assetError.code || 'unknown'})` 
          });
        }

        if (!dbAsset || !dbAsset.id) {
          return res.status(500).json({ 
            error: 'DATABASE_ERROR',
            message: 'Asset inserted but no ID returned from database' 
          });
        }

        // Update job with asset ID
        const updateData: any = {};
        if (kind === 'audio') {
          updateData.audio_asset_id = dbAsset.id;
        } else {
          updateData.transcript_asset_id = dbAsset.id;
        }

        // Check if both files are uploaded to determine job status
        const { data: updatedJob, error: fetchError } = await supabaseAdmin!
          .from('ingestion_jobs')
          .select('mode, status, audio_asset_id, transcript_asset_id')
          .eq('id', jobId)
          .single();

        if (!fetchError && updatedJob) {
          // Update asset IDs
          const { error: updateError } = await supabaseAdmin!
            .from('ingestion_jobs')
            .update(updateData)
            .eq('id', jobId);

          if (updateError) {
            logError('Upload', 'Error updating job with asset ID', updateError);
          }

          // Check if all required files are uploaded
          const hasAudio = updatedJob.audio_asset_id || (kind === 'audio' && dbAsset.id);
          const hasTranscript = updatedJob.transcript_asset_id || (kind === 'transcript' && dbAsset.id);

          // Determine if job is ready for processing
          let shouldUpdateStatus = false;
          let newStatus: JobStatus = updatedJob.status as JobStatus;
          
          if (updatedJob.mode === 'TRANSCRIPT_ONLY' && hasTranscript) {
            shouldUpdateStatus = true;
            newStatus = 'ANALYZING';
          } else if (updatedJob.mode === 'AUDIO_ONLY' && hasAudio) {
            shouldUpdateStatus = true;
            newStatus = 'TRANSCRIBING';
          } else if (updatedJob.mode === 'AUDIO_PLUS_TRANSCRIPT' && hasAudio && hasTranscript) {
            shouldUpdateStatus = true;
            newStatus = 'VERIFYING';
          }

          // Update status and enqueue if ready
          if (shouldUpdateStatus && updatedJob.status === 'UPLOADED') {
            const { error: statusError } = await supabaseAdmin!
              .from('ingestion_jobs')
              .update({
                status: newStatus,
                progress_json: { stage: newStatus, pct: 10 },
              })
              .eq('id', jobId);

            if (statusError) {
              console.error('[Upload] Error updating job status:', statusError);
            } else {
              // Enqueue job for background processing
              try {
                await enqueueJob(jobId);
                logUpload('info', `Job ${jobId} enqueued for processing`);
              } catch (enqueueError: any) {
                logError('Upload', `Failed to enqueue job ${jobId}`, enqueueError);
              }
            }
          }
        }

        res.json({
          success: true,
          assetId: dbAsset.id,
          bucket,
          objectPath,
        });
      } catch (e: any) {
        logError('Upload', 'Error finalizing upload', e);
        res.status(500).json({ 
          error: 'INTERNAL_ERROR',
          message: e.message || 'Failed to finalize upload' 
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

  // Get signed URL for asset download (bypasses RLS)
  app.get(
    '/api/ingest/assets/:assetId/signed-url',
    requireCapability(Capability.ANALYZE_MANUAL_UPLOAD),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        if (!context || context.error) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        const { assetId } = req.params;
        const expiresIn = parseInt(req.query.expiresIn as string) || 3600; // Default 1 hour

        // Get asset to verify ownership
        const { data: asset, error: assetError } = await supabaseAdmin!
          .from('assets')
          .select('id, org_id, bucket, object_path')
          .eq('id', assetId)
          .maybeSingle();

        if (assetError) {
          console.error('[SignedUrl] Database error:', assetError);
          return res.status(500).json({ 
            error: 'DATABASE_ERROR', 
            message: `Failed to fetch asset: ${assetError.message || 'Unknown database error'}` 
          });
        }

        if (!asset) {
          return res.status(404).json({ error: 'Asset not found' });
        }

        // Verify org ownership
        if (asset.org_id !== context.orgId) {
          return res.status(403).json({ error: 'Access denied. Asset belongs to a different organization.' });
        }

        // Check if asset has Supabase Storage location
        if (!asset.bucket || !asset.object_path) {
          return res.status(400).json({ error: 'Asset does not have a Supabase Storage location' });
        }

        // Create signed URL
        const signedUrl = await createSignedUrl(asset.bucket, asset.object_path, expiresIn);

        res.json({ signedUrl, expiresIn });
      } catch (e: any) {
        console.error('[SignedUrl] Error:', e);
        res.status(500).json({ 
          error: 'INTERNAL_ERROR',
          message: e.message || 'Failed to create signed URL' 
        });
      }
    }
  );
}

