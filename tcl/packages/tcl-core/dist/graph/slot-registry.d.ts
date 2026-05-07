/**
 * Slot Registry Loader
 *
 * Loads canonical slot definitions from JSON config files.
 * Provides global base slots + template-specific overlays.
 *
 * Supports both dev (src/config) and prod (dist/config) paths.
 */
import { SubjectSlot } from './types.js';
import { SlotLexiconEntry } from './template-config.js';
export interface SlotMeta {
    edgeEligibility: 'HARD' | 'SOFT' | 'NONE';
    family: string;
}
export interface GlobalSlotRegistry {
    version: string;
    globalLexicon: Record<string, SlotLexiconEntry>;
    slotMeta: Record<string, SlotMeta>;
    equivalences: string[][];
}
export interface TemplateSlotRegistry {
    version: string;
    templates: Record<string, {
        lexiconAdditions?: Record<string, SlotLexiconEntry>;
        slotMetaAdditions?: Record<string, SlotMeta>;
    }>;
}
/**
 * Get registry version
 */
export declare function getSlotRegistryVersion(): string;
/**
 * Get global slot lexicon (cached, with synonym index)
 */
export declare function getGlobalSlotLexicon(): Record<string, SlotLexiconEntry>;
/**
 * Get template-specific lexicon additions
 */
export declare function getTemplateSlotLexicon(templateId: string): Record<string, SlotLexiconEntry>;
/**
 * Get slot metadata (edge eligibility + family)
 */
export declare function getSlotMeta(slotType: string, entityKey: string): SlotMeta;
/**
 * Get slot metadata with template context
 */
export declare function getSlotMetaWithTemplate(slotType: string, entityKey: string, templateId?: string): SlotMeta;
/**
 * Check if slot is HARD eligible (can create contradictions)
 */
export declare function isHardSlot(slotType: string, entityKey: string, templateId?: string): boolean;
/**
 * Check if two slots are equivalent (via registry equivalences)
 */
export declare function areSlotsEquivalent(a: SubjectSlot, b: SubjectSlot): boolean;
/**
 * Look up lexicon entry by synonym (case-insensitive)
 */
export declare function lookupLexiconBySynonym(phrase: string): SlotLexiconEntry | null;
/**
 * Merge global + template lexicons
 */
export declare function getMergedLexicon(templateId?: string): Record<string, SlotLexiconEntry>;
