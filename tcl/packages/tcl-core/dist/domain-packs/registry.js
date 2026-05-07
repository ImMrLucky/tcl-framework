/**
 * Domain Pack Registry & Runner — pluggable Conversation Truth & Risk Intelligence.
 *
 * ProtectQA final-expense scoring is always available by default (`protectqa_final_expense`).
 * Additional packs attach from template or explicit `domainPackIds`.
 */
import { createHash } from "crypto";
import { protectqaFinalExpensePack } from "./protectqa-final-expense.js";
import { aiChatbotPack } from "./ai-chatbot.js";
import { customerSupportPack, saasSalesPack, healthcareIntakePack, financialServicesPack } from "./vertical-stubs.js";
const REGISTRY = new Map();
/** ProtectQA-first default — no configuration required */
export const DEFAULT_DOMAIN_PACK_IDS = ["protectqa_final_expense"];
export function registerDomainPack(pack) {
    REGISTRY.set(pack.id, pack);
}
export function getDomainPack(id) {
    return REGISTRY.get(id);
}
export function getAllDomainPacks() {
    return Array.from(REGISTRY.values());
}
function dedupePacks(packs) {
    const seen = new Set();
    const out = [];
    for (const p of packs) {
        if (seen.has(p.id))
            continue;
        seen.add(p.id);
        out.push(p);
    }
    return out;
}
/**
 * Ensure ProtectQA pack is first when present (labeling + dashboard defaults).
 */
