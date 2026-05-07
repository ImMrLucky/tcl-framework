/**
 * Batch Ingestion Configuration
 *
 * Centralized configuration for batch upload file types, limits, and parsing rules.
 * This is the source of truth for both backend validation and frontend UI display.
 */
/**
 * Default batch ingestion configuration
 */
export const DEFAULT_BATCH_CONFIG = {
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
export function getBatchIngestionConfig() {
    // TODO: Load from database or environment if needed
    return DEFAULT_BATCH_CONFIG;
}
/**
 * Check if a file extension is accepted
 */
export function isAcceptedExtension(extension, config) {
    const cfg = config || getBatchIngestionConfig();
    const normalized = extension.toLowerCase().replace(/^\./, '');
    return cfg.accepted_extensions.includes(normalized);
}
/**
 * Check if file size is within limits
 */
export function isWithinSizeLimit(sizeBytes, config) {
    const cfg = config || getBatchIngestionConfig();
    const maxBytes = cfg.max_upload_size_mb * 1024 * 1024;
    return sizeBytes <= maxBytes;
}
