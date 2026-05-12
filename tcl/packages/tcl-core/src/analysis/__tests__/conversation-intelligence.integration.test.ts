import { describe, it, expect } from "vitest";
import { validate } from "../../orchestrator.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Conversation intelligence (e2e orchestrator)", () => {
  it("ProtectQA risky fixture: critical risk, bounded TCL, enriched response shape", async () => {
    const text = readFileSync(join(__dirname, "../../../examples/fixtures/protectqa-risky-short.txt"), "utf8");
    const out = await validate({
      question: "audit",
      answer: text,
      options: { spectral: false, domainPackIds: ["protectqa_final_expense"] },
    });

    expect(out.risk?.level).toBe("critical");
    expect(out.risk?.reviewRequired).toBe(true);
    expect(out.scores.tcl).toBeDefined();
    expect(out.scores.overall).toBe(out.scores.tcl);
    expect(out.scores.tcl!).toBeLessThanOrEqual(40);
    expect(out.productContext?.defaultDomain).toBe("protectqa_final_expense");
    expect(out.dashboardSummary?.dashboardMode).toBe("protectqa");
    expect(out.issuesBySeverity?.critical?.length).toBeGreaterThan(0);
    expect(out.claimsAnalysis?.length).toBeGreaterThan(0);
    expect(out.evidenceDependencyGraph?.length).toBeGreaterThan(0);
    const types = (out.report as any)?.allIssuesV2?.map((i: { type: string }) => i.type) ?? [];
    expect(types.some((t: string) => t.startsWith("PROTECTQA_"))).toBe(true);
  });

  it("ProtectQA safe fixture: high TCL, no critical issues", async () => {
    const text = readFileSync(join(__dirname, "../../../examples/fixtures/protectqa-safe-short.txt"), "utf8");
    const out = await validate({
      question: "audit",
      answer: text,
      options: { spectral: false, domainPackIds: ["protectqa_final_expense"] },
    });

    expect(out.risk?.criticalCount).toBe(0);
    expect(out.scores.tcl!).toBeGreaterThanOrEqual(70);
    expect(out.scores.compliance).toBeGreaterThanOrEqual(75);
  });
});
