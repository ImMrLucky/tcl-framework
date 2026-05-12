import { describe, expect, it } from "vitest";
import { validate } from "../../orchestrator.js";
import { getIndustryTemplate } from "../../templates/template-registry.js";
import { buildContradictionMetric } from "../../scoring/contradiction-score.js";

describe("Parts 3–11 acceptance (core)", () => {
  it("detects contradiction between immediate coverage and waiting period", async () => {
    const transcript = `
Agent: Coverage starts immediately for you today.
Customer: Great.
Agent: There is a two-year waiting period on the graded benefit before the full face amount applies.
`.trim();
    const out = await validate({
      question: "call",
      answer: transcript,
      options: { spectral: false, analysisTemplateId: "general_conversation_integrity" },
    });
    const contradictions = out.report?.graph?.contradictions?.length ?? 0;
    const issues = out.analysisResult?.issuesV2?.length ?? out.report?.allIssuesV2?.length ?? 0;
    expect(contradictions + issues).toBeGreaterThan(0);
  });

  it("unsupported / compliance-style issue when claiming guaranteed approval without evidence", async () => {
    const out = await validate({
      question: "x",
      answer: "Agent: The carrier guarantees approval for everyone before underwriting.\nCustomer: Ok.",
      options: { spectral: false, analysisTemplateId: "final_expense", domainPackIds: ["protectqa_final_expense"] },
    });
    const types = (out.analysisResult?.issuesV2 ?? []).map(i => i.type);
    expect(types.some(t => /PROTECTQA|GUARANT|COMPLIANCE|UNVERIFIED/i.test(t))).toBe(true);
  });

  it("false completion: completed then retracted", async () => {
    const out = await validate({
      question: "x",
      answer:
        "Agent: I have completed filing your claim in the system.\nCustomer: Thanks.\nAgent: Actually I was not able to complete it yet.",
      options: { spectral: false },
    });
    const issues = out.analysisResult?.issuesV2 ?? [];
    const hit = issues.some(i => /TASK|COMPLETION|DRIFT|FALSE|UNVERIFIED/i.test(i.type + i.what.issueSummary));
    expect(hit).toBe(true);
  });

  it("template isolation: customer support transcript should not load final expense pack by default", async () => {
    const out = await validate({
      question: "x",
      answer: "Agent: Your support ticket is closed and here is your tracking number 12345.",
      options: { spectral: false, analysisTemplateId: "customer_support" },
    });
    const packs = out.productContext?.domainPacksApplied ?? [];
    expect(packs.includes("protectqa_final_expense")).toBe(false);
  });

  it("evidence coverage stats align with truth summary buckets", async () => {
    const out = await validate({
      question: "x",
      answer: "Agent: I promise we guarantee you are approved.",
      options: { spectral: false, analysisTemplateId: "final_expense", domainPackIds: ["protectqa_final_expense"] },
    });
    const s = out.analysisResult?.evidenceCoverageStats;
    expect(s).toBeDefined();
    const t = s!.claimsExtracted;
    expect(s!.supported + s!.unverified + s!.ungrounded + s!.contradicted).toBe(t);
  });

  it("evidence support: claim gets transcript ref when issue has no refs", async () => {
    const out = await validate({
      question: "x",
      answer: "Agent: I promise we guarantee you are approved.",
      options: { spectral: false, analysisTemplateId: "final_expense", domainPackIds: ["protectqa_final_expense"] },
    });
    const first = out.analysisResult?.issuesEnriched?.[0];
    expect(first?.evidenceRefs?.length ?? 0).toBeGreaterThan(0);
  });

  it("scoring modules do not return flat 0.88 confidence for graph contradiction metric", () => {
    const m = buildContradictionMetric({
      contradictionEdges: 2,
      claims: 10,
      crossTurnPairs: 1,
      confidence: 0.55,
    });
    expect(m.confidence).toBe(0.55);
    expect(m.components.length).toBeGreaterThan(0);
  });

  it("industry registry default is general", () => {
    expect(getIndustryTemplate(undefined).id).toBe("general_conversation_integrity");
  });
});
