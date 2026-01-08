/**
 * Concurrency Limiter for ASR Transcription
 * Prevents CPU meltdown by limiting concurrent transcription jobs
 */
export interface TranscriptionSlot {
    release: () => void;
}
/**
 * Execute a function with a transcription slot
 * Throws error with code 'ASR_BUSY' if all slots are occupied
 */
export declare function withTranscriptionSlot<T>(fn: () => Promise<T>): Promise<T>;
