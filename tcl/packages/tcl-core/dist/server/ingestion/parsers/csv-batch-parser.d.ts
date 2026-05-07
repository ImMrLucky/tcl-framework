/**
 * CSV Batch Parser for Batch Ingestion
 *
 * Parses CSV files containing turn-level or conversation-level transcript data.
 * Supports multiple CSV contracts (turn-level recommended).
 */
import type { CanonicalTranscript } from '../canonical-transcript.js';
export interface CsvParseResult {
    transcripts: CanonicalTranscript[];
    errors: Array<{
        row: number;
        error: string;
    }>;
}
/**
 * Parse a CSV file using the configured contracts
 */
export declare function parseCsvBatch(fileBuffer: Buffer, fileName: string): CsvParseResult;
