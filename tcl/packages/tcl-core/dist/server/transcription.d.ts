/**
 * Audio Transcription Service
 * Uses local Whisper model (free, self-contained, no API keys needed)
 * Powered by @xenova/transformers (WASM mode - no native dependencies)
 *
 * Does not store audio files - only extracts and returns text
 */
export interface TranscriptionResult {
    transcript: string;
    language?: string;
    duration?: number;
}
/**
 * Transcribe audio file using local Whisper model (FREE, self-contained)
 * @param audioBuffer - Audio file buffer
 * @param filename - Original filename (for format detection)
 * @returns Transcription result
 */
export declare function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<TranscriptionResult>;
/**
 * Validate audio file format
 */
export declare function isValidAudioFormat(filename: string): boolean;
