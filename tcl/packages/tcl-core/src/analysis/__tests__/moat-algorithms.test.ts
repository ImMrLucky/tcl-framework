import { describe, it, expect } from "vitest";
import { scoreCommitmentStrength, topicKey } from "../commitment-strength.js";
import { runCrossTurnConsistency } from "../cross-turn-consistency.js";
import { buildExecutiveSummary } from "../executive-summary.js";
import { runDomainPack, getDomainPack } from "../../domain-packs/registry.js";
import type { Claim, IssueV2 } from "../../types.js";

const ctx = { runId: "test-run", conversationId: "test-conv", evidenceMode: "TRANSCRIPT_ONLY" as const };

function claim(id: string, text: string, opts: { speakerType?: Claim["meta"]["speakerType"]; turnIndex?: number } = {}): Claim {
  return {
    id,
    text,
    confidence: 0.8,
    evidence: [],
    meta: {
      speakerType: opts.speakerType ?? "agent",
      speaker: opts.speakerType === "customer" ? "Customer" : "Agent",
      turnIndex: opts.turnIndex,
    },
  };
}

describe("commitment-strength", () => {
  it("classifies absolute language as strength 1.0", () => {
    const score = scoreCommitmentStrength(claim("c1", "We guarantee approval and every carrier accepts you."));
    expect(score.strength).toBe(1);
    expect(score.band).toBe("absolute");
    expect(score.cues.length).toBeGreaterThan(0);
  });

  it("classifies hedged language with low strength", () => {
    const score = scoreCommitmentStrength(claim("c2", "We can only give you an estimate at this point."));
    expect(score.strength).toBeLessThan(0.3);
    expect(score.band).toBe("hedged");
  });

  it("classifies qualified language between hedged and asserted", () => {
    const score = scoreCommitmentStrength(claim("c3", "You may qualify subject to underwriting."));
    expect(score.strength).toBeGreaterThan(0.2);
    expect(score.strength).toBeLessThan(0.6);
    expect(score.band).toBe("qualified");
  });

  it("classifies promise language at 0.85", () => {
    const score = scoreCommitmentStrength(claim("c4", "I promise you are approved today."));
    expect(score.strength).toBeGreaterThanOrEqual(0.8);
  });

  it("derives stable topic keys for common claim families", () => {
    expect(topicKey("Final approval depends on carrier underwriting.")).toBe("approval");
    expect(topicKey("Death benefit is paid to the beneficiary.")).toBe("payout");
    expect(topicKey("There is no waiting period on this policy.")).toBe("policy_terms");
    expect(topicKey("My oxygen condition matters.")).toBe("health");
    expect(topicKey("I am licensed in your state.")).toBe("license_privacy");
  });
});

describe("cross-turn-consistency", () => {
  it("flags health underwriting misrepresentation when agent dismisses a customer-disclosed condition", () => {
    const claims: Claim[] = [
      claim("c1", "I have diabetes and I am on oxygen.", { speakerType: "customer", turnIndex: 1 }),
      claim("c2", "Don't worry, your health does not matter for these policies.", { speakerType: "agent", turnIndex: 2 }),
    ];
    const result = runCrossTurnConsistency(claims, ctx);
    expect(result.issues.some(i => i.type === "PROTECTQA_HEALTH_DOES_NOT_MATTER")).toBe(true);
    expect(result.consistencyScore).toBeLessThan(80);
  });

  it("flags commitment escalation when agent moves from qualified to affirmed approval", () => {
    const claims: Claim[] = [
      claim("c1", "You may qualify, but final approval depends on carrier review.", { speakerType: "agent", turnIndex: 1 }),
      claim("c2", "Actually, you are approved.", { speakerType: "agent", turnIndex: 5 }),
    ];
    const result = runCrossTurnConsistency(claims, ctx);
    expect(result.issues.some(i => i.type === "COMMITMENT_ESCALATION_DRIFT")).toBe(true);
  });

  it("does not flag issues for a fully consistent conversation", () => {
    const claims: Claim[] = [
      claim("c1", "I am 65 years old.", { speakerType: "customer", turnIndex: 1 }),
      claim("c2", "You may qualify based on your application; final approval depends on carrier underwriting.", { speakerType: "agent", turnIndex: 2 }),
    ];
    const result = runCrossTurnConsistency(claims, ctx);
    expect(result.issues.length).toBe(0);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(80);
  });

  it("flags numeric mismatch when different dollar amounts are quoted for the same idea", () => {
    const claims: Claim[] = [
      claim("c1", "The premium would be about $50 a month.", { speakerType: "agent", turnIndex: 2 }),
      claim("c2", "Your monthly premium is $30.", { speakerType: "agent", turnIndex: 6 }),
    ];
    const result = runCrossTurnConsistency(claims, ctx);
    expect(result.issues.some(i => i.type === "NUMERIC_MISMATCH")).toBe(true);
  });
});

