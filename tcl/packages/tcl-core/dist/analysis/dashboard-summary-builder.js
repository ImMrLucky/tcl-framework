const PRODUCT_PRIMARY = "TCL turns conversations into defensible truth, compliance, hallucination drift, and business-value intelligence.";
const PROTECTQA_SUBTITLE = "How safe, truthful, and compliant this ProtectQA final-expense conversation was.";
export function buildDashboardSummary(input) {
    const sorted = [...input.issues].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
    const topRisks = sorted.slice(0, 3).map(i => ({
        title: i.what.issueSummary,
        quote: (i.what.claimText || i.evidence?.refs?.[0]?.quote || "").slice(0, 280),
        speaker: i.who.speaker === "AGENT" ? "Agent" : i.who.speaker === "CUSTOMER" ? "Customer" : "Assistant",
        turnIndex: i.who.turnIndex,
        whyItMatters: i.what.whyItMatters || i.what.issueDetail,
        recommendedFix: i.what.saferVersion || i.what.recommendedActionLabel || "Review with compliance template",
        severity: i.severity,
    }));
    const topDrift = input.drift?.driftTimeline?.length && input.drift.driftIssues.length
        ? input.drift.driftIssues.slice(0, 2).map((issue, idx) => {
            const tl = input.drift.driftTimeline;
            const a = tl[idx * 2]?.text ?? "";
            const b = tl[idx * 2 + 1]?.text ?? issue.what.claimText ?? "";
            return {
                earlierQuote: a || b,
                laterQuote: b || a,
                driftType: issue.type,
                recommendedFix: issue.what.saferVersion || "Re-align to approved qualification language",
            };
        })
        : [];
    const speakerMix = summarizeSpeakers(input.claims);
    const topics = inferTopics(input.transcriptHint);
    return {
        title: input.mode === "protectqa" ? "ProtectQA Conversation Review" : "Conversation Truth & Risk Review",
        subtitle: input.mode === "protectqa" ? PROTECTQA_SUBTITLE : PRODUCT_PRIMARY,
        dashboardMode: input.mode === "protectqa" ? "protectqa" : "tcl",
        plainEnglishSummary: buildPlainSummary(input.tclScore, speakerMix, topics, input.insights.length, sorted.length),
        conversationTrustScore: {
            label: input.mode === "protectqa" ? "ProtectQA Risk Score" : "TCL Score",
            score: input.tclScore,
            subtitle: "How trustworthy, compliant, grounded, and useful this conversation was.",
        },
        topRisks,
        topUnsupportedClaims: input.topUnsupported.slice(0, 5).map(u => ({
            claimText: u.claimText,
            missingEvidence: u.missing,
            requiredSource: u.missing[0] || "Approved policy or system record",
            recommendedEvidenceSource: "Connect carrier files, CRM, or knowledge base chunks",
        })),
        topDriftEvents: topDrift,
        topBusinessInsights: input.insights.slice(0, 6),
        nextBestActions: input.nextActions.length
            ? input.nextActions
            : ["Review flagged quotes", "Confirm disclosures with approved script", "Attach evidence sources for material claims"],
    };
}
function sevRank(s) {
    return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}
function summarizeSpeakers(claims) {
    const roles = new Map();
    for (const c of claims) {
        const r = c.meta?.speakerType ?? "unknown";
        roles.set(r, (roles.get(r) ?? 0) + 1);
    }
    return Array.from(roles.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
}
function inferTopics(text) {
    const t = text.toLowerCase();
    const topics = [];
    if (/\b(final expense|burial|death benefit)\b/.test(t))
        topics.push("final expense");
    if (/\b(refund|support|ticket)\b/.test(t))
        topics.push("support");
    if (/\b(soc|hipaa|integration)\b/.test(t))
        topics.push("saas/security");
    return topics.join(", ") || "general";
}
function buildPlainSummary(score, speakers, topics, insightCount, issueCount) {
    return `TCL scored this conversation ${score}/100 on trust, compliance, and reliability. Speakers (claim mix): ${speakers}. Dominant topics: ${topics}. ${issueCount} risk signals and ${insightCount} business insights were extracted — review the “What Was Risky” and “What the Business Can Learn” sections for next steps.`;
}
