/**
 * Audio Transcription Service
 * Uses whisper.cpp + VAD preprocessing (Railway-friendly, no WASM dependencies)
 *
 * Does not store audio files - only extracts and returns text
 */
export interface TranscriptionResult {
    transcript: string;
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{
        startMs: number;
        endMs: number;
        text: string;
    }>;
    durationMs?: number;
    vadStats?: {
        originalDurationMs: number;
        speechDurationMs: number;
        removedMs: number;
        mode: 'silenceremove' | 'failed_fallback';
    };
}
/**
 * Transcribe audio file using whisper.cpp + VAD preprocessing
 * @param audioBuffer - Audio file buffer
 * @param filename - Original filename (for format detection)
 * @returns Transcription result
 */
export declare function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<TranscriptionResult>;
/**
 * Validate audio file format
 */
export declare function isValidAudioFormat(filename: string): boolean;