function orderProtectqaFirst(packs) {
    const pq = packs.filter(p => p.id === "protectqa_final_expense");
    const rest = packs.filter(p => p.id !== "protectqa_final_expense");
    return [...pq, ...rest];
}
export function selectDomainPacks(options) {
    if (options.packIds?.length) {
        const resolved = options.packIds
            .map(id => REGISTRY.get(id))
            .filter((pack) => Boolean(pack));
        return orderProtectqaFirst(dedupePacks(resolved.length > 0 ? resolved : [protectqaFinalExpensePack]));
    }
    if (options.templateId) {
        const matched = getAllDomainPacks().filter(pack => pack.templates?.includes(options.templateId));
        if (matched.length > 0)
            return orderProtectqaFirst(dedupePacks(matched));
    }
    return [protectqaFinalExpensePack];
}
function hashId(input) {
    return createHash("sha256").update(input).digest("hex").substring(0, 16);
}
function isApplicable(claim, pack) {
    const role = claim.meta?.speakerType ?? "unknown";
    const allowed = pack.appliesToRoles ?? ["agent", "supervisor"];
    return allowed.includes(role);
}
function ruleMatchesClaim(rule, claim) {
    const st = claim.meta?.speakerType ?? "unknown";
    if (rule.appliesToSpeakerTypes?.length) {
        if (!rule.appliesToSpeakerTypes.includes(st))
            return false;
    }
    return rule.patterns.some(p => p.test(claim.text));
}
function narrativeFor(rule, claim) {
    const quote = claim.text?.length > 200 ? `${claim.text.slice(0, 197)}…` : (claim.text || "");
    return {
        plainEnglishSummary: `${rule.summary}: “${quote}”`,
        whyItMatters: rule.detail,
    };
}
function defaultMissingEvidenceForType(type) {
    if (/PROTECTQA|GUARANTEE|APPROVAL|QUALIF/i.test(type))
        return ["carrier_underwriting_rule", "application_status", "product_availability"];
    if (/PRIVACY/i.test(type))
        return ["privacy_policy_excerpt"];
    if (/LICENSE/i.test(type))
        return ["agent_license_record", "state_jurisdiction"];
    if (/RATE|PRIC/i.test(type))
        return ["carrier_rate_table", "underwriting_quote"];
    if (/AI_TOOL|TOOL_USE/i.test(type))
        return ["tool_result", "api_response"];
    return ["approved_source", "policy_or_kb_citation"];
}
function recommendedActionLabel(type, severity) {
    if (/AI_/i.test(type))
        return severity === "critical" ? "AI policy update & compliance review" : "Review AI prompts & grounding";
    if (/PROTECTQA|GUARANTEE|DISCLOSURE|COMPLIANCE|HUMAN_/i.test(type))
        return "Compliance review & ProtectQA rule check";
    if (/DRIFT/i.test(type))
        return "Review approved script alignment";
    return "Conversation risk review";
}
function businessImpactFor(type) {
    if (/GUARANT|PAYOUT|RATE|FINANCE/i.test(type))
        return "Regulatory / customer-dispute risk";
    if (/PRIVACY|LICENSE/i.test(type))
        return "Regulatory risk";
    if (/AI_|HALLUCIN/i.test(type))
        return "AI reliability issue";
    if (/CHURN|OBJECTION|CONFUSION/i.test(type))
        return "Customer confusion / churn signal";
    return "Compliance or accuracy risk";
}
function makeIssue(pack, rule, claim, context) {
    const issueKey = `${pack.id}:${rule.type}:${claim.id}`;
    const issueId = hashId(`${context.runId}:${issueKey}`);
    const riskScore = rule.severity === "critical" ? 0.95 : rule.severity === "high" ? 0.85 : rule.severity === "medium" ? 0.6 : 0.4;
    const narr = narrativeFor(rule, claim);
    const missingEvidence = rule.requiredEvidence ?? defaultMissingEvidenceForType(rule.type);
    return {
        issueId: `issue_${issueId}`,
        issueKey,
        clusterKey: `compliance:${rule.type}:${pack.id}:agent`,
        clusterId: hashId(`compliance:${rule.type}:${pack.id}:agent`),
        topicId: pack.id,
        slotKey: rule.type.toLowerCase(),
        runId: context.runId,
        conversationId: context.conversationId,
        type: rule.type,
        category: /AI_/.test(rule.type) ? "compliance" : "compliance",
        severity: rule.severity,
        impact: rule.severity === "critical" ? "high" : "medium",
        riskScore,
        score: Math.round(riskScore * 100),
        confidence: 0.88,
        reviewRequired: rule.severity === "critical" || rule.severity === "high",
        verification: {
            level: context.evidenceMode === "TRANSCRIPT_PLUS_EXTERNAL" ? "EXTERNAL_VERIFIED" : "TRANSCRIPT_ONLY",
            reasonCodes: [`DOMAIN_PACK:${pack.id}`, "EVIDENCE_GAP"],
        },
        who: {
            speaker: claim.meta?.speakerType === "customer"
                ? "CUSTOMER"
                : claim.meta?.speakerType === "bot" || claim.meta?.speakerType === "system"
                    ? "SYSTEM"
                    : "AGENT",
            speakerLabel: claim.meta?.speakerLabel || claim.meta?.speaker,
            turnIndex: claim.meta?.turnIndex,
        },
        what: {
            primaryClaimId: claim.id,
            claimText: claim.text,
            issueSummary: rule.summary,
            issueDetail: rule.detail,
            saferVersion: rule.saferVersion,
            plainEnglishSummary: narr.plainEnglishSummary,
            whyItMatters: narr.whyItMatters,
            missingEvidence,
            recommendedActionLabel: recommendedActionLabel(rule.type, rule.severity),
            businessImpact: businessImpactFor(rule.type),
        },
        evidence: {
            refs: [{
                    sourceType: "TRANSCRIPT",
                    sourceId: `e-transcript-${claim.meta?.turnIndex ?? 0}`,
                    quote: claim.text,
                    turnIndex: claim.meta?.turnIndex,
                }],
            edges: [],
        },
        compliance: {
            tags: [pack.id ?? "domain", ...rule.tags, "conversation_truth_intelligence"],
            impactedPolicies: [{ policyId: (pack.domain ?? pack.id).toUpperCase(), section: rule.type }],
            disclaimers: context.evidenceMode === "TRANSCRIPT_ONLY"
                ? [`Assessment uses transcript-only ${pack.domain ?? pack.id} rules; connect policy documents for stronger evidence.`]
                : [],
        },
        scoring: {
            components: { impact01: 0.9, evidence01: 0.7, signal01: 0.85, category01: 1, verificationMultiplier: 1, risk01Raw: riskScore, risk01Final: riskScore },
            weights: { impact: 0.4, evidence: 0.3, signal: 0.2, category: 0.1 },
            reasons: [`DOMAIN_PACK:${pack.id}:${rule.type}`],
        },
        audit: { createdAt: new Date().toISOString(), engineVersion: process.env.ENGINE_VERSION || "0.3.0", scorerId: `domain-pack-${pack.id}-v${pack.version}` },
    };
}
function runRules(pack, claims, context) {
    const issues = [];
    for (const claim of claims) {
        if (!isApplicable(claim, pack))
            continue;
        for (const rule of pack.rules) {
            if (!ruleMatchesClaim(rule, claim))
                continue;
            issues.push(makeIssue(pack, rule, claim, context));
        }
        for (const phrase of pack.forbiddenPhrases) {
            if (phrase.pattern.test(claim.text))
                issues.push(makeIssue(pack, phrase, claim, context));
        }
    }
    return issues;
}
function runRequiredDisclosures(pack, claims, context) {
    const issues = [];
    const applicable = claims.filter(c => isApplicable(c, pack));
    if (applicable.length === 0)
        return issues;
    const allText = applicable.map(c => c.text).join(" \n ");
    for (const disclosure of pack.requiredDisclosures) {
        if (!disclosure.trigger.test(allText))
            continue;
        if (disclosure.disclosure.test(allText))
            continue;
        const triggerClaim = applicable.find(c => disclosure.trigger.test(c.text)) ?? applicable[0];
        issues.push(makeIssue(pack, disclosure, triggerClaim, context));
    }
    return issues;
}
export function runDomainPack(pack, claims, context) {
    const issues = [...runRules(pack, claims, context), ...runRequiredDisclosures(pack, claims, context)];
    return { packId: pack.id, issues };
}
export function runDomainPacks(packs, claims, context) {
    return packs.flatMap(pack => runDomainPack(pack, claims, context).issues);
}
registerDomainPack(protectqaFinalExpensePack);
registerDomainPack(aiChatbotPack);
registerDomainPack(customerSupportPack);
registerDomainPack(saasSalesPack);
registerDomainPack(healthcareIntakePack);
registerDomainPack(financialServicesPack);
REGISTRY.set("final_expense", protectqaFinalExpensePack);
