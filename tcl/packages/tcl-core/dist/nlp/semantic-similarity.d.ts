/**
 * Semantic Similarity - Compute semantic similarity between statements
 *
 * UNIVERSAL: Works across all domains. Synonym mappings come from config.
 *
 * Improvements over keyword-based Jaccard:
 * 1. Synonym awareness (configurable per domain)
 * 2. Entity alignment (compare apples to apples)
 * 3. Polarity detection (affirm vs deny)
 */
/**
 * Normalize a word to its canonical form using synonym groups from config
 */
export declare function normalizeWord(word: string): string;
/**
 * Tokenize text into normalized words (not just raw tokens)
 */
export declare function tokenizeAndNormalize(text: string): string[];
/**
 * Compute semantic similarity between two texts
 * Returns 0-1 where 1 = semantically identical
 */
export declare function computeSemanticSimilarity(textA: string, textB: string): {
    score: number;
    entityMatch: boolean;
    canonicalOverlap: number;
    explanation: string;
};
/**
 * Check if two claims are about the same subject (for contradiction eligibility)
 */
export declare function areSameSubject(textA: string, textB: string): {
    sameSubject: boolean;
    confidence: number;
    subject?: string;
    reason: string;
};
/**
 * Check if claims have opposing polarity on the same subject
 */
export declare function hasOpposingPolarity(textA: string, textB: string): {
    opposing: boolean;
    strength: number;
    reason: string;
};
/**
 * Comprehensive contradiction check using all NLP signals
 */
export declare function checkContradiction(textA: string, textB: string): {
    isContradiction: boolean;
    confidence: number;
    reasons: string[];
};
