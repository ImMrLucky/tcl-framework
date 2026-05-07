/**
 * Cross-Turn Consistency Engine
 *
 * Tracks customer-disclosed facts and agent claims across the conversation
 * and emits issues when later turns contradict earlier ones at the entity level.
 *
 * Why this is the moat:
 *  - Regex compliance rules catch isolated bad phrases.
 *  - This catches deception that spans turns: customer discloses a condition,
 *    agent later contradicts it; agent quotes a price, then quotes a different
 *    price; agent agrees with a customer concern, then walks it back.
 *
 * Outputs IssueV2 records with the rich metadata the rest of the system uses,
 * and produces a structured timeline so the UI can render it as a story.
 */
import { createHash } from "crypto";
const HEALTH_KEYWORDS = [
    { key: "diabetes", pattern: /\bdiabet(?:es|ic)\b/i },
    { key: "cancer", pattern: /\bcancer\b/i },
    { key: "heart_attack", pattern: /\bheart (?:attack|condition|disease)\b/i },
    { key: "oxygen", pattern: /\boxygen\b/i },
    { key: "hospitalization", pattern: /\bhospitaliz(?:ed|ation)\b/i },
    { key: "prescription", pattern: /\bprescription\b/i },
    { key: "high_blood_pressure", pattern: /\bhigh blood pressure\b/i },
];
const HEALTH_DISMISSAL = /\bhealth (?:does not|doesn'?t) matter\b|\bregardless of (?:health|condition)\b|\b(?:diabetes|cancer|oxygen|heart) (?:does not|doesn'?t) matter\b/i;
const NUMERIC_QUOTE = /\$\s?(\d{1,5}(?:[\.,]\d{1,2})?)/g;
const APPROVAL_AFFIRM = /\b(?:you (?:are|'re) approved|you qualify|you will be approved|guaranteed approval)\b/i;
const APPROVAL_QUALIFY = /\b(?:may qualify|could be eligible|final approval depends|carrier underwriting|policy terms apply|estimate)\b/i;
function extractEntities(text) {
    const out = [];
    const healthKeys = HEALTH_KEYWORDS.filter(h => h.pattern.test(text)).map(h => h.key);
    if (healthKeys.length > 0)
        out.push({ topic: "health", keys: healthKeys, numbers: [] });
    const numbers = [];
    let match;
    NUMERIC_QUOTE.lastIndex = 0;
    while ((match = NUMERIC_QUOTE.exec(text)) !== null) {
        const value = Number(match[1].replace(/,/g, ""));
        if (!Number.isNaN(value))
            numbers.push(value);
    }
    if (numbers.length > 0)
        out.push({ topic: "amount", keys: numbers.map(n => `$${n}`), numbers });
    if (APPROVAL_AFFIRM.test(text))
        out.push({ topic: "approval", keys: ["approval_affirmed"], numbers: [] });
    else if (APPROVAL_QUALIFY.test(text))
        out.push({ topic: "approval", keys: ["approval_qualified"], numbers: [] });
    return out;
}
function speakerType(claim) {
    const role = claim.meta?.speakerType;
    if (role === "customer")
        return "customer_fact";
    if (role === "agent" || role === "supervisor") {
        if (HEALTH_DISMISSAL.test(claim.text))
            return "agent_dismissal";
        if (NUMERIC_QUOTE.test(claim.text))
            return "numeric";
        if (APPROVAL_AFFIRM.test(claim.text))
            return "commitment";
        return "agent_assertion";
    }
    return null;
}
function eventsForClaim(claim) {
    const baseKind = speakerType(claim);
    if (!baseKind)
        return [];
    const entities = extractEntities(claim.text);
    if (entities.length === 0) {
        return [{
                kind: baseKind,
                topic: "other",
                turnIndex: claim.meta?.turnIndex,
                claimId: claim.id,
                text: claim.text,
                entities: [],
            }];
    }
    return entities.map(entity => ({
        kind: baseKind,
        topic: entity.topic,
        turnIndex: claim.meta?.turnIndex,
        claimId: claim.id,
        text: claim.text,
        entities: entity.keys,
        numbers: entity.numbers,
    }));
}
function makeIssue(type, earlier, later, reason, context) {
    const issueKey = `${type}:${earlier.claimId}:${later.claimId}`;
    const issueId = createHash("sha256").update(`${context.runId}:${issueKey}`).digest("hex").substring(0, 16);
    const severity = type === "CONTRADICTION" || type === "PROTECTQA_HEALTH_DOES_NOT_MATTER" ? "critical" : "high";
    return {
        issueId: `issue_${issueId}`,
        issueKey,
        clusterKey: `compliance:${type}:cross_turn:agent`,
        clusterId: createHash("sha256").update(`compliance:${type}:cross_turn:agent`).digest("hex").substring(0, 16),
        topicId: "cross_turn_consistency",
        slotKey: type.toLowerCase(),
        runId: context.runId,
        conversationId: context.conversationId,
        type,
        category: "compliance",
        severity,
        impact: "high",
        riskScore: severity === "critical" ? 0.95 : 0.85,
        score: severity === "critical" ? 95 : 85,
        confidence: 0.85,
        reviewRequired: true,
        verification: {
            level: context.evidenceMode === "TRANSCRIPT_PLUS_EXTERNAL" ? "EXTERNAL_VERIFIED" : "TRANSCRIPT_ONLY",
            reasonCodes: ["CROSS_TURN_INCONSISTENCY"],
        },
        who: {
            speaker: later.kind === "customer_fact" ? "CUSTOMER" : "AGENT",
            turnIndex: later.turnIndex,
        },
        what: {
            primaryClaimId: later.claimId,
            relatedClaimIds: [earlier.claimId],
            claimText: later.text,
            issueSummary: `Cross-turn inconsistency: ${type.replace(/_/g, " ").toLowerCase()}`,
            issueDetail: reason,
            plainEnglishSummary: `Earlier the customer stated something material; a later reply contradicts it: ${reason}`,
            whyItMatters: "Contradictions across turns create compliance exposure and undermine audit defensibility.",
            missingEvidence: ["carrier_underwriting_alignment", "health_questionnaire_match"],
            recommendedActionLabel: "Compliance review & script alignment",
            businessImpact: "Regulatory / customer-dispute risk",
            saferVersion: "Acknowledge the customer's earlier statement, do not contradict it, and qualify any approval/coverage claim with carrier and policy-term language.",
        },
        evidence: {
            refs: [
                { sourceType: "TRANSCRIPT", sourceId: `e-transcript-${earlier.turnIndex ?? 0}`, quote: earlier.text, turnIndex: earlier.turnIndex },
                { sourceType: "TRANSCRIPT", sourceId: `e-transcript-${later.turnIndex ?? 0}`, quote: later.text, turnIndex: later.turnIndex },
            ],
            edges: [],
        },
        compliance: { tags: ["cross_turn", "consistency", "final_expense"], impactedPolicies: [{ policyId: "CROSS_TURN_CONSISTENCY" }], disclaimers: [] },
        scoring: {
            components: { impact01: 0.95, evidence01: 0.85, signal01: 0.9, category01: 1, verificationMultiplier: 1, risk01Raw: 0.9, risk01Final: 0.9 },
            weights: { impact: 0.4, evidence: 0.3, signal: 0.2, category: 0.1 },
            reasons: ["CROSS_TURN_INCONSISTENCY"],
        },
        audit: { createdAt: new Date().toISOString(), engineVersion: process.env.ENGINE_VERSION || "0.2.0", scorerId: "cross-turn-consistency-v1" },
    };
}
export function runCrossTurnConsistency(claims, context) {
    const events = claims
        .flatMap(eventsForClaim)
        .sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
    const issues = [];
    const pairs = [];
    // 1. Customer-disclosed health facts contradicted by agent dismissal.
    const customerHealthFacts = events.filter(e => e.kind === "customer_fact" && e.topic === "health");
    const agentDismissals = events.filter(e => e.kind === "agent_dismissal");
    for (const fact of customerHealthFacts) {
        const dismissal = agentDismissals.find(d => (d.turnIndex ?? 0) > (fact.turnIndex ?? 0));
        if (dismissal) {
            const reason = `Customer disclosed ${fact.entities.join(", ") || "a health condition"} on turn ${fact.turnIndex}; agent later said health does not matter on turn ${dismissal.turnIndex}.`;
            issues.push(makeIssue("PROTECTQA_HEALTH_DOES_NOT_MATTER", fact, dismissal, reason, context));
            pairs.push({ earlier: fact, later: dismissal, reason });
        }
    }
    // 2. Agent escalates from qualified to affirmed approval (commitment escalation).
    const approvalQualified = events.filter(e => e.topic === "approval" && e.entities.includes("approval_qualified"));
    const approvalAffirmed = events.filter(e => e.topic === "approval" && e.entities.includes("approval_affirmed"));
    for (const earlier of approvalQualified) {
        const later = approvalAffirmed.find(a => (a.turnIndex ?? 0) > (earlier.turnIndex ?? 0));
        if (later) {
            const reason = `Agent moved from qualified eligibility on turn ${earlier.turnIndex} to an affirmed approval on turn ${later.turnIndex} without new evidence.`;
            issues.push(makeIssue("COMMITMENT_ESCALATION_DRIFT", earlier, later, reason, context));
            pairs.push({ earlier, later, reason });
        }
    }
    // 3. Numeric inconsistency (price/premium quoted, then a different price quoted).
    const numericEvents = events.filter(e => e.kind === "numeric" && (e.numbers?.length ?? 0) > 0);
    for (let i = 0; i < numericEvents.length; i++) {
        for (let j = i + 1; j < numericEvents.length; j++) {
            const a = numericEvents[i];
            const b = numericEvents[j];
            const aSet = new Set(a.numbers ?? []);
            const overlap = (b.numbers ?? []).some(n => aSet.has(n));
            if (!overlap) {
                const reason = `Inconsistent dollar amounts quoted: ${a.entities.join(",")} on turn ${a.turnIndex} vs. ${b.entities.join(",")} on turn ${b.turnIndex}.`;
                issues.push(makeIssue("NUMERIC_MISMATCH", a, b, reason, context));
                pairs.push({ earlier: a, later: b, reason });
                break;
            }
        }
    }
    // 4. Customer concern raised, agent provides absolute reassurance afterward
    //    on the same topic without qualification.
    const customerConcerns = events.filter(e => e.kind === "customer_fact" && e.topic === "approval");
    for (const concern of customerConcerns) {
        const reassurance = approvalAffirmed.find(a => (a.turnIndex ?? 0) > (concern.turnIndex ?? 0));
        if (reassurance) {
            const reason = `Customer concern about approval on turn ${concern.turnIndex} was answered with an absolute approval claim on turn ${reassurance.turnIndex}.`;
            issues.push(makeIssue("PROTECTQA_GUARANTEED_APPROVAL", concern, reassurance, reason, context));
            pairs.push({ earlier: concern, later: reassurance, reason });
        }
    }
    const penalty = issues.reduce((acc, issue) => acc + (issue.severity === "critical" ? 25 : 12), 0);
    const consistencyScore = Math.max(0, Math.min(100, 100 - penalty));
    return { events, issues, consistencyScore, pairs };
}
