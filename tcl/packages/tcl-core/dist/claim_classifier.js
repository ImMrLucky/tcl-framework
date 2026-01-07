/**
 * Claim Classifier
 *
 * Classifies claims by kind BEFORE graph building to enable proper contradiction gating.
 * This is the key fix for false contradictions.
 *
 * Rules-based first (fast + deterministic), optionally LLM later.
 */
import { getScoringConfig } from "./config/scoring.js";
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
    /\?$/, // Ends with question mark
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
export function classifyClaimKind(claimText, speakerLabel) {
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
export function extractKeywords(text, config) {
    const cfg = config || getScoringConfig();
    const keywords = new Set();
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
 * Calculate topic overlap between two claims using NLP-enhanced similarity.
 * Returns 0-1 where 1 = identical topics.
 *
 * IMPROVED: Uses synonym-aware tokenization and entity matching
 * instead of simple keyword Jaccard.
 */
export function calculateTopicOverlap(claimA, claimB, config) {
    const textA = typeof claimA === 'string' ? claimA : claimA.text;
    const textB = typeof claimB === 'string' ? claimB : claimB.text;
    // Try NLP-enhanced similarity first
    try {
        // Dynamic import to avoid circular dependency
        const { computeSemanticSimilarity, sharesPrimaryEntity } = require('./nlp/semantic-similarity.js');
        // Check entity alignment (strongest signal)
        const entityMatch = sharesPrimaryEntity(textA, textB);
        if (entityMatch.shares) {
            // Same entity = high overlap
            return 0.7;
        }
        // Use synonym-aware semantic similarity
        const result = computeSemanticSimilarity(textA, textB);
        return result.score;
    }
    catch {
        // Fall back to keyword-based if NLP module not available
    }
    // FALLBACK: Original keyword-based Jaccard
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
/**
 * Map ClaimKind to semantic claim type for compatibility checking
 */
function getSemanticClaimType(kind, text) {
    if (kind === 'question')
        return 'question';
    if (kind === 'intent')
        return 'intent';
    if (kind === 'promise')
        return 'promise';
    // Check for amount/money references
    if (/\$\d+|\d+\s*(dollar|cent|percent|%)/i.test(text)) {
        return 'amount';
    }
    // Check for policy references
    if (/policy|terms|agreement|contract|plan|subscription/i.test(text)) {
        return 'policy';
    }
    // Check for offers
    if (/offer|deal|discount|promotion|special/i.test(text)) {
        return 'offer';
    }
    // Default to fact for assertions
    if (kind === 'assertion')
        return 'fact';
    return 'other';
}
/**
 * Check if two semantic claim types are compatible for contradiction
 */
function areClaimTypesCompatible(typeA, typeB) {
    // Compatible pairs
    const compatible = {
        'fact': ['fact', 'policy', 'amount'],
        'policy': ['fact', 'policy'],
        'amount': ['fact', 'amount'],
        'promise': ['promise'],
    };
    return compatible[typeA]?.includes(typeB) || compatible[typeB]?.includes(typeA) || false;
}
/**
 * Check for polarity/opposition signal between two claims
 * Returns score 0-1 indicating how strongly one negates the other
 */
function checkPolarityOpposition(textA, textB) {
    const negationWords = /\b(not|no|never|none|nothing|nobody|nowhere|neither|cannot|can't|won't|wouldn't|shouldn't|doesn't|don't|isn't|aren't|wasn't|weren't)\b/i;
    const affirmationWords = /\b(is|are|was|were|will|would|can|could|should|does|do|has|have|always|all|every|any)\b/i;
    const hasNegationA = negationWords.test(textA);
    const hasNegationB = negationWords.test(textB);
    const hasAffirmationA = affirmationWords.test(textA);
    const hasAffirmationB = affirmationWords.test(textB);
    // If one has negation and other has affirmation on same topic, that's opposition
    if ((hasNegationA && hasAffirmationB) || (hasNegationB && hasAffirmationA)) {
        return 0.7; // Strong opposition signal
    }
    // Both have negation or both have affirmation = not opposition
    if ((hasNegationA && hasNegationB) || (hasAffirmationA && hasAffirmationB)) {
        return 0.1; // Weak opposition signal
    }
    // Default: moderate signal (needs further analysis)
    return 0.4;
}
/**
 * Determine if two claims should be considered for contradiction.
 * Enhanced version with all gating requirements from spec.
 *
 * Returns:
 * - shouldCreate: false if this pair should NOT create any contradiction edge
 * - contradictionType: "direct" | "topic_mismatch" | "low_overlap" | "needs_review"
 * - reasonCodes: why this decision was made
 * - overlapScore: topic overlap score (0-1)
 * - polarityOppositionScore: how strongly one negates the other (0-1)
 */
export function shouldConsiderContradiction(claimA, claimB, config) {
    const cfg = config || getScoringConfig();
    const reasonCodes = [];
    const kindA = claimA.claimKind || "assertion";
    const kindB = claimB.claimKind || "assertion";
    // ========================================================================
    // GATE 1: Claim-type compatibility
    // ========================================================================
    const typeA = getSemanticClaimType(kindA, claimA.text);
    const typeB = getSemanticClaimType(kindB, claimB.text);
    if (!areClaimTypesCompatible(typeA, typeB)) {
        reasonCodes.push(`INCOMPATIBLE_TYPES:${typeA}_vs_${typeB}`);
        return {
            shouldCreate: false,
            contradictionType: "needs_review",
            reasonCodes,
            overlapScore: 0,
        };
    }
    // ========================================================================
    // GATE 2: Non-contradictory kinds (intent, question, emotion, meta)
    // ========================================================================
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
    // ========================================================================
    // GATE 3: Self-contradictory kinds (promise can only contradict promise)
    // ========================================================================
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
    // ========================================================================
    // GATE 4: Topic overlap
    // ========================================================================
    const overlapScore = calculateTopicOverlap(claimA, claimB, cfg);
    const topicThreshold = (config?.thresholds?.topicOverlapThreshold ?? cfg.thresholds.minTopicOverlapForAnyEdge);
    if (overlapScore < topicThreshold) {
        reasonCodes.push("LOW_OVERLAP");
        return {
            shouldCreate: false,
            contradictionType: "low_overlap",
            reasonCodes,
            overlapScore,
        };
    }
    // ========================================================================
    // GATE 5: Polarity/opposition signal
    // ========================================================================
    const polarityScore = checkPolarityOpposition(claimA.text, claimB.text);
    const polarityThreshold = (config?.thresholds?.polarityOppositionThreshold ?? 0.3);
    if (polarityScore < polarityThreshold) {
        reasonCodes.push("WEAK_POLARITY_OPPOSITION");
        // Don't create contradiction, but could create "related" edge
        return {
            shouldCreate: false,
            contradictionType: "needs_review",
            reasonCodes,
            overlapScore,
            polarityOppositionScore: polarityScore,
        };
    }
    // ========================================================================
    // GATE 6: Timeframe overlap (if both claims have temporal scope)
    // TODO: Implement timeframe extraction and overlap check
    // ========================================================================
    // For now, assume timeframe overlap if topic overlap is high enough
    const timeframeOverlap = overlapScore > 0.5;
    // ========================================================================
    // DECISION: All gates passed
    // ========================================================================
    const directThreshold = cfg.thresholds.minTopicOverlapForContradiction;
    if (overlapScore < directThreshold) {
        reasonCodes.push("TOPIC_MISMATCH");
        return {
            shouldCreate: true, // Create edge, but NOT as "direct"
            contradictionType: "topic_mismatch",
            reasonCodes,
            overlapScore,
            polarityOppositionScore: polarityScore,
            timeframeOverlap,
        };
    }
    // Passed all gates -> direct contradiction
    return {
        shouldCreate: true,
        contradictionType: "direct",
        reasonCodes: [],
        overlapScore,
        polarityOppositionScore: polarityScore,
        timeframeOverlap,
    };
}
// ============================================================================
// CLASSIFY ALL CLAIMS - Apply classification to claim array
// ============================================================================
/**
 * Classify all claims in an array, adding claimKind field.
 */
export function classifyAllClaims(claims) {
    return claims.map(claim => ({
        ...claim,
        claimKind: classifyClaimKind(claim.text, claim.meta?.speaker),
    }));
}
/**
 * Get classification stats for debugging.
 */
export function getClassificationStats(claims) {
    const stats = {
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
