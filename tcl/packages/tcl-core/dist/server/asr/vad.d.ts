/**
 * Voice Activity Detection (VAD) Preprocessing
 * Uses ffmpeg to remove silence and normalize audio for ASR
 */
export interface VadStats {
    originalDurationMs: number;
    speechDurationMs: number;
    removedMs: number;
    mode: 'silenceremove' | 'failed_fallback';
}
export interface VadResult {
    vadWavPath: string;
    vadStats: VadStats;
}
/**
 * Normalize audio to mono 16kHz WAV format
 */
export declare function prepareWavForAsr(inputPath: string): Promise<{
    wavPath: string;
    durationMs: number;
}>;
/**
 * Apply VAD (Voice Activity Detection) to remove silence
 */
export declare function applyVad(wavPath: string): Promise<VadResult>;
