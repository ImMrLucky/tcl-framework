/**
 * Batch Ingestion Worker
 * Processes batch items asynchronously by creating ingestion jobs
 */
/**
 * Enqueue a batch for processing
 */
export declare function enqueueBatch(batchId: string): Promise<void>;
/**
 * Process retry queue (items scheduled for retry)
 */
export declare function processRetryQueue(): Promise<void>;
