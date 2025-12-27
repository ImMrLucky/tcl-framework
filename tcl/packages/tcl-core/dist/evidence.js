function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function tokenOverlapScore(claim, source) {
    const c = new Set(normalize(claim).split(" ").filter((w) => w.length >= 4));
    const s = new Set(normalize(source).split(" ").filter((w) => w.length >= 4));
    if (c.size === 0)
        return 0;
    let hit = 0;
    for (const w of c)
        if (s.has(w))
            hit++;
    return hit / Math.max(1, c.size);
}
/**
 * MVP grounding: token overlap.
 * Production: replace by NLI entailment (see graph/edge_builder.ts).
 */
export function attachEvidenceAndFindViolations(claims, sources, minSupport = 0.35) {
    // Defensive: handle empty claims
    if (!claims || claims.length === 0) {
        return { claims: [], violations: [], missing: [], truthScore: 0 };
    }
    // If no sources provided, can't verify truth - return neutral score
    // (50 is neutral, not 0, because we can't prove it's false without sources)
    if (!sources || sources.length === 0) {
        return { claims, violations: [], missing: [], truthScore: 50 };
    }
    const violations = [];
    const missing = [];
    let supportedCount = 0;
    for (const claim of claims) {
        let best = null;
        for (const src of sources) {
            const sc = tokenOverlapScore(claim.text, src.text);
            if (!best || sc > best.score)
                best = { sid: src.id, score: sc };
        }
        if (best && best.score >= minSupport) {
            supportedCount++;
            claim.evidence = [{ source_id: best.sid, weight: best.score }];
        }
        else {
            missing.push({ claimId: claim.id, reason: "No sufficiently supporting source text found." });
            violations.push({
                type: "MISSING_EVIDENCE",
                claimId: claim.id,
                detail: `Claim appears unsupported (best support < ${minSupport}).`
            });
        }
    }
    // Calculate truth score: percentage of claims that are supported
    // Ensure result is in 0-100 range
    const truthScore = Math.max(0, Math.min(100, Math.round((supportedCount / Math.max(1, claims.length)) * 100)));
    return { claims, violations, missing, truthScore };
}
