/**
 * Fact Extractor - Converts claims into normalized Facts using pattern-driven schemas.
 *
 * This is deterministic: same input always produces same output.
 * No ML/NLI calls.
 */
import type { TruthEngineConfig } from "../config/types.js";
import type { EnhancedClaim, Fact } from "./types.js";
/**
 * Parse raw transcript into enhanced claims with modality, polarity, entities.
 */
export declare function extractEnhancedClaims(transcript: string, config?: TruthEngineConfig): EnhancedClaim[];
/**
 * Extract normalized Facts from enhanced claims.
 */
export declare function extractFacts(claims: EnhancedClaim[], config?: TruthEngineConfig): Fact[];
