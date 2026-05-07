/**
 * Entity Extractor - Extract structured entities from text
 *
 * UNIVERSAL: Works across all domains (call center, loans, AI chat, etc.)
 * Domain-specific patterns are loaded via config, not hardcoded.
 *
 * Entities are critical for:
 * 1. Grouping statements by subject (only compare statements about SAME entity)
 * 2. Contradiction detection (conflicting values for same entity)
 * 3. Fact normalization (structured representation)
 *
 * Now supports spaCy-enhanced extraction when available (falls back to regex).
 */
import { type SpacyClientConfig } from './spacy-client.js';
export interface Entity {
    type: string;
    value: string;
    normalized: string | number;
    span: {
        start: number;
        end: number;
    };
    confidence: number;
}
export type EntityType = string;
/**
 * Configure entity extraction (including spaCy).
 */
export declare function configureEntityExtraction(config: {
    useSpacy?: boolean;
    spacyConfig?: SpacyClientConfig;
}): void;
/**
 * Extract entities from text using regex patterns (synchronous).
 *
 * This is the default method for backwards compatibility.
 * For enhanced extraction with spaCy, use extractEntitiesAsync().
 */
export declare function extractEntities(text: string): Entity[];
/**
 * Extract entities using spaCy if available, otherwise falls back to regex (async).
 *
 * This provides enhanced entity extraction with:
 * - Better NER accuracy
 * - Coreference resolution ("it" → "the fee")
 * - Domain-specific patterns
 *
 * Falls back to regex extraction if spaCy service is unavailable.
 */
export declare function extractEntitiesAsync(text: string): Promise<Entity[]>;
/**
 * Extract the primary subject (entity) of a claim (synchronous).
 */
export declare function extractPrimarySubject(text: string): string | null;
/**
 * Extract the primary subject (entity) of a claim using spaCy (async).
 */
export declare function extractPrimarySubjectAsync(text: string): Promise<string | null>;
/**
 * Check if two claims share the same primary entity (synchronous).
 */
export declare function sharesPrimaryEntity(textA: string, textB: string): {
    shares: boolean;
    entity?: string;
};
/**
 * Check if two claims share the same primary entity using spaCy (async).
 */
export declare function sharesPrimaryEntityAsync(textA: string, textB: string): Promise<{
    shares: boolean;
    entity?: string;
}>;
