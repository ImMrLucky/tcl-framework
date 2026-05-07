/**
 * Executive Summary / Trust Report Generator
 *
 * Turns the structured detector + scoring output into a small, opinionated
 * payload that's easy to render and easy for a non-technical reviewer to act on:
 *
 *  - Trust grade (A-F) and headline
 *  - Top issues with quotes and turn refs
 *  - "What was good" highlights when applicable
 *  - Recommended actions (coaching / process / compliance)
 *  - Risk-by-category breakdown for dashboards
 *
 * This is the layer enterprise buyers see, so the language is direct and
 * focuses on the business consequence, not the algorithm internals.
 */
function gradeFromOverall(overall, criticalCount) {
    if (criticalCount > 0 && overall <= 35)
        return "F";
    if (overall >= 90)
        return "A";
    if (overall >= 80)
        return "B";
    if (overall >= 65)
        return "C";
    if (overall >= 45)
        return "D";
    return "F";
}
function severityRank(s) {
    return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}
function categoryFromIssue(issue) {
    if (issue.compliance?.tags?.includes("hallucination_risk"))
        return "Hallucination";
    if (issue.compliance?.tags?.includes("drift"))
        return "Drift";
    if (issue.compliance?.tags?.includes("cross_turn"))
        return "Cross-turn";
    if (issue.type === "MISSING_REQUIRED_DISCLOSURE")
        return "Disclosure";
    if (issue.type === "SPEAKER_ATTRIBUTION_FAILURE")
        return "Attribution";
    if (issue.category === "compliance")
        return "Compliance";
    if (issue.category === "billing")
        return "Billing";
    if (issue.category === "consistency")
        return "Consistency";
    return "Other";
}
function quoteForIssue(issue) {
    return issue.what?.claimText
        ?? issue.evidence?.refs?.[0]?.quote
        ?? "";
}
function actionsFromIssues(issues) {
    const actions = [];
    const types = new Set(issues.map(i => i.type));
    if (types.has("GUARANTEED_APPROVAL") ||
        types.has("APPROVAL_BEFORE_APPLICATION") ||
        types.has("PROTECTQA_GUARANTEED_APPROVAL") ||
        types.has("PROTECTQA_APPROVAL_BEFORE_APPLICATION") ||
        types.has("PROTECTQA_NO_RISK_OF_DENIAL")) {
        actions.push({
            kind: "COMPLIANCE",
            action: "Run ProtectQA/compliance review: use carrier-dependent qualification language—not guaranteed approval—in line with underwriting rules.",
            priority: "high",
        });
    }
    if (types.has("HEALTH_UNDERWRITING_MISREPRESENTATION") || types.has("PROTECTQA_HEALTH_DOES_NOT_MATTER")) {
        actions.push({
            kind: "COMPLIANCE",
            action: "ProtectQA health/eligibility scripting review — medical history materially affects underwriting.",
            priority: "high",
        });
    }
    if (types.has("DAY_ONE_FULL_BENEFIT") || types.has("GUARANTEED_PAYOUT") || types.has("PROTECTQA_DAY_ONE_FULL_BENEFIT_OVERCLAIM") || types.has("PROTECTQA_GUARANTEED_PAYOUT")) {
        actions.push({
            kind: "COMPLIANCE",
            action: "Reinforce graded/modified/waiting-period and policy-term disclosures beside every payout/benefit claim.",
            priority: "high",
        });
    }
    if (types.has("MISSING_REQUIRED_DISCLOSURE") || [...types].some(t => /^PROTECTQA_MISSING_/i.test(t))) {
        actions.push({
            kind: "PROCESS",
            action: "Add required disclosures (carrier approval dependency, underwriting, waiting periods) to workflows and AI prompts.",
            priority: "medium",
        });
    }
    if (types.has("LICENSE_CLAIM_UNVERIFIED") || types.has("PROTECTQA_LICENSE_UNVERIFIED")) {
        actions.push({
            kind: "LEGAL",
            action: "Verify licensing assertions against jurisdictional records before conversations continue.",
            priority: "high",
        });
    }
    if (types.has("HALLUCINATED_AUTHORITY") ||
        types.has("UNSUPPORTED_PRODUCT_CLAIM") ||
        [...types].some(t => /^AI_/i.test(t))) {
        actions.push({
            kind: "PROCESS",
            action: "Update AI/agent grounding: cite tools, policies, or KB sources instead of asserting unsupported facts.",
            priority: "medium",
        });
    }
    if (types.has("COMMITMENT_ESCALATION_DRIFT") || types.has("PROTECTQA_AI_QUALIFICATION_DRIFT")) {
        actions.push({
            kind: "COMPLIANCE",
            action: "Calibrate drift: qualify early estimates and forbid escalation to guaranteed approvals without underwriting evidence.",
            priority: "medium",
        });
    }
    if (types.has("SPEAKER_ATTRIBUTION_FAILURE")) {
        actions.push({ kind: "PROCESS", action: "Audit upstream transcript pipeline; speaker attribution is unreliable and must be fixed before scoring downstream.", priority: "high" });
    }
    return actions;
}
function highlightsFromScores(input) {
    const out = [];
    if (input.risk.criticalCount === 0 && input.risk.highCount === 0) {
        out.push("No critical or high-severity compliance issues detected.");
    }
    if (input.scores.compliance >= 85)
        out.push(`Compliance score ${input.scores.compliance} indicates the agent stayed within safe sales language.`);
    if (input.scores.factualTruth >= 80)
        out.push(`Factual truth score ${input.scores.factualTruth} indicates claims were appropriately qualified.`);
    if (input.scores.drift >= 90)
        out.push(`Drift score ${input.scores.drift} indicates consistent commitment language across the call.`);
    return out;
}
/**
 * Legacy adapter kept for `server/express.ts`. Older code wired the executive
 * summary off of `aggregatedIssues + raw scores`. The new pipeline produces a
 * richer payload via `buildExecutiveSummary`, but this adapter keeps the older
 * request handler compiling and returns a compatible-shape summary so the UI
 * keeps rendering.
 */
