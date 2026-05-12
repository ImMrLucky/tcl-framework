import { describe, expect, it } from "vitest";
import { validate } from "../../orchestrator.js";
import { normalizeTranscript } from "../../graph/transcript-normalizer.js";

const FINAL_EXPENSE_RISKY_TRANSCRIPT = `
[00:10] Agent Sarah: Great.
[00:16] Customer: That's fine.
[00:22] Agent Sarah: All plans begin full coverage immediately on day one with no waiting periods for final expense coverage.
[00:45] Customer: Okay.
[01:02] Agent Sarah: There may be a graded period on some plans depending on carrier underwriting.
[01:20] Agent Sarah: You have guaranteed approval today; everyone qualifies before we even submit health questions.
[01:55] Agent Sarah: There is still a health review process and final approval depends on carrier underwriting.
[02:10] Agent Sarah: I already emailed you the full policy packet with all disclosures before this call.
[02:40] Agent Sarah: I haven't actually sent the packet yet; I will send it right after we finish.
[03:00] Agent Sarah: Your family will absolutely receive the full death benefit immediately from day one.
[03:30] Agent Sarah: Unless a graded clause applies, the full face may not be payable in the first two years on some states.
[03:55] Agent Sarah: I'm starting your enrollment and submitting the application now.
[04:20] Customer: I agree, let's proceed with the plan you described.
`.trim();

describe("Final expense / ProtectQA pipeline regression", () => {
  it("parses timestamped lines with Agent Sarah and Customer", () => {
    const turns = normalizeTranscript(FINAL_EXPENSE_RISKY_TRANSCRIPT);
    const labels = turns.map(t => t.speakerLabelRaw);
    expect(labels.some(l => /sarah/i.test(l))).toBe(true);
    expect(labels.some(l => /^customer$/i.test(l))).toBe(true);
    expect(turns.some(t => Boolean(t.timestampBracket))).toBe(true);
    expect(turns.filter(t => t.speakerType === "unknown").length).toBeLessThan(turns.length * 0.5);
  });

  it("produces contradictions, unsupported issues, and non-trivial scores", async () => {
    const out = await validate({
      question: "call",
      answer: FINAL_EXPENSE_RISKY_TRANSCRIPT,
      options: {
        spectral: false,
        analysisTemplateId: "final_expense",
        domainPackIds: ["protectqa_final_expense"],
      },
    });
    const claims = out.report?.claims ?? [];
    const contradictions = out.report?.graph?.contradictions ?? [];
    const issues = out.report?.allIssuesV2 ?? out.analysisResult?.issuesV2 ?? [];

    const unknownSpeakers = claims.filter(
      c => c.meta?.speaker === "Unknown" || c.meta?.speakerType === "unknown"
    ).length;

    expect(claims.length).toBeGreaterThan(0);
    expect(unknownSpeakers).toBeLessThan(claims.length);

    expect(contradictions.length).toBeGreaterThanOrEqual(3);
    expect(issues.length).toBeGreaterThanOrEqual(5);

    const unsupported = issues.filter(i => i.type === "UNSUPPORTED_PRODUCT_CLAIM");
    expect(unsupported.length).toBeGreaterThanOrEqual(2);

    const truth = out.scores?.truth ?? 100;
    const compliance = out.scores?.compliance ?? 100;
    const hall = out.scores?.hallucination ?? 100;
    const overall = out.scores?.overall ?? out.scores?.tcl ?? 100;

    expect(truth).toBeLessThan(100);
    expect(compliance).toBeLessThan(100);
    expect(hall).toBeLessThan(100);
    expect(overall).toBeLessThan(85);
  });
});
