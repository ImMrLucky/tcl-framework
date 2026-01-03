/**
 * JSON Turns Normalizer
 *
 * Parses JSON files with turn-based or message-based data.
 * Supports various common formats:
 *   - { turns: [...] }
 *   - { messages: [...] }
 *   - { transcript: { segments: [...] } }
 *   - Amazon Connect format
 *   - Array of turn objects
 */
import { Normalizer, NormalizerOptions, NormalizerResult } from "../types.js";
export declare class JSONTurnsNormalizer implements Normalizer {
    name: string;
    extensions: string[];
    canHandle(fileMeta: {
        filename: string;
        mimeType?: string;
    }, headBytes: Buffer): boolean;
    normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult>;
    private extractTurns;
    private extractConversationMeta;
    private detectChannel;
    private getOrCreateParticipant;
    private createEmptyConversation;
}
export declare const jsonTurnsNormalizer: JSONTurnsNormalizer;
