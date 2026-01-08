/**
 * Whisper.cpp ASR Runner
 * Executes whisper.cpp binary and parses output
 */
export interface WhisperSegment {
    startMs: number;
    endMs: number;
    text: string;
}
export interface WhisperResult {
    text: string;
    language: string | null;
    segments?: WhisperSegment[];
}
/**
 * Run whisper.cpp on an audio file
 */
export declare function runWhisperCpp(audioPath: string): Promise<WhisperResult>;
