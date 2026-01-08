/**
 * Transcript Normalization
 * Extracts text from various transcript formats into a single string
 */
export interface NormalizedTranscript {
    text: string;
    segments?: Array<{
        startMs: number;
        endMs: number;
        text: string;
        speaker?: string;
    }>;
    language?: string;
    metadata?: Record<string, any>;
}
/**
 * Normalize a transcript file to text
 * Supports: .txt, .csv, .json, .vtt, .srt
 */
export declare function normalizeTranscript(filePath: string | Buffer, filename: string): Promise<NormalizedTranscript>;
/**
 * Normalize transcript from buffer (for uploaded files)
 */
export declare function normalizeTranscriptBuffer(buffer: Buffer, filename: string): Promise<NormalizedTranscript>;