export function computeExecutiveSummary(input) {
    const truth = input.truthScore ?? 0;
    const consistency = input.consistencyScore ?? 0;
    const coherence = input.coherenceScore ?? 0;
    const issues = (input.aggregatedIssues ?? []);
    const flatIssues = issues.flatMap((agg) => agg?.issues || agg?.allIssues || (agg?.issueKey ? [agg] : []));
    const criticalCount = flatIssues.filter(i => i.severity === "critical").length;
    const highCount = flatIssues.filter(i => i.severity === "high").length;
    const mediumCount = flatIssues.filter(i => i.severity === "medium").length;
    const lowCount = flatIssues.filter(i => i.severity === "low").length;
    const overall = Math.round((truth + consistency + coherence) / 3);
    const summary = buildExecutiveSummary({
        scores: {
            transcriptGrounding: 0,
            factualTruth: truth,
            compliance: 0,
            consistency,
            coherence,
            hallucination: 0,
            drift: 0,
            overall,
        },
        risk: { level: criticalCount > 0 ? "critical" : highCount > 0 ? "high" : mediumCount > 0 ? "medium" : "low", criticalCount, highCount, mediumCount, lowCount, reviewRequired: criticalCount > 0 || highCount > 0 },
        issues: flatIssues,
        claims: [],
        scoringCapsApplied: [],
        diagnostics: { contaminatedClaims: 0, unknownSpeakerLines: 0, speakerMappingConfidence: 100 },
    });
    return {
        trustGrade: summary.trustGrade,
        headline: summary.headline,
        oneLineVerdict: summary.oneLineVerdict,
        topIssues: summary.topIssues,
        recommendedActions: summary.recommendedActions,
        riskByCategory: summary.riskByCategory,
        scoreBreakdown: summary.scoreBreakdown,
    };
}
export function buildExecutiveSummary(input) {
    const trustGrade = gradeFromOverall(input.scores.tcl ?? input.scores.overall, input.risk.criticalCount);
    const sortedIssues = [...input.issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.riskScore ?? 0) - (a.riskScore ?? 0));
    const topIssues = sortedIssues.slice(0, 5).map(issue => ({
        title: issue.what?.issueSummary ?? issue.type,
        severity: issue.severity,
        speakerLabel: issue.who?.speakerLabel ?? (issue.who?.speaker === "AGENT" ? "Agent" : issue.who?.speaker === "CUSTOMER" ? "Customer" : undefined),
        turnIndex: issue.who?.turnIndex,
        quote: quoteForIssue(issue),
        saferVersion: issue.what?.saferVersion,
        why: issue.what?.whyItMatters || issue.what?.issueDetail || "",
    }));
    const riskByCategory = {};
    for (const issue of input.issues) {
        const category = categoryFromIssue(issue);
        riskByCategory[category] = (riskByCategory[category] ?? 0) + 1;
    }
    const headline = trustGrade === "A" ? "Call meets compliance and truthfulness expectations." :
        trustGrade === "B" ? "Call is generally compliant with minor improvements suggested." :
            trustGrade === "C" ? "Call has notable compliance or accuracy concerns to address." :
                trustGrade === "D" ? "Call has significant compliance or accuracy risk; review recommended." :
                    "Call has critical compliance or accuracy failures; immediate review required.";
    const oneLineVerdict = input.risk.criticalCount > 0 ? `${input.risk.criticalCount} critical and ${input.risk.highCount} high-severity issues detected; do not release without review.` :
        input.risk.highCount > 0
            ? `${input.risk.highCount} high-severity issues detected — schedule compliance review, AI prompt grounding, or script updates before rerunning.` :
            input.risk.mediumCount > 0 ? `${input.risk.mediumCount} medium-severity issues detected; minor process improvements suggested.` :
                "No actionable risk signals detected; call passes baseline compliance and consistency checks.";
    return {
        trustGrade,
        headline,
        oneLineVerdict,
        topIssues,
        highlights: highlightsFromScores(input),
        recommendedActions: actionsFromIssues(input.issues),
        riskByCategory,
        scoreBreakdown: [
            {
                label: "TCL score",
                value: input.scores.tcl ?? input.scores.overall,
                description: "Primary Conversation Truth & Risk score — blends compliance, truthful/supported claims, disclosures, drift, hallucination indicators, evidence, and speaker confidence.",
            },
            { label: "Compliance / policy fit", value: input.scores.compliance, description: "Did the conversation respect domain rules (ProtectQA carriers, HIPAA, SOC2, refunds, …)?" },
            { label: "Factual truth & safety", value: input.scores.factualTruth, description: "Are claims accurate, non-misleading, and penalized when rules say they are unsafe?" },
            { label: "Disclosure coverage", value: input.scores.disclosureCoverage ?? null, description: "Are required disclaimers present after high-risk topics?" },
            { label: "Evidence support", value: input.scores.evidenceSupport ?? null, description: "How well material claims tie to transcripts + approved docs/records?" },
            { label: "Business insight density", value: input.scores.businessValue ?? null, description: "Value mined from objections, intents, churn signals—not only violations." },
            { label: "Consistency", value: input.scores.consistency, description: "Do claims cohere across speakers and turns?" },
            { label: "Hallucination posture", value: input.scores.hallucination, description: "High score ≈ fewer unsupported inventions (human or AI)." },
            { label: "Drift / discipline", value: input.scores.drift, description: "Did commitments, disclosures, and roles stay disciplined?" },
            { label: "Coherence", value: input.scores.coherence, description: "Graph-level coherence signal (spectral)." },
            { label: "Transcript grounding", value: input.scores.transcriptGrounding, description: "Audit traceability — what was said is anchored (not proof it was true)." },
            { label: "Overall (alias)", value: input.scores.overall, description: "Same as TCL score — kept for legacy integrations." },
        ],
        callQualityIndicators: {
            speakerMappingConfidence: input.diagnostics.speakerMappingConfidence,
            contaminatedClaims: input.diagnostics.contaminatedClaims,
            unknownSpeakerLines: input.diagnostics.unknownSpeakerLines,
            capsApplied: input.scoringCapsApplied,
        },
    };
}
