/**
 * Evidence Indexing Worker
 * Processes evidence items with PENDING index_status and creates chunks + embeddings
 *
 * Embeddings:
 * - If OPENAI_API_KEY is set: Uses OpenAI for semantic embeddings (paid)
 * - If not set: Uses free hash-based embeddings (keyword similarity, no external service)
 *
 * Both methods work - semantic embeddings provide better meaning-based search,
 * while hash-based embeddings provide keyword-based matching at no cost.
 */
/**
 * Start the indexing worker (polls every 30 seconds)
 */
export declare function startIndexingWorker(): void;
/**
 * Stop the indexing worker
 */
export declare function stopIndexingWorker(): void;
