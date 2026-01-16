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
 * 
 * Now supports spaCy-enhanced extraction when available (falls back to regex).
 */

import { getNLPConfig, type EntityPattern } from './config.js';
import { extractEntitiesSingle, configureSpacyClient, type SpacyClientConfig } from './spacy-client.js';

export interface Entity {
  type: string;           // Dynamic - from config
  value: string;          // Original matched text
  normalized: string | number;  // Normalized value for comparison
  span: { start: number; end: number };
  confidence: number;
}

// Legacy type for backwards compatibility - apps can define their own
export type EntityType = string;

// Global flag to enable/disable spaCy
let useSpacy = process.env.ENABLE_SPACY !== 'false';

/**
 * Configure entity extraction (including spaCy).
 */
export function configureEntityExtraction(config: { useSpacy?: boolean; spacyConfig?: SpacyClientConfig }): void {
  if (config.useSpacy !== undefined) {
    useSpacy = config.useSpacy;
  }
  if (config.spacyConfig) {
    configureSpacyClient(config.spacyConfig);
  }
}

/**
 * Extract entities from text using regex patterns (synchronous).
 * 
 * This is the default method for backwards compatibility.
 * For enhanced extraction with spaCy, use extractEntitiesAsync().
 */
export function extractEntities(text: string): Entity[] {
  return extractEntitiesRegex(text);
}

/**
 * Extract entities using spaCy if available, otherwise falls back to regex (async).
 * 
 * This provides enhanced entity extraction with:
 * - Better NER accuracy
 * - Coreference resolution ("it" → "the fee")
 * - Domain-specific patterns
 * 
 * Falls back to regex extraction if spaCy service is unavailable.
 */
export async function extractEntitiesAsync(text: string): Promise<Entity[]> {
  if (useSpacy) {
    try {
      const result = await extractEntitiesSingle(text, extractEntitiesRegex);
      return result.entities;
    } catch (error) {
      // Fall back to regex if spaCy fails
      console.warn('spaCy extraction failed, using regex fallback:', error);
      return extractEntitiesRegex(text);
    }
  }
  
  // If spaCy is disabled, use regex
  return extractEntitiesRegex(text);
}


/**
 * Extract entities from text using regex patterns (synchronous fallback).
 * 
 * Uses patterns from NLPConfig - apps can add domain-specific patterns.
 */
function extractEntitiesRegex(text: string): Entity[] {
  const config = getNLPConfig();
  const entities: Entity[] = [];
  
  // Sort patterns by priority (higher first)
  const sortedPatterns = [...config.entities].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  
  for (const entityConfig of sortedPatterns) {
    for (const pattern of entityConfig.patterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      
      let match;
      while ((match = pattern.exec(text)) !== null) {
        // Normalize the value
        let normalized: string | number;
        if (entityConfig.normalizer) {
          try {
            normalized = entityConfig.normalizer(match);
          } catch {
            normalized = match[0].toLowerCase().replace(/\s+/g, '_');
          }
        } else {
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
 * Extract the primary subject (entity) of a claim (synchronous).
 */
export function extractPrimarySubject(text: string): string | null {
  const entities = extractEntities(text);
  return getPrimarySubjectFromEntities(entities);
}

/**
 * Extract the primary subject (entity) of a claim using spaCy (async).
 */
export async function extractPrimarySubjectAsync(text: string): Promise<string | null> {
  const entities = await extractEntitiesAsync(text);
  return getPrimarySubjectFromEntities(entities);
}

function getPrimarySubjectFromEntities(entities: Entity[]): string | null {
  
  // Priority: FEE > MONEY > PLAN > POLICY > ACTION > DATE
  const priority: EntityType[] = ['FEE', 'MONEY', 'PLAN', 'POLICY', 'ACTION', 'DATE'];
  
  for (const type of priority) {
    const entity = entities.find(e => e.type === type);
    if (entity) {
      return `${entity.type}:${entity.normalized}`;
    }
  }
  
  return null;
}

/**
 * Check if two claims share the same primary entity (synchronous).
 */
export function sharesPrimaryEntity(textA: string, textB: string): { shares: boolean; entity?: string } {
  const entitiesA = extractEntities(textA);
  const entitiesB = extractEntities(textB);
  return checkEntityOverlap(entitiesA, entitiesB);
}

/**
 * Check if two claims share the same primary entity using spaCy (async).
 */
export async function sharesPrimaryEntityAsync(textA: string, textB: string): Promise<{ shares: boolean; entity?: string }> {
  const entitiesA = await extractEntitiesAsync(textA);
  const entitiesB = await extractEntitiesAsync(textB);
  return checkEntityOverlap(entitiesA, entitiesB);
}

function checkEntityOverlap(entitiesA: Entity[], entitiesB: Entity[]): { shares: boolean; entity?: string } {
  
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

function deduplicateEntities(entities: Entity[]): Entity[] {
  // Sort by span start, then by confidence (descending)
  entities.sort((a, b) => {
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    return b.confidence - a.confidence;
  });
  
  const result: Entity[] = [];
  let lastEnd = -1;
  
  for (const entity of entities) {
    // Skip if overlaps with previous (which has higher or equal confidence)
    if (entity.span.start < lastEnd) continue;
    
    result.push(entity);
    lastEnd = entity.span.end;
  }
  
  return result;
}

