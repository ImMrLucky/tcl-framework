/**
 * Subject Slot Computation
 *
 * This is THE KEY UPGRADE for preventing nonsense contradictions.
 *
 * Only claims that share the same subject slot can contradict each other.
 *
 * Flow:
 * 1. Extract entities from claim text
 * 2. Match entities to slot lexicon
 * 3. Derive slotType and entityKey
 * 4. Normalize values if present
 *
 * Now supports spaCy-enhanced extraction for better entity quality.
 */
import { SubjectSlot, ExtractedEntity, ClaimModality, ClaimAnchor } from './types.js';
/**
 * Extract entities using regex patterns (synchronous, backwards compatible).
 */
export declare function extractEntities(text: string): ExtractedEntity[];
/**
 * Extract entities using spaCy if available, otherwise falls back to regex (async).
 *
 * This provides enhanced entity extraction with:
 * - Better NER accuracy
 * - Coreference resolution ("it" → "the fee")
 * - Domain-specific patterns
 *
 * Converts spaCy Entity format to ExtractedEntity format.
 */
export declare function extractEntitiesAsync(text: string): Promise<ExtractedEntity[]>;
export declare function computeSubjectSlot(text: string, entities: ExtractedEntity[], modality?: ClaimModality): SubjectSlot;
/**
 * 2.1: Check if a slot is meaningful (not unknown/general)
 */
export declare function isMeaningfulSlot(slot?: SubjectSlot): boolean;
/**
 * 2.1: Updated slotsMatch to prevent unknown/unknown contradictions
 * Do NOT allow unknown/general to match
 */
export declare function slotsMatch(a?: SubjectSlot, b?: SubjectSlot): boolean;
export declare function slotsCompatible(a: SubjectSlot, b: SubjectSlot): boolean;
export declare function computeSlotSimilarity(a: SubjectSlot, b: SubjectSlot): number;
export declare function valuesContradict(a: SubjectSlot, b: SubjectSlot): boolean;
/**
 * Check for explicit contradiction patterns: increase/decrease, waived/not waived, no fee/fee
 */
export declare function hasExplicitContradictionPattern(a: SubjectSlot, b: SubjectSlot): boolean;
/**
 * 3.1: Compute anchor overlap between two claim anchor sets
 */
export declare function anchorOverlap(a?: ClaimAnchor[], b?: ClaimAnchor[]): number;
/**
 * 3.1: Check if two claims have strong anchor matches
 * Strong if share MONEY or DATE/TIMEFRAME or ADDRESS/EMAIL/PHONE/CARD/SSN_LAST4
 */
export declare function hasStrongAnchorMatch(aAnchors?: ClaimAnchor[], bAnchors?: ClaimAnchor[]): boolean;
/**
 * 1.2: Extract anchors from entities (generic, industry-agnostic)
 * Converts extracted entities into normalized anchor keys
 */
export declare function extractAnchors(entities: ExtractedEntity[], text: string): ClaimAnchor[];
/**
 * Helper function for customer denial vs assertion pattern
 */
export declare function hasCustomerDenialVsAssertion(claimA: any, claimB: any): boolean;
