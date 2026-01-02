/**
 * Fact Extractor - Converts claims into normalized Facts using pattern-driven schemas.
 * 
 * This is deterministic: same input always produces same output.
 * No ML/NLI calls.
 */

import { createHash } from "crypto";
import type { TruthEngineConfig, SubjectSchema } from "../config/types.js";
import type { EnhancedClaim, Fact, Modality, Polarity, Speaker } from "./types.js";
import { DEFAULT_CONFIG } from "../config/types.js";

/**
 * Parse raw transcript into enhanced claims with modality, polarity, entities.
 */
export function extractEnhancedClaims(
  transcript: string,
  config: TruthEngineConfig = DEFAULT_CONFIG
): EnhancedClaim[] {
  const lines = transcript.split('\n').filter(line => line.trim().length > 0);
  const claims: EnhancedClaim[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Parse speaker: "Agent: text" or "Customer: text"
    const speakerMatch = line.match(/^(Agent|Customer|System):\s*(.+)/i);
    if (!speakerMatch) continue;
    
    const speaker = speakerMatch[1].toLowerCase() as Speaker;
    const text = speakerMatch[2].trim();
    
    if (text.length < 3) continue;
    
    // Detect modality
    const modality = detectModality(text, config.modalityLexicon);
    
    // Detect polarity
    const polarity = detectPolarity(text, config.modalityLexicon);
    
    // Extract topics from subject schemas
    const topics = extractTopics(text, config.subjectSchemas);
    
    // Extract entities (simple pattern-based)
    const entities = extractEntities(text);
    
    // Extract numbers
    const numbers = extractNumbers(text);
    
    // Flags
    const hasNegation = config.modalityLexicon.denialWords.some(word => 
      new RegExp(`\\b${word}\\b`, 'i').test(text)
    );
    const hasAbsoluteLanguage = config.modalityLexicon.absoluteWords.some(word =>
      new RegExp(`\\b${word}\\b`, 'i').test(text)
    );
    const hasConditionalLanguage = config.modalityLexicon.conditionalWords.some(word =>
      new RegExp(`\\b${word}\\b`, 'i').test(text)
    );
    
    claims.push({
      id: generateClaimId(i, text),
      speaker,
      text,
      turnIndex: i,
      modality,
      polarity,
      topics,
      entities,
      numbers,
      hasNegation,
      hasAbsoluteLanguage,
      hasConditionalLanguage,
    });
  }
  
  return claims;
}

/**
 * Extract normalized Facts from enhanced claims.
 */
export function extractFacts(
  claims: EnhancedClaim[],
  config: TruthEngineConfig = DEFAULT_CONFIG
): Fact[] {
  const facts: Fact[] = [];
  
  for (const claim of claims) {
    // Skip questions and requests - they don't assert facts
    if (claim.modality === 'question' || claim.modality === 'request') {
      continue;
    }
    
    // Try to match each subject schema
    for (const schema of config.subjectSchemas) {
      const match = matchesSchema(claim.text, schema);
      if (!match) continue;
      
      // Determine predicate and value
      const { predicate, value } = inferPredicateAndValue(claim, schema);
      
      // Determine polarity specific to this subject
      let factPolarity = claim.polarity;
      for (const [trigger, pol] of Object.entries(schema.polarityMapping)) {
        if (claim.text.toLowerCase().includes(trigger)) {
          factPolarity = pol;
          break;
        }
      }
      
      // Extract conditions
      const conditions = extractConditions(claim.text);
      
      // Extract timeframe cues
      const timeframe = extractTimeframe(claim.text);
      
      facts.push({
        id: generateFactId(claim.id, schema.id, predicate),
        claimId: claim.id,
        turnIndex: claim.turnIndex,
        speaker: claim.speaker,
        subject: schema.id,
        predicate,
        value: factPolarity === 'deny' ? false : (factPolarity === 'affirm' ? true : value),
        conditions,
        timeframe: timeframe || undefined,
        certainty: "stated",
      });
    }
  }
  
  return facts;
}

// ============================================================================
// Helper functions
// ============================================================================

function detectModality(text: string, lexicon: TruthEngineConfig['modalityLexicon']): Modality {
  const lower = text.toLowerCase();
  
  // Check patterns first
  for (const pattern of lexicon.questionPatterns) {
    if (new RegExp(pattern, 'i').test(text)) {
      return 'question';
    }
  }
  
  for (const pattern of lexicon.requestPatterns) {
    if (new RegExp(pattern, 'i').test(lower)) {
      return 'request';
    }
  }
  
  // Check lexicon words
  for (const word of lexicon.apologyWords) {
    if (lower.includes(word)) {
      return 'apology';
    }
  }
  
  // Check for absolute language
  const hasAbsolute = lexicon.absoluteWords.some(word => 
    new RegExp(`\\b${word}\\b`, 'i').test(lower)
  );
  if (hasAbsolute) {
    return 'absolute';
  }
  
  // Check for conditional language
  const hasConditional = lexicon.conditionalWords.some(word =>
    new RegExp(`\\b${word}\\b`, 'i').test(lower)
  );
  if (hasConditional) {
    return 'conditional';
  }
  
  return 'informational';
}

