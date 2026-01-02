/**
 * Claim Classifier
 * 
 * Classifies claims by kind BEFORE graph building to enable proper contradiction gating.
 * This is the key fix for false contradictions.
 * 
 * Rules-based first (fast + deterministic), optionally LLM later.
 */

import type { ClaimKind, Claim, ContradictionType } from "./types.js";
import { getScoringConfig, type ScoringConfig } from "./config/scoring.js";

// ============================================================================
// CLAIM KIND CLASSIFICATION
// ============================================================================

/** Patterns for intent detection */
const INTENT_PATTERNS = [
  /^i want to\b/i,
  /^i'd like to\b/i,
  /^i would like to\b/i,
  /^i need to\b/i,
  /^i'm trying to\b/i,
  /^i am trying to\b/i,
  /^i'm looking to\b/i,
  /^i want\b/i,
  /^i need\b/i,
  /^can i\b/i,
  /^could i\b/i,
];

/** Patterns for question detection */
const QUESTION_PATTERNS = [
  /\?$/,  // Ends with question mark
  /^can you\b/i,
  /^could you\b/i,
  /^would you\b/i,
  /^what\b/i,
  /^why\b/i,
  /^how\b/i,
  /^when\b/i,
  /^where\b/i,
  /^who\b/i,
  /^is there\b/i,
  /^are there\b/i,
  /^do you\b/i,
  /^does\b/i,
  /^did\b/i,
];

/** Keywords for emotion detection */
const EMOTION_KEYWORDS = [
  "frustrated", "frustrating", "frustration",
  "upset", "angry", "annoyed",
  "confused", "confusing", "confusion",
  "disappointed", "disappointing",
  "unhappy", "dissatisfied",
  "worried", "concerned", "anxious",
];

/** Patterns for promise detection (agent commitments) */
const PROMISE_PATTERNS = [
  /\bi will\b/i,
  /\bi'll\b/i,
  /\bi'm going to\b/i,
  /\bi am going to\b/i,
  /\bi can send\b/i,
  /\bi can email\b/i,
  /\blet me send\b/i,
  /\blet me email\b/i,
  /\bi'll email\b/i,
  /\bi'll send\b/i,
  /\bi'll call\b/i,
  /\bi'll get back\b/i,
  /\bi'll follow up\b/i,
  /\bwe will\b/i,
  /\bwe'll\b/i,
];

/** Patterns for meta statements */
const META_PATTERNS = [
  /outlined in the (service )?agreement/i,
  /in the agreement/i,
  /terms (and conditions )?say/i,
  /terms state/i,
  /policy (says|states)/i,
  /let me (look|check|pull|see)/i,
  /let me take a look/i,
  /looking at your account/i,
  /based on what i (can )?see/i,
  /according to (your|the|our)/i,
  /as per the/i,
];

/**
 * Classify a claim's kind based on text and speaker.
 * 
 * Priority order:
 * 1. Question (very reliable pattern)
 * 2. Intent (customer wants/needs)
 * 3. Emotion (feelings expressed)
 * 4. Promise (agent commitments)
 * 5. Meta (doc references, conversation control)
 * 6. Default: assertion
 */
export function classifyClaimKind(
  claimText: string,
  speakerLabel?: string
): ClaimKind {
  const text = claimText.trim();
  const isAgent = speakerLabel?.toLowerCase() === "agent";
  const isCustomer = speakerLabel?.toLowerCase() === "customer";
  
  // 1. Question - highest priority, very reliable
  for (const pattern of QUESTION_PATTERNS) {
    if (pattern.test(text)) {
      return "question";
    }
  }
  
  // 2. Intent - customer expressing goals
  if (isCustomer) {
    for (const pattern of INTENT_PATTERNS) {
      if (pattern.test(text)) {
        return "intent";
      }
    }
  }
  
  // 3. Emotion - feelings expressed by either party
  const lowerText = text.toLowerCase();
  for (const keyword of EMOTION_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return "emotion";
    }
  }
  
  // 4. Promise - agent commitments
  if (isAgent) {
    for (const pattern of PROMISE_PATTERNS) {
      if (pattern.test(text)) {
        return "promise";
      }
    }
  }
  
  // 5. Meta - doc references, conversation control
  for (const pattern of META_PATTERNS) {
    if (pattern.test(text)) {
      return "meta";
    }
  }
  
  // 6. Default: assertion
  return "assertion";
}

// ============================================================================
// TOPIC OVERLAP - For contradiction gating
// ============================================================================

/**
 * Extract normalized keywords from text for topic matching.
 */
export function extractKeywords(text: string, config?: ScoringConfig): Set<string> {
  const cfg = config || getScoringConfig();
  const keywords = new Set<string>();
  const lowerText = text.toLowerCase();
  
  // Extract words from text (simple tokenization)
  const words = lowerText.split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length > 2);
  
  // Check against topic keywords
  for (const [topic, topicWords] of Object.entries(cfg.topicKeywords)) {
    for (const word of topicWords) {
      if (lowerText.includes(word.toLowerCase())) {
        keywords.add(topic);
        keywords.add(word.toLowerCase());
      }
    }
  }
  
  // Also add significant words (longer than 4 chars, not stopwords)
  const STOPWORDS = new Set(["the", "and", "that", "this", "with", "for", "you", "your", "have", "been", "from", "about", "would", "could", "should", "there", "their", "what", "when", "where", "which", "been"]);
  for (const word of words) {
    if (word.length > 4 && !STOPWORDS.has(word)) {
      keywords.add(word);
    }
  }
  
  return keywords;
}

