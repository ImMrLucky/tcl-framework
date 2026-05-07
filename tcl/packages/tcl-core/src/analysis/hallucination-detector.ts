import type { Claim, IssueV2 } from "../types.js";
import { createHash } from "crypto";

export type HallucinationClassification =
  | "supported_by_external_policy"
  | "supported_by_transcript_only"
  | "unsupported_specific_claim"
  | "unverifiable_absolute_claim"
  | "fabricated_authority_claim";

export interface HallucinationDetectionResult {
  hallucinationScore: number;
  issues: IssueV2[];
  classifications: Array<{ claimId: string; classification: HallucinationClassification; penalty: number }>;
}

export function detectHallucinations(
  claims: Claim[],
  context: { runId: string; conversationId: string; hasExternalEvidence: boolean; evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL" }
): HallucinationDetectionResult {
  const classifications: HallucinationDetectionResult["classifications"] = [];
  const issueSeedClaims: Claim[] = [];
  let penalty = 0;

  for (const claim of claims.filter(isAgentClaim)) {
    const text = claim.text;
    const lower = text.toLowerCase();
    let classification: HallucinationClassification | null = null;
    let claimPenalty = 0;

    if (/special access to underwriting rules|cannot get anywhere else|licensed in your state|licensed in all states/i.test(text) && !context.hasExternalEvidence) {
      classification = "fabricated_authority_claim";
      claimPenalty = 35;
    } else if (/\b(every carrier|all policies|any carrier|always|never)\b/i.test(text) && !context.hasExternalEvidence) {
      classification = "unverifiable_absolute_claim";
      claimPenalty = 25;
    } else if (/\b(product|policy|rate|premium|approval|eligibility|underwriting|carrier)\b/i.test(lower) && !context.hasExternalEvidence) {
      classification = "unsupported_specific_claim";
      claimPenalty = 15;
    } else if (/\b(privacy|security|share|sell)\b/i.test(lower) && !context.hasExternalEvidence) {
      classification = "unsupported_specific_claim";
      claimPenalty = 15;
    } else if (/(may qualify|could be eligible|final approval depends|policy terms apply|waiting periods may apply)/i.test(text)) {
      classification = "supported_by_transcript_only";
    }

    if (classification && claimPenalty > 0) {
      classifications.push({ claimId: claim.id, classification, penalty: claimPenalty });
      penalty += claimPenalty;
      issueSeedClaims.push({ ...claim, text: text.includes("special access") ? text : `Unsupported product claim: ${text}` });
    }
  }

  const issues = issueSeedClaims.map(claim => {
    const isAuthority = /special access|cannot get anywhere else|licensed/i.test(claim.text);
    return makeHallucinationIssue(claim, isAuthority, context);
  });

  return {
    hallucinationScore: Math.max(0, Math.round(100 - penalty)),
    issues,
    classifications,
  };
}

function isAgentClaim(claim: Claim): boolean {
  return claim.meta?.speakerType === "agent" || claim.meta?.speaker === "Agent" || claim.meta?.speaker === "AGENT";
}

function makeHallucinationIssue(
  claim: Claim,
  isAuthority: boolean,
  context: { runId: string; conversationId: string; evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL" }
): IssueV2 {
  const type = isAuthority ? "HALLUCINATED_AUTHORITY" : "UNSUPPORTED_PRODUCT_CLAIM";
  const issueKey = `${type}:${claim.id}`;
  const issueId = createHash("sha256").update(`${context.runId}:${issueKey}`).digest("hex").substring(0, 16);
  const cleanText = claim.text.replace(/^Unsupported product claim:\s*/i, "");

  return {
    issueId: `issue_${issueId}`,
    issueKey,
    clusterKey: `compliance:${type}:hallucination:agent`,
    clusterId: createHash("sha256").update(`compliance:${type}:hallucination:agent`).digest("hex").substring(0, 16),
    topicId: "hallucination",
    slotKey: type.toLowerCase(),
    runId: context.runId,
    conversationId: context.conversationId,
    type,
    category: "compliance",
    severity: "high",
    impact: "high",
    riskScore: 0.85,
    score: 85,
    confidence: 0.82,
    reviewRequired: true,
    verification: { level: context.evidenceMode === "TRANSCRIPT_PLUS_EXTERNAL" ? "EXTERNAL_VERIFIED" : "TRANSCRIPT_ONLY", reasonCodes: ["UNSUPPORTED_EXTERNAL_FACT"] },
    who: { speaker: "AGENT", speakerLabel: claim.meta?.speakerLabel || claim.meta?.speaker, turnIndex: claim.meta?.turnIndex },
    what: {
      primaryClaimId: claim.id,
      claimText: cleanText,
      issueSummary: isAuthority ? "Unsupported authority claim" : "Unsupported product or carrier claim",
      issueDetail: isAuthority
        ? "The agent claimed special access, licensing, or authority without supporting evidence."
        : "The agent made a product, rate, carrier, or eligibility claim without external support.",
      plainEnglishSummary: isAuthority
        ? `The speaker claimed authority or special access without documentation: “${cleanText.slice(0, 180)}${cleanText.length > 180 ? "…" : ""}”`
        : `A specific product, rate, or carrier claim was made without an approved source: “${cleanText.slice(0, 180)}${cleanText.length > 180 ? "…" : ""}”`,
      whyItMatters:
        "Unsupported statements increase hallucination risk, mis-set customer expectations, and weaken audit defensibility.",
      missingEvidence: isAuthority ? ["license_record", "carrier_verification"] : ["carrier_file", "rate_table", "product_sheet"],
      recommendedActionLabel: "Attach evidence sources or rewrite with qualified language",
      businessImpact: "AI reliability / customer-dispute risk",
      saferVersion: isAuthority
        ? "I can provide verifiable licensing or carrier information before relying on that claim."
        : "Available products, rates, and eligibility depend on carrier underwriting and policy terms.",
    },
    evidence: { refs: [{ sourceType: "TRANSCRIPT", sourceId: `e-transcript-${claim.meta?.turnIndex ?? 0}`, quote: cleanText, turnIndex: claim.meta?.turnIndex }], edges: [] },
    compliance: { tags: ["hallucination_risk", "final_expense", "insurance_sales"], impactedPolicies: [{ policyId: "EVIDENCE_SUPPORT" }], disclaimers: [] },
    scoring: {
      components: { impact01: 1, evidence01: 0.5, signal01: 0.8, category01: 0.9, verificationMultiplier: 1, risk01Raw: 0.85, risk01Final: 0.85 },
      weights: { impact: 0.4, evidence: 0.3, signal: 0.2, category: 0.1 },
      reasons: ["UNSUPPORTED_EXTERNAL_FACT"],
    },
    audit: { createdAt: new Date().toISOString(), engineVersion: process.env.ENGINE_VERSION || "0.2.0", scorerId: "hallucination-detector-v1" },
  };
}
