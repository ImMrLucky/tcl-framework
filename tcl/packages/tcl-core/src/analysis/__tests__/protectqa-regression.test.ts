import { describe, expect, it } from "vitest";
import { extractClaimsWithTypes } from "../../claim_extractor.js";
import { mapSpeakerToRole } from "../../ingestion/speaker-role.js";
import { sanitizeTranscriptForScoring } from "../../ingestion/transcript-sanitizer.js";
import { detectFinalExpenseComplianceIssues } from "../domain/final-expense-detectors.js";
import { detectHallucinations } from "../hallucination-detector.js";
import { detectDrift } from "../drift-detector.js";
import { evaluateFactualTruth } from "../factual-truth-detector.js";
import { computeRiskAdjustedScores } from "../risk-adjusted-scoring.js";

describe("ProtectQA final-expense regressions", () => {
  it("flags risky final-expense transcript as critical and prevents annotation contamination", () => {
    const transcript = `
Risk Flag: This should not become a speaker.
Issue: Annotation text should be removed.
Truthfulness: False.
Safer Version: Use carrier-dependent language.
Caller: I have diabetes and I want burial coverage.
Rep: You are approved.
Rep: Everyone qualifies and there is no risk of denial.
Rep: Every carrier will accept you.
Rep: Full death benefit from day one and your family will get paid.
Rep: Health does not matter, diabetes does not matter, and oxygen does not matter.
Rep: No medical exam ever.
Rep: I am licensed in your state.
Rep: ProtectQA has special access to underwriting rules consumers cannot get anywhere else.
`;

    const sanitized = sanitizeTranscriptForScoring(transcript);
    const extracted = extractClaimsWithTypes(transcript);
    const claims = extracted.claims;
    const finalExpenseIssues = detectFinalExpenseComplianceIssues(claims, { runId: "test", conversationId: "c", evidenceMode: "TRANSCRIPT_ONLY" });
    const hallucination = detectHallucinations(claims, { runId: "test", conversationId: "c", hasExternalEvidence: false, evidenceMode: "TRANSCRIPT_ONLY" });
    const drift = detectDrift(claims, { runId: "test", conversationId: "c", evidenceMode: "TRANSCRIPT_ONLY" });
    const allIssues = [...finalExpenseIssues, ...hallucination.issues, ...drift.driftIssues];
    const factual = evaluateFactualTruth(claims, allIssues, { hasExternalEvidence: false });
    const score = computeRiskAdjustedScores({
      profile: "protectqa",
      transcriptGrounding: 100,
      factualTruth: factual.factualTruthScore,
      compliance: Math.max(0, 100 - allIssues.filter(i => i.severity === "critical").length * 30 - allIssues.filter(i => i.severity === "high").length * 12),
      consistency: 70,
      coherence: 75,
      hallucination: hallucination.hallucinationScore,
      drift: drift.driftScore,
      issues: allIssues,
      contaminatedClaims: 0,
    });

    expect(sanitized.removedAnnotationLines).toBeGreaterThan(0);
    expect(allIssues.length).toBeGreaterThanOrEqual(8);
    expect(score.risk.level).toBe("critical");
    expect(score.risk.reviewRequired).toBe(true);
    expect(score.scores.factualTruth).toBeLessThanOrEqual(45);
    expect(score.scores.compliance).toBeLessThanOrEqual(30);
    expect(score.scores.overall).toBeLessThanOrEqual(35);
    expect(allIssues.every(i => !["Issue", "Truthfulness", "Safer Version", "Risk Flag"].includes(i.who.speakerLabel || ""))).toBe(true);
    expect(claims.every(c => !/Safer Version|Risk Flag|Truthfulness|Issue:|Customer:|Agent:/i.test(c.text))).toBe(true);
  });

  it("keeps safe ProtectQA language high scoring", () => {
    const claims = extractClaimsWithTypes(`
Caller: I want burial coverage.
Rep: You may qualify for coverage.
Rep: You could be eligible for several options.
Rep: Final approval depends on carrier underwriting and policy terms apply.
Rep: Waiting periods may apply depending on the policy.
`).claims;
    const issues = detectFinalExpenseComplianceIssues(claims, { runId: "test", conversationId: "c", evidenceMode: "TRANSCRIPT_ONLY" });
    const hallucination = detectHallucinations(claims, { runId: "test", conversationId: "c", hasExternalEvidence: false, evidenceMode: "TRANSCRIPT_ONLY" });
    const drift = detectDrift(claims, { runId: "test", conversationId: "c", evidenceMode: "TRANSCRIPT_ONLY" });
    const factual = evaluateFactualTruth(claims, [...issues, ...hallucination.issues, ...drift.driftIssues], { hasExternalEvidence: false });
    const score = computeRiskAdjustedScores({
      profile: "protectqa",
      transcriptGrounding: 100,
      factualTruth: factual.factualTruthScore,
      compliance: 100,
      consistency: 100,
      coherence: 85,
      hallucination: hallucination.hallucinationScore,
      drift: drift.driftScore,
      issues: [...issues, ...hallucination.issues, ...drift.driftIssues],
      contaminatedClaims: 0,
    });

    expect(issues.filter(i => i.severity === "critical")).toHaveLength(0);
    expect(score.scores.compliance).toBeGreaterThanOrEqual(80);
    expect(score.scores.factualTruth).toBeGreaterThanOrEqual(80);
    expect(score.scores.overall).toBeGreaterThanOrEqual(75);
  });

  it("uses canonical speaker mapping", () => {
    expect(mapSpeakerToRole("Caller").role).toBe("customer");
    expect(mapSpeakerToRole("Rep").role).toBe("agent");
    expect(mapSpeakerToRole("Lead").role).toBe("customer");
    expect(mapSpeakerToRole("Team Lead").role).toBe("supervisor");
  });

  it("removes annotation text before claim extraction", () => {
    const input = `
Risk Flag: bad
Issue: bad
Truthfulness: bad
Safer Version: bad
Agent: Final approval depends on carrier underwriting.
`;
    const sanitized = sanitizeTranscriptForScoring(input);
    const claims = extractClaimsWithTypes(input).claims;

    expect(sanitized.removedAnnotationLines).toBeGreaterThan(0);
    expect(claims.every(c => !/Risk Flag|Issue:|Truthfulness|Safer Version/i.test(c.text))).toBe(true);
  });

  it("flags unsupported authority hallucination", () => {
    const claims = extractClaimsWithTypes("Agent: ProtectQA has special access to underwriting rules consumers cannot get anywhere else.").claims;
    const result = detectHallucinations(claims, { runId: "test", conversationId: "c", hasExternalEvidence: false, evidenceMode: "TRANSCRIPT_ONLY" });
    expect(result.issues.some(i => i.type === "HALLUCINATED_AUTHORITY" && i.severity === "high")).toBe(true);
  });

  it("detects commitment escalation drift", () => {
    const claims = extractClaimsWithTypes(`
Agent: We can only estimate eligibility.
Agent: I guarantee you are approved.
`).claims;
    const result = detectDrift(claims, { runId: "test", conversationId: "c", evidenceMode: "TRANSCRIPT_ONLY" });
    expect(result.driftIssues.some(i => i.type === "COMMITMENT_ESCALATION_DRIFT")).toBe(true);
  });
});
