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
 */
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
 * Extract entities from text using configurable patterns
 *
 * Uses patterns from NLPConfig - apps can add domain-specific patterns.
 */
export declare function extractEntities(text: string): Entity[];
/**
 * Extract the primary subject (entity) of a claim
 */
export declare function extractPrimarySubject(text: string): string | null;
/**
 * Check if two claims share the same primary entity
 */
export declare function sharesPrimaryEntity(textA: string, textB: string): {
    shares: boolean;
    entity?: string;
};
