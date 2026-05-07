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
    /** Optional representative ID for batch ingestion */
    representativeId?: string | null;
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
export declare const DEFAULT_BATCH_CONFIG: BatchIngestionConfig;
/**
 * Get batch ingestion configuration
 * Can be overridden by environment variables or database settings
 */
export declare function getBatchIngestionConfig(): BatchIngestionConfig;
/**
 * Check if a file extension is accepted
 */
export declare function isAcceptedExtension(extension: string, config?: BatchIngestionConfig): boolean;
/**
 * Check if file size is within limits
 */
export declare function isWithinSizeLimit(sizeBytes: number, config?: BatchIngestionConfig): boolean;
