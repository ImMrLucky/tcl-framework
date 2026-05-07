/**
 * Client for spaCy NLP service.
 *
 * Provides enhanced entity extraction with coreference resolution.
 * Falls back to regex-based extraction if service is unavailable.
 */
import type { Entity } from './entity-extractor.js';
export interface SpacyEntity {
    type: string;
    value: string;
    normalized: string;
    span: {
        start: number;
        end: number;
    };
    confidence: number;
    coreference_id?: string;
}
export interface SpacyExtractResponse {
    results: SpacyEntity[][];
    coreference_chains?: string[][];
}
export interface SpacyClientConfig {
    endpoint?: string;
    enabled?: boolean;
    timeout?: number;
    enableCoreference?: boolean;
}
/**
 * Configure the spaCy client.
 */
export declare function configureSpacyClient(newConfig: Partial<SpacyClientConfig>): void;
/**
 * Check if spaCy service is available.
 */
export declare function isSpacyAvailable(): Promise<boolean>;
/**
 * Extract entities using spaCy service.
 * Falls back to regex-based extraction if service unavailable.
 */
export declare function extractEntitiesWithSpacy(texts: string[], fallbackExtractor?: (text: string) => Entity[]): Promise<{
    entities: Entity[][];
    coreferenceChains?: string[][];
}>;
/**
 * Extract entities for a single text.
 */
export declare function extractEntitiesSingle(text: string, fallbackExtractor?: (text: string) => Entity[]): Promise<{
    entities: Entity[];
    coreferenceChains?: string[][];
}>;
/**
 * Batch extract entities (optimized endpoint).
 */
export declare function extractEntitiesBatch(texts: string[], fallbackExtractor?: (text: string) => Entity[]): Promise<{
    entities: Entity[][];
    coreferenceChains?: string[][];
    processingTimeMs?: number;
}>;
