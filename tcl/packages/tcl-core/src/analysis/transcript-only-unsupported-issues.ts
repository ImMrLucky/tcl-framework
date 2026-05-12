import { createHash } from "crypto";
import type { Claim, IssueV2 } from "../types.js";

const POLICY_LIKE = /\b(guarantee|guaranteed|approval|qualify|coverage|waiting period|graded|underwriting|premium|\$\d|death benefit|policy packet|emailed|sent the policy|no waiting|immediate full)\b/i;

function isAgentClaim(c: Claim): boolean {
  return c.meta?.speakerType === "agent" || c.meta?.speaker === "Agent" || c.meta?.speaker === "AGENT";
}

/**
 * High-risk agent claims in transcript-only runs are not externally provable.
 */
export function buildTranscriptOnlyUnsupportedIssues(
  claims: Claim[],
  ctx: { runId: string; conversationId: string; hasExternalEvidence: boolean }
): IssueV2[] {
  if (ctx.hasExternalEvidence) return [];

  const issues: IssueV2[] = [];
  for (const claim of claims) {
    if (!isAgentClaim(claim)) continue;
    if (!POLICY_LIKE.test(claim.text)) continue;
    if (claim.meta?.isSalient === false) continue;

    const issueKey = `unsupported_policy:${claim.id}`;
    const issueId = createHash("sha256").update(`${ctx.runId}:${issueKey}`).digest("hex").substring(0, 16);
    const strength = /\b(guarantee|guaranteed|definitely|absolutely|no waiting|immediate full)\b/i.test(claim.text)
      ? 0.88
      : 0.62;

    issues.push({
      issueId: `issue_${issueId}`,
      issueKey,
      clusterKey: `evidence:UNSUPPORTED_PRODUCT_CLAIM:${claim.id}`,
      clusterId: createHash("sha256").update(`evidence:UNSUPPORTED_PRODUCT_CLAIM:${claim.id}`).digest("hex").substring(0, 16),
      topicId: "transcript_only_support",
      slotKey: "unsupported_policy_claim",
      runId: ctx.runId,
      conversationId: ctx.conversationId,
      type: "UNSUPPORTED_PRODUCT_CLAIM",
      category: "compliance",
      severity: strength > 0.8 ? "high" : "medium",
      impact: "high",
      riskScore: strength,
      score: Math.round(strength * 100),
      confidence: strength,
      reviewRequired: true,
      verification: {
        level: "TRANSCRIPT_ONLY",
        reasonCodes: ["NO_POLICY_OR_UPLOADED_EVIDENCE"],
      },
      who: {
        speaker: "AGENT",
        speakerLabel: claim.meta?.speakerLabel,
        turnIndex: claim.meta?.turnIndex,
      },
      what: {
        primaryClaimId: claim.id,
        relatedClaimIds: [],
        claimText: claim.text,
        issueSummary: "Policy or eligibility claim lacks external evidence in this run",
        issueDetail:
          "No uploaded policy, org rule pack, or carrier document was attached to verify this statement. The transcript alone cannot substantiate coverage, approval, or pricing claims.",
        plainEnglishSummary:
          "This is a material insurance or compliance statement without document-backed support in the evaluation.",
        whyItMatters: "Regulators and disputes hinge on what can be proven against written policy and rate evidence.",
        missingEvidence: ["policy_document", "uploaded_evidence", "org_policy"],
        recommendedActionLabel: "Attach policy / rate evidence or qualify explicitly with carrier language",
        businessImpact: "Compliance and chargeback exposure",
      },
      evidence: {
        refs: [
          {
            sourceType: "TRANSCRIPT",
            sourceId: `e-transcript-${claim.meta?.turnIndex ?? 0}`,
            quote: claim.text,
            turnIndex: claim.meta?.turnIndex,
          },
        ],
        edges: [],
      },
      compliance: {
        tags: ["unsupported_policy", "transcript_only"],
        impactedPolicies: [{ policyId: "EVIDENCE_GAP" }],
        disclaimers: [],
      },
      scoring: {
        components: {
          impact01: strength,
          evidence01: 0.25,
          signal01: strength,
          category01: 0.9,
          verificationMultiplier: 0.85,
          risk01Raw: strength,
          risk01Final: strength,
        },
        weights: { impact: 0.4, evidence: 0.35, signal: 0.15, category: 0.1 },
        reasons: ["NO_EXTERNAL_EVIDENCE_FOR_POLICY_CLAIM"],
      },
      audit: {
        createdAt: new Date().toISOString(),
        engineVersion: process.env.ENGINE_VERSION || "0.2.0",
        scorerId: "transcript-only-unsupported-v1",
      },
    });
  }
  return issues;
}

