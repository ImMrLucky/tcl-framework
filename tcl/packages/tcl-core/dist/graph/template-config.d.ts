/**
 * ProtectQA Template Configuration
 *
 * All thresholds, budgets, and weights are config-driven.
 * No hard-coded constants in code paths.
 *
 * Templates are domain-specific (telco, loans, ai_chat, generic)
 * but the graph construction logic is universal.
 */
import { CandidateBudgets } from './types.js';
export interface SlotLexiconEntry {
    slotType: string;
    entityKey: string;
    synonyms: string[];
}
export interface TemplateConfig {
    /** Template identifier: generic, telco, loans, ai_chat */
    templateId: string;
    /** Entity packs to load (e.g., ["money", "dates", "telco_plans"]) */
    entityPacks: string[];
    /** Slot lexicon mapping synonyms to canonical slots */
    slotLexicon: Record<string, SlotLexiconEntry>;
    /** Candidate generation budgets */
    budgets: CandidateBudgets;
    /** Edge creation thresholds (0..1) */
    thresholds: {
        support: number;
        contradiction: number;
        grounding: number;
        slotMatch: number;
        semanticSimilarity: number;
        semanticHighForFallback?: number;
    };
    /** Weight factors for retrieval and calibration */
    weights: {
        retrieval: {
            slotMatch: number;
            entityOverlap: number;
            semanticSimilarity: number;
            temporalProximity: number;
            speakerRole: number;
        };
        calibration: {
            nliScore: number;
            entityMatch: number;
            polarityMatch: number;
            modalityWeight: number;
        };
        evidenceStrength: {
            policy: number;
            system_fact: number;
            document: number;
            kb: number;
            tool_log: number;
            transcript: number;
        };
    };
    /** Gating rules */
    gating: {
        allowCrossTopicSupportOnlyOnStrictSlotMatch: boolean;
        contradictionRequiresSameTopic: boolean;
        contradictionRequiresSameSlot: boolean;
        contradictionRequiresOpposingPolarity: boolean;
    };
    /** Topic segmentation settings */
    topicSegmentation: {
        /** Primary method: slot, semantic, window, hybrid */
        method: 'slot' | 'semantic' | 'window' | 'hybrid';
        /** Turn window for temporal clustering */
        turnWindow: number;
        /** Minimum claims per topic */
        minClaimsPerTopic: number;
    };
    /** Truth state derivation settings */
    truthDerivation: {
        /** Whether claim-to-claim support can contribute to SUPPORTED state */
        allowClaimToClaimSupport: boolean;
        /** Minimum support edge weight for SUPPORTED */
        minSupportWeight: number;
        /** Minimum contradiction edge weight for CONTRADICTED */
        minContradictionWeight: number;
    };
}
export declare const DEFAULT_TEMPLATE_CONFIG: TemplateConfig;
export declare const TELCO_TEMPLATE_CONFIG: TemplateConfig;
export declare const LOANS_TEMPLATE_CONFIG: TemplateConfig;
export declare const AI_CHAT_TEMPLATE_CONFIG: TemplateConfig;
export declare function getTemplateConfig(): TemplateConfig;
export declare function setTemplateConfig(templateIdOrConfig: string | TemplateConfig): void;
export declare function registerTemplate(config: TemplateConfig): void;
export declare function getAvailableTemplates(): string[];
export declare function mergeTemplateConfig(overrides: Partial<TemplateConfig>): TemplateConfig;
