/**
 * JSONL (Newline-Delimited JSON) Parser for Batch Ingestion
 *
 * Parses JSONL files where each line is a JSON object representing a transcript.
 * Supports both canonical schema and minimal schema.
 */
import type { CanonicalTranscript } from '../canonical-transcript.js';
export interface JsonlParseResult {
    transcripts: CanonicalTranscript[];
    errors: Array<{
        line: number;
        error: string;
    }>;
}
/**
 * Parse a JSONL file
 */
export declare function parseJsonlBatch(fileBuffer: Buffer, fileName: string): JsonlParseResult;
