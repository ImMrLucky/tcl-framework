/**
 * Background Job Worker
 * Processes ingestion jobs asynchronously
 */
/**
 * Enqueue a job for processing
 */
export declare function enqueueJob(jobId: string): Promise<void>;
