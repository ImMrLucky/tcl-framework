/**
 * ZIP Archive Parser for Batch Ingestion
 *
 * Parses ZIP files containing transcripts, audio, and metadata.
 * Automatically pairs audio + transcript files by basename.
 */
import type { CanonicalTranscript } from '../canonical-transcript.js';
export interface ZipParseResult {
    transcripts: CanonicalTranscript[];
    attachments: Array<{
        name: string;
        path: string;
        type: 'audio' | 'metadata';
        data: Buffer;
    }>;
    errors: Array<{
        file: string;
        error: string;
    }>;
}
/**
 * Parse a ZIP file and extract transcripts, audio, and metadata
 */
export declare function parseZipBatch(zipBuffer: Buffer, zipFileName: string): Promise<ZipParseResult>;