describe("domain-pack registry", () => {
  it("loads the AI chatbot pack and detects identity fabrication", () => {
    const pack = getDomainPack("ai_chatbot");
    expect(pack).toBeTruthy();
    const claims: Claim[] = [claim("c1", "I am a licensed doctor and I remember our last conversation.", { speakerType: "agent", turnIndex: 1 })];
    const { issues } = runDomainPack(pack!, claims, ctx);
    expect(issues.some(i => i.type === "HALLUCINATED_AUTHORITY")).toBe(true);
  });

  it("AI chatbot pack triggers a financial-disclosure missing-disclosure issue when investing topics are discussed without referral", () => {
    const pack = getDomainPack("ai_chatbot");
    const claims: Claim[] = [
      claim("c1", "You should invest in tech stocks for guaranteed returns.", { speakerType: "agent", turnIndex: 1 }),
    ];
    const { issues } = runDomainPack(pack!, claims, ctx);
    expect(issues.some(i => i.type === "MISSING_REQUIRED_DISCLOSURE")).toBe(true);
  });

  it("final-expense pack triggers when 'guaranteed approval' is used", () => {
    const pack = getDomainPack("final_expense");
    expect(pack).toBeTruthy();
    const claims: Claim[] = [claim("c1", "Guaranteed approval today, no risk of denial.", { speakerType: "agent", turnIndex: 1 })];
    const { issues } = runDomainPack(pack!, claims, ctx);
    expect(issues.some(i => i.type === "PROTECTQA_GUARANTEED_APPROVAL" || i.type === "PROTECTQA_NO_RISK_OF_DENIAL")).toBe(true);
  });
});

describe("executive-summary", () => {
  it("returns trust grade F when there are critical issues", () => {
    const issue: IssueV2 = {
      issueId: "i1",
      issueKey: "k1",
      clusterKey: "ck1",
      clusterId: "cid1",
      topicId: "t1",
      slotKey: "s1",
      runId: "r",
      conversationId: "c",
      type: "GUARANTEED_APPROVAL",
      category: "compliance",
      severity: "critical",
      impact: "high",
      riskScore: 0.95,
      score: 95,
      confidence: 0.9,
      reviewRequired: true,
      verification: { level: "TRANSCRIPT_ONLY", reasonCodes: [] },
      who: { speaker: "AGENT", turnIndex: 2 },
      what: { primaryClaimId: "c1", claimText: "Guaranteed approval today.", issueSummary: "Guaranteed approval", issueDetail: "...", saferVersion: "..." },
      evidence: { refs: [], edges: [] },
      compliance: { tags: [], impactedPolicies: [], disclaimers: [] },
      scoring: { components: { impact01: 1, evidence01: 1, signal01: 1, category01: 1, verificationMultiplier: 1, risk01Raw: 1, risk01Final: 1 }, weights: { impact: 0.4, evidence: 0.3, signal: 0.2, category: 0.1 }, reasons: [] },
      audit: { createdAt: new Date().toISOString(), engineVersion: "0.2.0", scorerId: "x" },
    };
    const summary = buildExecutiveSummary({
      scores: { transcriptGrounding: 90, factualTruth: 30, compliance: 20, consistency: 60, coherence: 70, hallucination: 40, drift: 60, overall: 25, tcl: 25 },
      risk: { level: "critical", criticalCount: 2, highCount: 1, mediumCount: 0, lowCount: 0, reviewRequired: true },
      issues: [issue, { ...issue, issueId: "i2", type: "HEALTH_UNDERWRITING_MISREPRESENTATION", severity: "critical" }],
      claims: [],
      scoringCapsApplied: ["critical_compliance_overall"],
      diagnostics: { contaminatedClaims: 0, unknownSpeakerLines: 0, speakerMappingConfidence: 100 },
    });
    expect(summary.trustGrade).toBe("F");
    expect(summary.recommendedActions.length).toBeGreaterThan(0);
    expect(summary.topIssues.length).toBeGreaterThan(0);
    expect(summary.scoreBreakdown.find(s => s.label === "Compliance / policy fit")?.value).toBe(20);
  });

  it("returns trust grade A for a high-scoring clean call", () => {
    const summary = buildExecutiveSummary({
      scores: { transcriptGrounding: 95, factualTruth: 95, compliance: 95, consistency: 95, coherence: 95, hallucination: 95, drift: 95, overall: 95, tcl: 95 },
      risk: { level: "low", criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, reviewRequired: false },
      issues: [],
      claims: [],
      scoringCapsApplied: [],
      diagnostics: { contaminatedClaims: 0, unknownSpeakerLines: 0, speakerMappingConfidence: 100 },
    });
    expect(summary.trustGrade).toBe("A");
    expect(summary.highlights.length).toBeGreaterThan(0);
  });
});
