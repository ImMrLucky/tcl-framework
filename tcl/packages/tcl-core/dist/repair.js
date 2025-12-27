export function collectFailingClaimIds(report) {
    const failing = new Set();
    for (const v of report.violations) {
        if (v.type === "MISSING_EVIDENCE")
            failing.add(v.claimId);
        if (v.type === "LOW_CONFIDENCE")
            failing.add(v.claimId);
        if (v.type === "CONTRADICTION") {
            failing.add(v.claimA);
            failing.add(v.claimB);
        }
    }
    return [...failing];
}
export async function repairOnce(params) {
    const { adapter, question, originalAnswer, claims, sources, failingClaimIds, requireCitations } = params;
    return adapter.repairOnePass({
        question,
        originalAnswer,
        claims,
        sources,
        failingClaimIds,
        policy: {
            requireCitations,
            allowHedging: true,
            maxAnswerChars: 2000
        }
    });
}
