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
 */
import { SubjectSlot, ExtractedEntity, ClaimModality } from './types.js';
export declare function extractEntities(text: string): ExtractedEntity[];
export declare function computeSubjectSlot(text: string, entities: ExtractedEntity[], modality?: ClaimModality): SubjectSlot;
export declare function slotsMatch(a: SubjectSlot, b: SubjectSlot): boolean;
export declare function slotsCompatible(a: SubjectSlot, b: SubjectSlot): boolean;
export declare function computeSlotSimilarity(a: SubjectSlot, b: SubjectSlot): number;
export declare function valuesContradict(a: SubjectSlot, b: SubjectSlot): boolean;
