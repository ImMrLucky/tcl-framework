/**
 * Batch Ingestion Configuration
 * 
 * Centralized configuration for batch upload file types, limits, and parsing rules.
 * This is the source of truth for both backend validation and frontend UI display.
 */

export interface BatchIngestionConfig {
  /** Accepted file extensions (without leading dot) */
  accepted_extensions: string[];
  
  /** Maximum upload size in MB */
  max_upload_size_mb: number;
  
  /** Zip file parsing rules */
  zip_rules: ZipRules;
  
  /** CSV contract definitions */
  csv_contracts: CsvContract[];
  
  /** JSONL parsing configuration */
  jsonl_config: JsonlConfig;
}

export interface ZipRules {
  /** Transcript file extensions that can be paired with audio */
  transcript_extensions: string[];
  
  /** Audio file extensions */
  audio_extensions: string[];
  
  /** Metadata file extensions */
  metadata_extensions: string[];
  
  /** Whether to require transcript for audio files (if false, audio-only is allowed) */
  require_transcript_for_audio: boolean;
  
  /** Whether to allow transcript-only (no audio) */
  allow_transcript_only: boolean;
}

export interface CsvContract {
  /** Contract identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Contract type */
  type: 'turn_level' | 'conversation_level';
  
  /** Required columns */
  required_columns: string[];
  
  /** Optional columns */
  optional_columns?: string[];
  
  /** Column mapping (if column names differ from canonical) */
  column_mapping?: Record<string, string>;
}

export interface JsonlConfig {
  /** Whether to accept canonical schema directly */
  accept_canonical: boolean;
  
  /** Whether to accept minimal schema (text with speaker tags) */
  accept_minimal: boolean;
  
  /** Field names for minimal schema */
  minimal_schema_fields?: {
    text: string;
    speaker?: string;
    conversation_id?: string;
  };
}

/**
 * Default batch ingestion configuration
 */
export const DEFAULT_BATCH_CONFIG: BatchIngestionConfig = {
  accepted_extensions: [
    // Archives
    'zip',
    // Text formats
    'txt', 'json', 'jsonl', 'csv',
    // Subtitle formats
    'vtt', 'srt',
    // Audio formats
    'mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus',
  ],
  
  max_upload_size_mb: 500,
  
  zip_rules: {
    transcript_extensions: ['txt', 'json', 'jsonl', 'vtt', 'srt'],
    audio_extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'opus'],
    metadata_extensions: ['csv', 'json'],
    require_transcript_for_audio: false, // Allow audio-only if product supports it
    allow_transcript_only: true,
  },
  
  csv_contracts: [
    {
      id: 'turn_level',
      name: 'Turn-Level CSV',
      type: 'turn_level',
      required_columns: ['conversation_id', 'turn_index', 'text'],
      optional_columns: ['speaker', 'timestamp', 'channel'],
      column_mapping: {
        'turn_index': 'turn_index',
        'speaker': 'speaker',
        'text': 'text',
      },
    },
    {
      id: 'conversation_level',
      name: 'Conversation-Level CSV',
      type: 'conversation_level',
      required_columns: ['conversation_id', 'transcript_text'],
      optional_columns: ['channel', 'metadata'],
    },
  ],
  
  jsonl_config: {
    accept_canonical: true,
    accept_minimal: true,
    minimal_schema_fields: {
      text: 'text',
      speaker: 'speaker',
      conversation_id: 'conversation_id',
    },
  },
};

/**
 * Get batch ingestion configuration
 * Can be overridden by environment variables or database settings
 */
export function getBatchIngestionConfig(): BatchIngestionConfig {
  // TODO: Load from database or environment if needed
  return DEFAULT_BATCH_CONFIG;
}

/**
 * Check if a file extension is accepted
 */
export function isAcceptedExtension(extension: string, config?: BatchIngestionConfig): boolean {
  const cfg = config || getBatchIngestionConfig();
  const normalized = extension.toLowerCase().replace(/^\./, '');
  return cfg.accepted_extensions.includes(normalized);
}

/**
 * Check if file size is within limits
 */
export function isWithinSizeLimit(sizeBytes: number, config?: BatchIngestionConfig): boolean {
  const cfg = config || getBatchIngestionConfig();
  const maxBytes = cfg.max_upload_size_mb * 1024 * 1024;
  return sizeBytes <= maxBytes;
}

