/**
 * NLP Enhancement Module
 *
 * UNIVERSAL: Works across all domains (call center, loans, AI chat, etc.)
 * Domain-specific patterns are loaded via config at runtime.
 *
 * Provides NLP-based analysis for:
 * - Entity extraction and alignment
 * - Semantic similarity (synonym-aware, configurable)
 * - Contradiction detection (entity + polarity based)
 */
export * from './config.js';
export * from './entity-extractor.js';
export * from './semantic-similarity.js';
import { type Entity } from './entity-extractor.js';
/**
 * Universal statement analysis result
 * Works across all domains - UI layer maps to domain-specific terms
 */
export interface StatementAnalysis {
    id: string;
    text: string;
    entities: Entity[];
    normalizedTokens: string[];
    primarySubject: string | null;
    speaker?: string;
    /**
     * Statement type classification
     */
    statementType?: 'claim' | 'promise' | 'denial' | 'explanation' | 'question' | 'action' | 'unknown';
}
export type ClaimAnalysis = StatementAnalysis;
/**
 * Analyze a single statement (universal - works for any domain)
 */
export declare function analyzeStatement(statement: {
    id: string;
    text: string;
    speaker?: string;
}): StatementAnalysis;
export declare const analyzeClaim: typeof analyzeStatement;
/**
 * Check if two statements could form a support edge
 * (Same subject, same polarity)
 */
export declare function couldSupport(a: StatementAnalysis, b: StatementAnalysis): {
    couldSupport: boolean;
    score: number;
    reason: string;
};
/**
 * Check if two statements could form a contradiction edge
 */
export declare function couldContradict(a: StatementAnalysis, b: StatementAnalysis): {
    couldContradict: boolean;
    score: number;
    reason: string;
};
/**
 * Enhanced topic overlap using NLP analysis
 * (Replaces simple keyword Jaccard)
 */
export declare function enhancedTopicOverlap(textA: string, textB: string): {
    overlap: number;
    entityMatch: boolean;
    reason: string;
};
/**
 * Batch analyze statements for graph building
 * Universal - works for any domain
 */
export declare function analyzeStatementsForGraph(statements: Array<{
    id: string;
    text: string;
    meta?: {
        speaker?: string;
    };
}>): {
    analyses: Map<string, StatementAnalysis>;
    subjectGroups: Map<string, string[]>;
    potentialPairs: Array<{
        a: string;
        b: string;
        type: 'support' | 'contradiction';
        score: number;
    }>;
};
export declare const analyzeClaimsForGraph: typeof analyzeStatementsForGraph;
