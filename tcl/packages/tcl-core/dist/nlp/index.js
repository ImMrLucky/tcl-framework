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
import { extractEntities } from './entity-extractor.js';
import { computeSemanticSimilarity, areSameSubject, hasOpposingPolarity, checkContradiction, tokenizeAndNormalize } from './semantic-similarity.js';
import { getNLPConfig } from './config.js';
/**
 * Analyze a single statement (universal - works for any domain)
 */
export function analyzeStatement(statement) {
    const config = getNLPConfig();
    const entities = extractEntities(statement.text);
    const normalizedTokens = tokenizeAndNormalize(statement.text);
    // Determine primary subject from entities (first one found, already priority-sorted)
    let primarySubject = null;
    if (entities.length > 0) {
        primarySubject = `${entities[0].type}:${entities[0].normalized}`;
    }
    // Classify statement type
    const text = statement.text.toLowerCase();
    let statementType = 'unknown';
    if (config.statementClassification.question.some(q => text.includes(q))) {
        statementType = 'question';
    }
    else if (config.statementClassification.promise.some(p => text.includes(p))) {
        statementType = 'promise';
    }
    else if (config.statementClassification.denial.some(d => text.includes(d))) {
        statementType = 'denial';
    }
    else if (config.statementClassification.explanation.some(e => text.includes(e))) {
        statementType = 'explanation';
    }
    else {
        statementType = 'claim'; // Default to claim (assertion)
    }
    return {
        id: statement.id,
        text: statement.text,
        entities,
        normalizedTokens,
        primarySubject,
        speaker: statement.speaker,
        statementType
    };
}
// Backwards compatibility alias
export const analyzeClaim = analyzeStatement;
/**
 * Check if two statements could form a support edge
 * (Same subject, same polarity)
 */
export function couldSupport(a, b) {
    // Same subject required
    const subjectCheck = areSameSubject(a.text, b.text);
    if (!subjectCheck.sameSubject) {
        return { couldSupport: false, score: 0, reason: 'Different subjects' };
    }
    // Opposing polarity = contradiction, not support
    const polarityCheck = hasOpposingPolarity(a.text, b.text);
    if (polarityCheck.opposing) {
        return { couldSupport: false, score: 0, reason: 'Opposing polarity' };
    }
    // Same polarity + same subject = could support
    return {
        couldSupport: true,
        score: subjectCheck.confidence * (1 - polarityCheck.strength * 0.5),
        reason: `Same subject (${subjectCheck.subject || 'inferred'}), compatible polarity`
    };
}
/**
 * Check if two statements could form a contradiction edge
 */
export function couldContradict(a, b) {
    const result = checkContradiction(a.text, b.text);
    return {
        couldContradict: result.isContradiction,
        score: result.confidence,
        reason: result.reasons.join('; ')
    };
}
/**
 * Enhanced topic overlap using NLP analysis
 * (Replaces simple keyword Jaccard)
 */
export function enhancedTopicOverlap(textA, textB) {
    const similarity = computeSemanticSimilarity(textA, textB);
    return {
        overlap: similarity.score,
        entityMatch: similarity.entityMatch,
        reason: similarity.explanation
    };
}
/**
 * Batch analyze statements for graph building
 * Universal - works for any domain
 */
export function analyzeStatementsForGraph(statements) {
    const config = getNLPConfig();
    const analyses = new Map();
    const subjectGroups = new Map();
    // Analyze each statement
    for (const stmt of statements) {
        const analysis = analyzeStatement({
            id: stmt.id,
            text: stmt.text,
            speaker: stmt.meta?.speaker
        });
        analyses.set(stmt.id, analysis);
        // Group by primary subject
        if (analysis.primarySubject) {
            const group = subjectGroups.get(analysis.primarySubject) || [];
            group.push(stmt.id);
            subjectGroups.set(analysis.primarySubject, group);
        }
    }
    // Find potential pairs within same subject groups
    const potentialPairs = [];
    for (const [_subject, stmtIds] of subjectGroups) {
        // Only check pairs within same subject group (efficient!)
        for (let i = 0; i < stmtIds.length; i++) {
            for (let j = i + 1; j < stmtIds.length; j++) {
                const analysisA = analyses.get(stmtIds[i]);
                const analysisB = analyses.get(stmtIds[j]);
                // Check for contradiction
                const contraCheck = couldContradict(analysisA, analysisB);
                if (contraCheck.couldContradict && contraCheck.score >= config.thresholds.topicOverlap) {
                    potentialPairs.push({
                        a: stmtIds[i],
                        b: stmtIds[j],
                        type: 'contradiction',
                        score: contraCheck.score
                    });
                    continue; // Don't check for support if contradiction
                }
                // Check for support
                const supportCheck = couldSupport(analysisA, analysisB);
                if (supportCheck.couldSupport && supportCheck.score >= config.thresholds.topicOverlap) {
                    potentialPairs.push({
                        a: stmtIds[i],
                        b: stmtIds[j],
                        type: 'support',
                        score: supportCheck.score
                    });
                }
            }
        }
    }
    return { analyses, subjectGroups, potentialPairs };
}
// Backwards compatibility alias
export const analyzeClaimsForGraph = analyzeStatementsForGraph;