function detectPolarity(text: string, lexicon: TruthEngineConfig['modalityLexicon']): Polarity {
  const lower = text.toLowerCase();
  
  // Count denial and affirm indicators
  let denyScore = 0;
  let affirmScore = 0;
  
  for (const word of lexicon.denialWords) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
      denyScore++;
    }
  }
  
  for (const word of lexicon.affirmWords) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
      affirmScore++;
    }
  }
  
  // Double negation = affirm
  const doubleNegation = /(not|n't)\s+(no|never|without)/i.test(lower);
  if (doubleNegation) {
    affirmScore += 2;
    denyScore -= 1;
  }
  
  if (denyScore > affirmScore) return 'deny';
  if (affirmScore > denyScore) return 'affirm';
  return 'unknown';
}

function extractTopics(text: string, schemas: SubjectSchema[]): string[] {
  const topics: string[] = [];
  
  for (const schema of schemas) {
    if (matchesSchema(text, schema)) {
      topics.push(schema.id);
    }
  }
  
  return topics;
}

function matchesSchema(text: string, schema: SubjectSchema): boolean {
  const lower = text.toLowerCase();
  
  // Check keywords
  for (const keyword of schema.keywords) {
    if (lower.includes(keyword.toLowerCase())) {
      return true;
    }
  }
  
  // Check patterns
  for (const pattern of schema.patterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  return false;
}

function inferPredicateAndValue(claim: EnhancedClaim, schema: SubjectSchema): { predicate: string; value: string | number | boolean | null } {
  const lower = claim.text.toLowerCase();
  
  // Try to match specific predicates
  if (lower.includes('started') || lower.includes('began') || lower.includes('effective')) {
    return { predicate: 'started', value: true };
  }
  
  if (lower.includes('amount') || claim.numbers.length > 0) {
    const num = claim.numbers[0];
    return { predicate: 'amount', value: num?.value ?? num?.raw ?? null };
  }
  
  // Default to "exists" predicate
  return { predicate: 'exists', value: claim.polarity === 'deny' ? false : true };
}

function extractConditions(text: string): string[] {
  const conditions: string[] = [];
  const lower = text.toLowerCase();
  
  // Promotional period condition
  if (/promo(tional)?\s*(period)?/i.test(lower) || /before.*end/i.test(lower)) {
    conditions.push('promo_period');
  }
  
  // Early termination condition
  if (/early/i.test(lower) || /before.*contract/i.test(lower)) {
    conditions.push('early_termination');
  }
  
  // Specific situations
  if (/in some cases/i.test(lower) || /depends/i.test(lower) || /situation/i.test(lower)) {
    conditions.push('situational');
  }
  
  return conditions;
}

function extractTimeframe(text: string): { start?: string; end?: string; relative?: string } | null {
  const lower = text.toLowerCase();
  
  if (/this cycle/i.test(lower) || /this month/i.test(lower)) {
    return { relative: 'this_cycle' };
  }
  
  if (/today/i.test(lower)) {
    return { relative: 'today' };
  }
  
  if (/right after/i.test(lower) || /after this call/i.test(lower)) {
    return { relative: 'immediately' };
  }
  
  return null;
}

function extractEntities(text: string): Array<{ type: string; value: string }> {
  const entities: Array<{ type: string; value: string }> = [];
  
  // Email addresses
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    entities.push({ type: 'email', value: emailMatch[0] });
  }
  
  // Phone numbers
  const phoneMatch = text.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
  if (phoneMatch) {
    entities.push({ type: 'phone', value: phoneMatch[0] });
  }
  
  // Names (simple heuristic: "My name is X")
  const nameMatch = text.match(/my name is (\w+)/i);
  if (nameMatch) {
    entities.push({ type: 'person', value: nameMatch[1] });
  }
  
  return entities;
}

function extractNumbers(text: string): Array<{ raw: string; value?: number; unit?: string }> {
  const numbers: Array<{ raw: string; value?: number; unit?: string }> = [];
  
  // Dollar amounts
  const dollarMatch = text.matchAll(/\$?\s*(\d+(?:\.\d{2})?)\s*(dollars?)?/gi);
  for (const match of dollarMatch) {
    numbers.push({
      raw: match[0],
      value: parseFloat(match[1]),
      unit: 'USD'
    });
  }
  
  // "twenty dollars" style
  const wordDollarMatch = text.match(/(twenty|thirty|forty|fifty|hundred)\s*dollars?/i);
  if (wordDollarMatch) {
    const wordToNum: Record<string, number> = {
      'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'hundred': 100
    };
    const val = wordToNum[wordDollarMatch[1].toLowerCase()];
    if (val) {
      numbers.push({ raw: wordDollarMatch[0], value: val, unit: 'USD' });
    }
  }
  
  // Percentages
  const percentMatch = text.matchAll(/(\d+(?:\.\d+)?)\s*%/g);
  for (const match of percentMatch) {
    numbers.push({
      raw: match[0],
      value: parseFloat(match[1]),
      unit: 'percent'
    });
  }
  
  return numbers;
}

function generateClaimId(turnIndex: number, text: string): string {
  const hash = createHash('sha256').update(text).digest('hex').substring(0, 8);
  return `c${turnIndex}_${hash}`;
}

function generateFactId(claimId: string, subject: string, predicate: string): string {
  const hash = createHash('sha256').update(`${claimId}:${subject}:${predicate}`).digest('hex').substring(0, 8);
  return `f_${hash}`;
}

