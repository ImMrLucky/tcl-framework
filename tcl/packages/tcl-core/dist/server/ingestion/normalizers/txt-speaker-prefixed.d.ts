/**
 * TXT Speaker-Prefixed Normalizer
 *
 * Parses transcripts in the format:
 *   Agent: Thank you for calling...
 *   Customer: Hi, I have a question...
 *
 * Supports variations:
 *   - "Agent: text"
 *   - "AGENT: text"
 *   - "[Agent] text"
 *   - "Agent - text"
 */
import { Normalizer, NormalizerOptions, NormalizerResult } from "../types.js";
export declare class TxtSpeakerPrefixedNormalizer implements Normalizer {
    name: string;
    extensions: string[];
    canHandle(fileMeta: {
        filename: string;
        mimeType?: string;
    }, headBytes: Buffer): boolean;
    normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult>;
    private createTurn;
}
export declare const txtSpeakerPrefixedNormalizer: TxtSpeakerPrefixedNormalizer;
