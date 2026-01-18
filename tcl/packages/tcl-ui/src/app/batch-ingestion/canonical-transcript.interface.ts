/**
 * Canonical Batch Ingestion Contract (Frontend)
 * 
 * TypeScript interfaces matching the backend canonical transcript schema.
 * Used for type safety when working with batch import results.
 */

export interface CanonicalTranscript {
  /** Unique identifier for this conversation (optional, will be generated if missing) */
  conversation_id?: string;
  
  /** Array of conversation turns (required) */
  turns: CanonicalTurn[];
  
  /** Source information about where this transcript came from */
  source: TranscriptSource;
  
  /** Free-form metadata (template, channel, etc.) */
  metadata?: Record<string, any>;
}

export interface CanonicalTurn {
  /** Turn index (0-based, required) */
  t: number;
  
  /** Raw speaker label from source (nullable - may be missing) */
  speaker_raw: string | null;
  
  /** Turn text content (required) */
  text: string;
  
  /** Optional timestamp (seconds from start) */
  timestamp?: number;
}

export interface TranscriptSource {
  /** Provider/dataset identifier (e.g., "upload", "s3", "jsonl") */
  provider: string;
  
  /** Original file name or object key */
  file_name: string;
  
  /** Optional: path within archive (for zip files) */
  path_in_archive?: string;
  
  /** Optional: line number (for jsonl files) */
  line_number?: number;
  
  /** Optional: additional source metadata */
  metadata?: Record<string, any>;
}

