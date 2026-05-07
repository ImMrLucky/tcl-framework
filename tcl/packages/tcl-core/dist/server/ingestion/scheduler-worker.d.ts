/**
 * Scheduled Ingestion Worker
 *
 * Polls for scheduled ingestion jobs and executes them.
 * Runs every minute to check for schedules that need to run.
 */
/**
 * Start the scheduler worker
 */
export declare function startSchedulerWorker(): void;
/**
 * Stop the scheduler worker
 */
export declare function stopSchedulerWorker(): void;
