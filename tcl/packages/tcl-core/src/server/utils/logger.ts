/**
 * Structured logging utility with environment-based log levels
 * 
 * Environment variables:
 * - LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' (default: 'info')
 * - TCL_DEBUG_UPLOADS: 'true' | 'false' (default: 'false')
 * - TCL_DEBUG_GRAPH: 'true' | 'false' (default: 'false')
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const getLogLevel = (): LogLevel => {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LOG_LEVELS[envLevel] !== undefined ? envLevel : 'info';
};

const shouldLog = (level: LogLevel): boolean => {
  const currentLevel = getLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
};

const shouldLogCategory = (category: 'uploads' | 'graph'): boolean => {
  if (category === 'uploads') {
    return process.env.TCL_DEBUG_UPLOADS === 'true' || shouldLog('debug');
  }
  if (category === 'graph') {
    return process.env.TCL_DEBUG_GRAPH === 'true' || shouldLog('debug');
  }
  return false;
};

/**
 * Sanitize sensitive content from log data
 */
function sanitizeData(data: any, maxLength: number = 200): any {
  if (!data || typeof data !== 'object') {
    if (typeof data === 'string' && data.length > maxLength) {
      return data.substring(0, maxLength) + '...';
    }
    return data;
  }
  
  const sanitized: any = {};
  for (const [key, value] of Object.entries(data)) {
    // Skip or truncate sensitive fields
    if (key.includes('transcript') || key.includes('text') || key.includes('quote') || key.includes('claimText')) {
      if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = value.substring(0, 100) + '...';
      } else {
        sanitized[key] = value;
      }
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Log upload-related messages (gated by TCL_DEBUG_UPLOADS or LOG_LEVEL=debug)
 */
export function logUpload(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
  if (level === 'error' || shouldLog(level) || shouldLogCategory('uploads')) {
    const prefix = `[Upload]`;
    if (data) {
      const sanitized = level === 'debug' ? data : sanitizeData(data);
      console[level](`${prefix} ${message}`, sanitized);
    } else {
      console[level](`${prefix} ${message}`);
    }
  }
}

/**
 * Log graph-related messages (gated by TCL_DEBUG_GRAPH or LOG_LEVEL=debug)
 */
export function logGraph(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
  if (level === 'error' || shouldLog(level) || shouldLogCategory('graph')) {
    const prefix = `[Graph]`;
    if (data) {
      const sanitized = level === 'debug' ? data : sanitizeData(data);
      console[level](`${prefix} ${message}`, sanitized);
    } else {
      console[level](`${prefix} ${message}`);
    }
  }
}

/**
 * General structured logging (respects LOG_LEVEL)
 */
export function log(level: 'debug' | 'info' | 'warn' | 'error', category: string, message: string, data?: any): void {
  if (shouldLog(level)) {
    const prefix = `[${category}]`;
    if (data) {
      const sanitized = level === 'debug' ? data : sanitizeData(data);
      console[level](`${prefix} ${message}`, sanitized);
    } else {
      console[level](`${prefix} ${message}`);
    }
  }
}

/**
 * Always log errors (regardless of LOG_LEVEL)
 */
export function logError(category: string, message: string, error?: any): void {
  const prefix = `[${category}]`;
  if (error) {
    console.error(`${prefix} ${message}`, error);
  } else {
    console.error(`${prefix} ${message}`);
  }
}

