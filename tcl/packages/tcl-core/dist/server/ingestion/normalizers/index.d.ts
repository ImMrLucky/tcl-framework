/**
 * Normalizer Index
 *
 * Central registry for all format normalizers.
 * Provides automatic format detection and normalization.
 */
import { Normalizer, NormalizerOptions, NormalizerResult } from "../types.js";
import { txtSpeakerPrefixedNormalizer } from "./txt-speaker-prefixed.js";
import { csvTurnsNormalizer } from "./csv-turns.js";
import { jsonTurnsNormalizer } from "./json-turns.js";
import { vttSrtNormalizer } from "./vtt-srt.js";
/**
 * All registered normalizers, in priority order
 */
declare const NORMALIZERS: Normalizer[];
export interface FormatDetectionResult {
    normalizer: Normalizer | null;
    format: string;
    isAudio: boolean;
    confidence: number;
}
/**
 * Detect the format of a file and find the appropriate normalizer
 */
export declare function detectFormat(filename: string, mimeType: string | undefined, headBytes: Buffer): FormatDetectionResult;
/**
 * Normalize any supported file format to NormalizedConversation
 */
export declare function normalizeFile(content: Buffer | string, filename: string, options?: NormalizerOptions): Promise<NormalizerResult>;
export { txtSpeakerPrefixedNormalizer, csvTurnsNormalizer, jsonTurnsNormalizer, vttSrtNormalizer, NORMALIZERS, };
export * from "../types.js";
