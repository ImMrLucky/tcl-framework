import { createHash } from "crypto";
import type { Claim, IssueV2 } from "../types.js";
import { scoreCommitmentStrength, topicKey, type CommitmentScore } from "./commitment-strength.js";

export interface DriftDetectionResult {
  driftScore: number;
  driftIssues: IssueV2[];
  driftTimeline: Array<{ turnIndex?: number; claimId: string; marker: string; text: string; topic?: string; strength?: number; band?: string }>;
}

interface AgentSignal extends CommitmentScore {
  topic: string;
}

const QUALIFIER_PATTERN = /\b(waiting period|graded benefit|modified benefit|policy terms|carrier underwriting|final approval depends|may apply|subject to)\b/i;

function isAgentRole(speakerType?: string): boolean {
  return speakerType === "agent" || speakerType === "supervisor";
}

function buildAgentSignals(claims: Claim[]): AgentSignal[] {
  return claims
    .filter(c => isAgentRole(c.meta?.speakerType))
    .map(c => ({ ...scoreCommitmentStrength(c), topic: topicKey(c.text) }))
    .sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
}

export function detectDrift(
  claims: Claim[],
  context: { runId: string; conversationId: string; evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL" }
): DriftDetectionResult {
  const agentSignals = buildAgentSignals(claims);
  const driftIssues: IssueV2[] = [];
  const driftTimeline: DriftDetectionResult["driftTimeline"] = [];
  let penalty = 0;

  // Track maximum strength seen per topic; emit drift when current claim's
  // strength jumps significantly above the prior maximum on the same topic.
  const maxStrengthByTopic = new Map<string, AgentSignal>();
  for (const signal of agentSignals) {
    const prior = maxStrengthByTopic.get(signal.topic);
    if (prior && signal.strength - prior.strength >= 0.5) {
      const detail = `On topic '${signal.topic}', commitment strength escalated from '${prior.band}' (${prior.strength.toFixed(2)}) on turn ${prior.turnIndex} to '${signal.band}' (${signal.strength.toFixed(2)}) on turn ${signal.turnIndex} without new evidence.`;
      driftIssues.push(makeDriftIssue("COMMITMENT_ESCALATION_DRIFT", claimFromSignal(signal), context, detail));
      driftTimeline.push({ turnIndex: prior.turnIndex, claimId: prior.claimId, marker: "QUALIFIED_BASELINE", text: prior.text, topic: prior.topic, strength: prior.strength, band: prior.band });
      driftTimeline.push({ turnIndex: signal.turnIndex, claimId: signal.claimId, marker: "ESCALATED_COMMITMENT", text: signal.text, topic: signal.topic, strength: signal.strength, band: signal.band });
      penalty += 30;
    }
    if (!prior || signal.strength > prior.strength) {
      maxStrengthByTopic.set(signal.topic, signal);
    }
  }

  // Disclosure-omission drift: a high-commitment agent claim on a
  // disclosure-required topic with no qualifier within the next 5 turns.
  const DISCLOSURE_REQUIRED_TOPICS = new Set(["approval", "payout", "policy_terms", "exam"]);
  for (const signal of agentSignals) {
    if (signal.strength < 0.7 || !DISCLOSURE_REQUIRED_TOPICS.has(signal.topic)) continue;
    const followups = agentSignals.filter(s => (s.turnIndex ?? 0) > (signal.turnIndex ?? 0) && (s.turnIndex ?? 0) - (signal.turnIndex ?? 0) <= 5);
    const hasQualifier = followups.some(s => QUALIFIER_PATTERN.test(s.text));
    if (!hasQualifier) {
      driftIssues.push(makeDriftIssue("DISCLOSURE_OMISSION_DRIFT", claimFromSignal(signal), context,
        `High-commitment claim on '${signal.topic}' (turn ${signal.turnIndex}) was not followed by a qualifier or disclosure within the next 5 turns.`));
      driftTimeline.push({ turnIndex: signal.turnIndex, claimId: signal.claimId, marker: "UNDISCLOSED_HIGH_COMMITMENT", text: signal.text, topic: signal.topic, strength: signal.strength, band: signal.band });
      penalty += 20;
    }
  }

  // Speaker-attribution failure: claim explicitly attributed to the agent role
  // but uses 1st-person customer language ("I have ..."), or claim attributed
  // to the customer that uses agent commitment language ("you are approved").
  for (const claim of claims) {
    const text = claim.text;
    const role = claim.meta?.speakerType;
    if (isAgentRole(role) && /\b(?:i (?:have|was|am)) (?:diabetes|cancer|surgery|been hospitalized|on oxygen|prescribed)\b/i.test(text)) {
      driftIssues.push(makeDriftIssue("SPEAKER_ATTRIBUTION_FAILURE", claim, context, "An agent-attributed claim contains first-person customer health disclosure language."));
      penalty += 20;
    }
    if (role === "customer" && /\b(?:you (?:are|'re) approved|you qualify|guaranteed approval|every carrier)\b/i.test(text)) {
      driftIssues.push(makeDriftIssue("SPEAKER_ATTRIBUTION_FAILURE", claim, context, "A customer-attributed claim contains agent commitment language."));
      penalty += 20;
    }
  }

  return {
    driftScore: Math.max(0, Math.round(100 - penalty)),
    driftIssues,
    driftTimeline,
  };
}

function claimFromSignal(signal: AgentSignal): Claim {
  return {
    id: signal.claimId,
    text: signal.text,
    confidence: 0.7,
    evidence: [],
    meta: {
      speakerType: signal.speakerType,
      turnIndex: signal.turnIndex,
    },
  };
}

function makeDriftIssue(
  type: "COMMITMENT_ESCALATION_DRIFT" | "DISCLOSURE_OMISSION_DRIFT" | "SPEAKER_ATTRIBUTION_FAILURE",
  claim: Claim,
  context: { runId: string; conversationId: string; evidenceMode: "TRANSCRIPT_ONLY" | "TRANSCRIPT_PLUS_EXTERNAL" },
  detail: string
): IssueV2 {
  const issueKey = `${type}:${claim.id}`;
  const issueId = createHash("sha256").update(`${context.runId}:${issueKey}`).digest("hex").substring(0, 16);
  return {
    issueId: `issue_${issueId}`,
    issueKey,
    clusterKey: `compliance:${type}:drift:agent`,
    clusterId: createHash("sha256").update(`compliance:${type}:drift:agent`).digest("hex").substring(0, 16),
    topicId: "drift",
    slotKey: type.toLowerCase(),
    runId: context.runId,
    conversationId: context.conversationId,
    type,
    category: "compliance",
    severity: "high",
    impact: "high",
    riskScore: 0.82,
    score: 82,
    confidence: 0.8,
    reviewRequired: true,
    verification: { level: context.evidenceMode === "TRANSCRIPT_PLUS_EXTERNAL" ? "EXTERNAL_VERIFIED" : "TRANSCRIPT_ONLY", reasonCodes: ["DRIFT_RULE"] },
    who: { speaker: claim.meta?.speakerType === "customer" ? "CUSTOMER" : "AGENT", speakerLabel: claim.meta?.speakerLabel || claim.meta?.speaker, turnIndex: claim.meta?.turnIndex },
    what: {
      primaryClaimId: claim.id,
      claimText: claim.text,
      issueSummary: type === "COMMITMENT_ESCALATION_DRIFT" ? "Commitment escalation drift" : type === "DISCLOSURE_OMISSION_DRIFT" ? "Disclosure omission drift" : "Speaker attribution failure",
      issueDetail: detail,
      plainEnglishSummary: `Drift detected: ${detail}`,
      whyItMatters:
        type === "SPEAKER_ATTRIBUTION_FAILURE"
          ? "Wrong speaker attribution breaks trust scoring and can mis-assign compliance liability."
          : "Language escalated or disclosures trailed the commitment, increasing regulatory and customer-dispute risk.",
      missingEvidence: type === "DISCLOSURE_OMISSION_DRIFT" ? ["waiting_period_disclosure", "policy_terms_reference"] : ["consistent_script_version"],
      recommendedActionLabel: type === "SPEAKER_ATTRIBUTION_FAILURE" ? "Fix diarization / transcript pipeline" : "Re-align to approved qualification + disclosure script",
      businessImpact: type === "SPEAKER_ATTRIBUTION_FAILURE" ? "Data-quality issue" : "Compliance / policy drift risk",
      saferVersion: "Use qualified eligibility language and include carrier underwriting, policy terms, and waiting-period disclosures near the relevant claim.",
    },
    evidence: { refs: [{ sourceType: "TRANSCRIPT", sourceId: `e-transcript-${claim.meta?.turnIndex ?? 0}`, quote: claim.text, turnIndex: claim.meta?.turnIndex }], edges: [] },
    compliance: { tags: ["drift", "final_expense", "insurance_sales"], impactedPolicies: [{ policyId: "FINAL_EXPENSE_SALES_PRACTICES" }], disclaimers: [] },
    scoring: {
      components: { impact01: 0.9, evidence01: 0.7, signal01: 0.85, category01: 0.9, verificationMultiplier: 1, risk01Raw: 0.82, risk01Final: 0.82 },
      weights: { impact: 0.4, evidence: 0.3, signal: 0.2, category: 0.1 },
      reasons: ["DRIFT_RULE"],
    },
    audit: { createdAt: new Date().toISOString(), engineVersion: process.env.ENGINE_VERSION || "0.2.0", scorerId: "drift-detector-v2" },
  };
}
