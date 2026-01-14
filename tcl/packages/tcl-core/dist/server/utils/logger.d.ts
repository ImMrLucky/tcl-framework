/**
 * Structured logging utility with environment-based log levels
 *
 * Environment variables:
 * - LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' (default: 'info')
 * - TCL_DEBUG_UPLOADS: 'true' | 'false' (default: 'false')
 * - TCL_DEBUG_GRAPH: 'true' | 'false' (default: 'false')
 */
/**
 * Log upload-related messages (gated by TCL_DEBUG_UPLOADS or LOG_LEVEL=debug)
 */
export declare function logUpload(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void;
/**
 * Log graph-related messages (gated by TCL_DEBUG_GRAPH or LOG_LEVEL=debug)
 */
export declare function logGraph(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void;
/**
 * General structured logging (respects LOG_LEVEL)
 */
export declare function log(level: 'debug' | 'info' | 'warn' | 'error', category: string, message: string, data?: any): void;
/**
 * Always log errors (regardless of LOG_LEVEL)
 */
export declare function logError(category: string, message: string, error?: any): void;