const ENROLLMENT = /\b(start(?:ed)?|begin|submitted|enroll|enrollment|processing (?:the|your) application|put you in for|application is in)\b/i;
const CONSENT = /\b(i agree|yes[, ]?let'?s|let'?s do it|go ahead|i'?m ready to proceed|please proceed|sounds good[, ]?let'?s)\b/i;

/** Agent enrollment / processing language before explicit customer consent. */
export function buildEnrollmentBeforeConsentIssues(
  claims: Claim[],
  ctx: { runId: string; conversationId: string }
): IssueV2[] {
  const sorted = [...claims].sort((a, b) => (a.meta?.turnIndex ?? 0) - (b.meta?.turnIndex ?? 0));
  const consentTurns = sorted
    .filter(c => c.meta?.speakerType === "customer" && CONSENT.test(c.text))
    .map(c => c.meta?.turnIndex ?? 99999);
  if (consentTurns.length === 0) return [];

  const firstConsent = Math.min(...consentTurns);
  const out: IssueV2[] = [];

  for (const c of sorted) {
    if (!isAgentClaim(c)) continue;
    if (!ENROLLMENT.test(c.text)) continue;
    const t = c.meta?.turnIndex ?? 0;
    if (t >= firstConsent) continue;

    const issueKey = `enrollment_before_consent:${c.id}`;
    const issueId = createHash("sha256").update(`${ctx.runId}:${issueKey}`).digest("hex").substring(0, 16);
    out.push({
      issueId: `issue_${issueId}`,
      issueKey,
      clusterKey: "compliance:enrollment_before_consent",
      clusterId: createHash("sha256").update("compliance:enrollment_before_consent").digest("hex").substring(0, 16),
      topicId: "consent_timing",
      slotKey: "enrollment",
      runId: ctx.runId,
      conversationId: ctx.conversationId,
      type: "APPROVAL_BEFORE_APPLICATION",
      category: "compliance",
      severity: "high",
      impact: "high",
      riskScore: 0.82,
      score: 82,
      confidence: 0.78,
      reviewRequired: true,
      verification: { level: "TRANSCRIPT_ONLY", reasonCodes: ["ENROLLMENT_BEFORE_EXPLICIT_CONSENT"] },
      who: { speaker: "AGENT", speakerLabel: c.meta?.speakerLabel, turnIndex: c.meta?.turnIndex },
      what: {
        primaryClaimId: c.id,
        relatedClaimIds: [],
        claimText: c.text,
        issueSummary: "Enrollment or application processing referenced before explicit customer consent",
        issueDetail:
          "The agent described starting, submitting, or processing enrollment before the customer gave a clear agreement line in a later turn.",
        plainEnglishSummary: "Consent sequencing risk: enrollment language precedes explicit customer go-ahead.",
        whyItMatters: "Regulators and QA frameworks treat consent timing as a core fair-sales control.",
        recommendedActionLabel: "Obtain explicit consent before enrollment or application submission language",
        businessImpact: "UDAAP / suitability exposure",
      },
      evidence: {
        refs: [
          {
            sourceType: "TRANSCRIPT",
            sourceId: `e-transcript-${c.meta?.turnIndex ?? 0}`,
            quote: c.text,
            turnIndex: c.meta?.turnIndex,
          },
        ],
        edges: [],
      },
      compliance: { tags: ["consent", "enrollment"], impactedPolicies: [{ policyId: "CONSENT_SEQUENCE" }], disclaimers: [] },
      scoring: {
        components: {
          impact01: 0.85,
          evidence01: 0.55,
          signal01: 0.8,
          category01: 1,
          verificationMultiplier: 1,
          risk01Raw: 0.82,
          risk01Final: 0.82,
        },
        weights: { impact: 0.45, evidence: 0.25, signal: 0.2, category: 0.1 },
        reasons: ["ENROLLMENT_BEFORE_CONSENT"],
      },
      audit: {
        createdAt: new Date().toISOString(),
        engineVersion: process.env.ENGINE_VERSION || "0.2.0",
        scorerId: "enrollment-consent-v1",
      },
    });
    break;
  }
  return out;
}
