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
import { getNLPConfig } from './config.js';
/**
 * Extract entities from text using configurable patterns
 *
 * Uses patterns from NLPConfig - apps can add domain-specific patterns.
 */
export function extractEntities(text) {
    const config = getNLPConfig();
    const entities = [];
    // Sort patterns by priority (higher first)
    const sortedPatterns = [...config.entities].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const entityConfig of sortedPatterns) {
        for (const pattern of entityConfig.patterns) {
            // Reset lastIndex for global patterns
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                // Normalize the value
                let normalized;
                if (entityConfig.normalizer) {
                    try {
                        normalized = entityConfig.normalizer(match);
                    }
                    catch {
                        normalized = match[0].toLowerCase().replace(/\s+/g, '_');
                    }
                }
                else {
                    normalized = match[0].toLowerCase().replace(/\s+/g, '_');
                }
                entities.push({
                    type: entityConfig.type,
                    value: match[0],
                    normalized,
                    span: { start: match.index, end: match.index + match[0].length },
                    confidence: 0.85
                });
            }
        }
    }
    // De-duplicate overlapping entities (keep higher priority/confidence)
    return deduplicateEntities(entities);
}
/**
 * Extract the primary subject (entity) of a claim
 */
export function extractPrimarySubject(text) {
    const entities = extractEntities(text);
    // Priority: FEE > MONEY > PLAN > POLICY > ACTION > DATE
    const priority = ['FEE', 'MONEY', 'PLAN', 'POLICY', 'ACTION', 'DATE'];
    for (const type of priority) {
        const entity = entities.find(e => e.type === type);
        if (entity) {
            return `${entity.type}:${entity.normalized}`;
        }
    }
    return null;
}
/**
 * Check if two claims share the same primary entity
 */
export function sharesPrimaryEntity(textA, textB) {
    const entitiesA = extractEntities(textA);
    const entitiesB = extractEntities(textB);
    // Check for exact normalized value matches
    for (const eA of entitiesA) {
        for (const eB of entitiesB) {
            if (eA.type === eB.type && eA.normalized === eB.normalized) {
                return { shares: true, entity: `${eA.type}:${eA.normalized}` };
            }
        }
    }
    // Check for same entity type (weaker match)
    const typesA = new Set(entitiesA.map(e => e.type));
    const typesB = new Set(entitiesB.map(e => e.type));
    for (const type of typesA) {
        if (typesB.has(type)) {
            // Same entity type but different values could be a contradiction
            const valueA = entitiesA.find(e => e.type === type)?.normalized;
            const valueB = entitiesB.find(e => e.type === type)?.normalized;
            if (valueA !== valueB) {
                return { shares: true, entity: `${type}:conflict` };
            }
        }
    }
    return { shares: false };
}
// ============================================================================
// Helper functions
// ============================================================================
function deduplicateEntities(entities) {
    // Sort by span start, then by confidence (descending)
    entities.sort((a, b) => {
        if (a.span.start !== b.span.start)
            return a.span.start - b.span.start;
        return b.confidence - a.confidence;
    });
    const result = [];
    let lastEnd = -1;
    for (const entity of entities) {
        // Skip if overlaps with previous (which has higher or equal confidence)
        if (entity.span.start < lastEnd)
            continue;
        result.push(entity);
        lastEnd = entity.span.end;
    }
    return result;
}