/**
 * Calculate topic overlap between two claims using Jaccard similarity.
 * Returns 0-1 where 1 = identical topics.
 */
export function calculateTopicOverlap(
  claimA: string | { text: string },
  claimB: string | { text: string },
  config?: ScoringConfig
): number {
  const textA = typeof claimA === 'string' ? claimA : claimA.text;
  const textB = typeof claimB === 'string' ? claimB : claimB.text;
  
  const keywordsA = extractKeywords(textA, config);
  const keywordsB = extractKeywords(textB, config);
  
  if (keywordsA.size === 0 || keywordsB.size === 0) {
    return 0;
  }
  
  // Jaccard similarity: intersection / union
  let intersection = 0;
  for (const keyword of keywordsA) {
    if (keywordsB.has(keyword)) {
      intersection++;
    }
  }
  
  const union = new Set([...keywordsA, ...keywordsB]).size;
  
  return union > 0 ? intersection / union : 0;
}

// ============================================================================
// CONTRADICTION GATING - The key fix for false contradictions
// ============================================================================

export interface ContradictionGateResult {
  shouldCreate: boolean;
  contradictionType: ContradictionType;
  reasonCodes: string[];
  overlapScore: number;
}

/**
 * Determine if two claims should be considered for contradiction.
 * This is the main fix for false contradictions.
 * 
 * Returns:
 * - shouldCreate: false if this pair should NOT create any contradiction edge
 * - contradictionType: "direct" | "topic_mismatch" | "low_overlap" | "needs_review"
 * - reasonCodes: why this decision was made
 */
export function shouldConsiderContradiction(
  claimA: Claim,
  claimB: Claim,
  config?: ScoringConfig
): ContradictionGateResult {
  const cfg = config || getScoringConfig();
  const reasonCodes: string[] = [];
  
  const kindA = claimA.claimKind || "assertion";
  const kindB = claimB.claimKind || "assertion";
  
  // 1. Check if either claim is a non-contradictory kind
  const nonContradictory = cfg.classification.nonContradictoryKinds;
  
  if (nonContradictory.includes(kindA)) {
    reasonCodes.push(`KIND_${kindA.toUpperCase()}`);
  }
  if (nonContradictory.includes(kindB)) {
    reasonCodes.push(`KIND_${kindB.toUpperCase()}`);
  }
  
  // Intent, question, emotion, meta -> no contradiction
  if (reasonCodes.length > 0) {
    return {
      shouldCreate: false,
      contradictionType: "needs_review",
      reasonCodes,
      overlapScore: 0,
    };
  }
  
  // 2. Promise can only contradict other promises
  const selfContradictory = cfg.classification.selfContradictoryKinds;
  if (selfContradictory.includes(kindA) || selfContradictory.includes(kindB)) {
    if (kindA !== kindB) {
      reasonCodes.push("PROMISE_VS_NON_PROMISE");
      return {
        shouldCreate: false,
        contradictionType: "needs_review",
        reasonCodes,
        overlapScore: 0,
      };
    }
  }
  
  // 3. Calculate topic overlap
  const overlapScore = calculateTopicOverlap(claimA, claimB, cfg);
  
  // 4. Gate by overlap threshold
  if (overlapScore < cfg.thresholds.minTopicOverlapForAnyEdge) {
    reasonCodes.push("LOW_OVERLAP");
    return {
      shouldCreate: false,
      contradictionType: "low_overlap",
      reasonCodes,
      overlapScore,
    };
  }
  
  if (overlapScore < cfg.thresholds.minTopicOverlapForContradiction) {
    reasonCodes.push("TOPIC_MISMATCH");
    return {
      shouldCreate: true, // Create edge, but NOT as "direct"
      contradictionType: "topic_mismatch",
      reasonCodes,
      overlapScore,
    };
  }
  
  // 5. Passed all gates -> direct contradiction
  return {
    shouldCreate: true,
    contradictionType: "direct",
    reasonCodes: [],
    overlapScore,
  };
}

// ============================================================================
// CLASSIFY ALL CLAIMS - Apply classification to claim array
// ============================================================================

/**
 * Classify all claims in an array, adding claimKind field.
 */
export function classifyAllClaims(claims: Claim[]): Claim[] {
  return claims.map(claim => ({
    ...claim,
    claimKind: classifyClaimKind(claim.text, claim.meta?.speaker),
  }));
}

/**
 * Get classification stats for debugging.
 */
export function getClassificationStats(claims: Claim[]): Record<ClaimKind, number> {
  const stats: Record<ClaimKind, number> = {
    assertion: 0,
    intent: 0,
    question: 0,
    meta: 0,
    emotion: 0,
    promise: 0,
    unknown: 0,
  };
  
  for (const claim of claims) {
    const kind = claim.claimKind || "unknown";
    stats[kind]++;
  }
  
  return stats;
}

