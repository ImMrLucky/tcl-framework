function normalize(s) {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function isNegationPair(a, b) {
    const A = normalize(a);
    const B = normalize(b);
    const notA = A.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");
    const notB = B.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");
    return normalize(notA) === normalize(B) || normalize(notB) === normalize(A);
}
function hasContradictoryKeywords(a, b) {
    const A = normalize(a);
    const B = normalize(b);
    // Check for contradictory patterns
    const contradictions = [
        ['should', 'should not'],
        ['must', 'must not'],
        ['always', 'never'],
        ['all', 'none'],
        ['every', 'no'],
        ['remove', 'not censor'],
        ['censor', 'not censor'],
        ['violates', 'should'],
        ['wrong', 'needed'],
        ['harmful', 'neutral'],
        ['responsibility', 'neutral']
    ];
    for (const [word1, word2] of contradictions) {
        if ((A.includes(word1) && B.includes(word2)) || (A.includes(word2) && B.includes(word1))) {
            return true;
        }
    }
    return false;
}
export function findLogicViolations(claims) {
    const violations = [];
    const contradictions = [];
    let contradictionCount = 0;
    for (let i = 0; i < claims.length; i++) {
        for (let j = i + 1; j < claims.length; j++) {
            const isNegation = isNegationPair(claims[i].text, claims[j].text);
            const hasKeywords = hasContradictoryKeywords(claims[i].text, claims[j].text);
            if (isNegation || hasKeywords) {
                contradictionCount++;
                const reason = isNegation
                    ? "Negation-style contradiction detected."
                    : "Contradictory keywords detected.";
                contradictions.push({
                    claimA: claims[i].id,
                    claimB: claims[j].id,
                    reason
                });
                violations.push({
                    type: "CONTRADICTION",
                    claimA: claims[i].id,
                    claimB: claims[j].id,
                    detail: isNegation
                        ? "Two claims appear to be logical negations."
                        : "Two claims contain contradictory keywords or concepts."
                });
            }
        }
    }
    const base = 100;
    const penalty = Math.min(100, contradictionCount * 25);
    const consistencyScore = Math.max(0, base - penalty);
    return { violations, contradictions, consistencyScore };
}
