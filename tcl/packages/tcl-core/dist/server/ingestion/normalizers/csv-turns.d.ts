/**
 * CSV Turns Normalizer
 *
 * Parses CSV files with turn-based data.
 * Automatically detects column mappings for speaker, text, and time.
 *
 * Supported column variations:
 *   Speaker: speaker, agent, role, participant, author, from, sender
 *   Text: text, utterance, message, content, transcript, body
 *   Time: timestamp, time, start, start_ms, startTime, end_ms
 */
import { Normalizer, NormalizerOptions, NormalizerResult } from "../types.js";
export declare class CSVTurnsNormalizer implements Normalizer {
    name: string;
    extensions: string[];
    canHandle(fileMeta: {
        filename: string;
        mimeType?: string;
    }, headBytes: Buffer): boolean;
    normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult>;
    private getOrCreateParticipant;
    private createEmptyConversation;
}
export declare const csvTurnsNormalizer: CSVTurnsNormalizer;
