/**
 * Entity Extraction Patterns
 *
 * Rule-based entity extraction for call transcripts.
 * This is a "quick win" improvement that doesn't require spaCy.
 *
 * Future: Replace with spaCy NER for better accuracy.
 */
export type EntityType = 'FEE' | 'AMOUNT' | 'DATE' | 'PLAN' | 'PRODUCT' | 'ACTION' | 'DOCUMENT' | 'PERSON';
export interface ExtractedEntity {
    type: EntityType;
    raw: string;
    normalized: string;
    value?: number;
    startIdx?: number;
    endIdx?: number;
}
/**
 * Extract all entities from text
 */
export declare function extractEntities(text: string): ExtractedEntity[];
/**
 * Find shared entities between two texts
 */
export declare function findSharedEntities(textA: string, textB: string): ExtractedEntity[];
/**
 * Calculate entity-based similarity between two texts
 * Returns 0-1 score based on shared entities
 */
export declare function entitySimilarity(textA: string, textB: string): number;
/**
 * Detect amount conflicts between two texts about the same entity
 */
export interface AmountConflict {
    entity: string;
    amountA: number;
    amountB: number;
    difference: number;
    percentDiff: number;
}
export declare function detectAmountConflicts(textA: string, textB: string): AmountConflict[];
/**
 * Detect polarity conflicts (one affirms, one denies same thing)
 */
export interface PolarityConflict {
    sharedEntity: string;
    polarityA: 'affirm' | 'deny';
    polarityB: 'affirm' | 'deny';
}
export declare function detectPolarity(text: string): 'affirm' | 'deny' | 'neutral';
export declare function detectPolarityConflicts(textA: string, textB: string): PolarityConflict[];
