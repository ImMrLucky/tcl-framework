/**
 * Ingestion Jobs API
 * Handles job creation, file uploads, and status polling
 */
import express from 'express';
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
export declare function createIngestionJob(orgId: string, projectId: string, env: string, userId: string, mode: IngestionMode): Promise<string>;
/**
 * Upload files for a job
 */
export declare function uploadJobFiles(jobId: string, orgId: string, audioFile?: Express.Multer.File, transcriptFile?: Express.Multer.File): Promise<void>;
/**
 * Get job status
 */
export declare function getJobStatus(jobId: string, orgId: string): Promise<JobStatusResponse>;
/**
 * Register ingestion job endpoints
 */
export declare function registerIngestionJobRoutes(app: express.Express): void;
