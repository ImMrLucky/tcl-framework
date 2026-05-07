/**
 * Commitment-Strength Scoring
 *
 * Scores how committed an agent claim is on a 0..1 scale, regardless of topic.
 * Used as the backbone of:
 *  - Drift detection (commitment escalation over time)
 *  - Disclosure-omission detection (high commitment without later qualifiers)
 *  - Compliance scoring (absolute language without evidence is high risk)
 *
 * The scorer is rule-based but ordered so that the strongest signal wins.
 */
const ABSOLUTE_CUES = [
    /\bguarantee(?:d|s)?\b/i,
    /\bdefinitely\b/i,
    /\babsolutely\b/i,
    /\bno (?:risk of )?denial\b/i,
    /\beveryone\b/i,
    /\b(?:every|all|any) (?:carrier|policy|policies|product|products)\b/i,
    /\b100\s*%\b/i,
    /\bno (?:medical )?exam ever\b/i,
    /\bno matter what\b/i,
    /\balways\b/i,
    /\bnever\b/i,
    /\bregardless of\b/i,
];
const PROMISE_CUES = [
    /\bi (?:promise|swear)\b/i,
    /\byou (?:are|'re) approved\b/i,
    /\byou qualify\b/i,
    /\byou will (?:get|receive|be)\b/i,
    /\bwe will (?:get|approve|cover)\b/i,
    /\bfull (?:death )?benefit (?:from )?day one\b/i,
    /\bfull payout immediately\b/i,
];
const ASSERTED_CUES = [
    /\byou are\b/i,
    /\bthis is\b/i,
    /\bit is\b/i,
    /\bwe (?:do|have|provide|offer)\b/i,
    /\bcoverage (?:includes|covers)\b/i,
];
const QUALIFIED_CUES = [
    /\b(?:may|might|could|should|likely|probably|typically|usually|generally|in most cases)\b/i,
    /\bdepending on\b/i,
    /\bsubject to\b/i,
    /\bif approved\b/i,
    /\bin some cases\b/i,
    /\bpolicy terms apply\b/i,
    /\bwaiting period\b/i,
    /\bgraded\b/i,
    /\bmodified\b/i,
];
const HEDGED_CUES = [
    /\bestimate\b/i,
    /\b(?:could|might) be eligible\b/i,
    /\bnot sure\b/i,
    /\bi don'?t know\b/i,
    /\blet me check\b/i,
    /\bpossibly\b/i,
];
function matches(text, patterns) {
    const cues = [];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match)
            cues.push(match[0]);
    }
    return cues;
}
export function scoreCommitmentStrength(claim) {
    const text = claim.text || "";
    const speakerType = claim.meta?.speakerType ?? "unknown";
    const absolute = matches(text, ABSOLUTE_CUES);
    if (absolute.length > 0) {
        return { claimId: claim.id, turnIndex: claim.meta?.turnIndex, text, strength: 1, band: "absolute", cues: absolute, speakerType };
    }
    const promised = matches(text, PROMISE_CUES);
    if (promised.length > 0) {
        return { claimId: claim.id, turnIndex: claim.meta?.turnIndex, text, strength: 0.85, band: "promised", cues: promised, speakerType };
    }
    const hedged = matches(text, HEDGED_CUES);
    if (hedged.length > 0) {
        return { claimId: claim.id, turnIndex: claim.meta?.turnIndex, text, strength: 0.15, band: "hedged", cues: hedged, speakerType };
    }
    const qualified = matches(text, QUALIFIED_CUES);
    if (qualified.length > 0) {
        return { claimId: claim.id, turnIndex: claim.meta?.turnIndex, text, strength: 0.35, band: "qualified", cues: qualified, speakerType };
    }
    const asserted = matches(text, ASSERTED_CUES);
    if (asserted.length > 0) {
        return { claimId: claim.id, turnIndex: claim.meta?.turnIndex, text, strength: 0.6, band: "asserted", cues: asserted, speakerType };
    }
    return { claimId: claim.id, turnIndex: claim.meta?.turnIndex, text, strength: 0.5, band: "asserted", cues: [], speakerType };
}
export function scoreCommitmentStrengthMany(claims) {
    return claims.map(scoreCommitmentStrength);
}
/**
 * Map a claim to a coarse topic key. Topic keys are intentionally simple and
 * extensible via domain packs; we only need them to detect intra-topic drift.
 */
export function topicKey(text) {
    const lower = text.toLowerCase();
    if (/\b(approval|approved|qualify|eligibility|denial)\b/.test(lower))
        return "approval";
    if (/\b(carrier|underwriting)\b/.test(lower))
        return "carrier";
    if (/\b(death benefit|payout|family will|beneficiary)\b/.test(lower))
        return "payout";
    if (/\b(coverage|policy|premium|rate|graded|modified|waiting period)\b/.test(lower))
        return "policy_terms";
    if (/\b(diabetes|cancer|heart|oxygen|hospitalization|medical|prescription|health)\b/.test(lower))
        return "health";
    if (/\b(license|state|privacy|data sharing)\b/.test(lower))
        return "license_privacy";
    if (/\b(exam|medical exam|no exam)\b/.test(lower))
        return "exam";
    return "other";
}
