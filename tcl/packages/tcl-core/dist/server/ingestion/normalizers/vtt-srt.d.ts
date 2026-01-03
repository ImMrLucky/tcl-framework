/**
 * VTT/SRT Normalizer
 *
 * Parses WebVTT (.vtt) and SubRip (.srt) subtitle formats.
 * These are commonly exported from contact center recording systems.
 *
 * Format examples:
 *
 * SRT:
 *   1
 *   00:00:01,000 --> 00:00:04,000
 *   Thank you for calling support.
 *
 * VTT:
 *   WEBVTT
 *
 *   00:00:01.000 --> 00:00:04.000
 *   Thank you for calling support.
 */
import { Normalizer, NormalizerOptions, NormalizerResult } from "../types.js";
export declare class VTTSRTNormalizer implements Normalizer {
    name: string;
    extensions: string[];
    canHandle(fileMeta: {
        filename: string;
        mimeType?: string;
    }, headBytes: Buffer): boolean;
    normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult>;
    private parseCues;
    private mergeConsecutiveTurns;
    private getOrCreateParticipant;
    private createEmptyConversation;
}
export declare const vttSrtNormalizer: VTTSRTNormalizer;
