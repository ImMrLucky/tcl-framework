import { Claim, Source, ValidateOutput } from "./types";
import { LLMAdapter } from "./adapters/llm_adapter";

export function collectFailingClaimIds(report: ValidateOutput["report"]): string[] {
  const failing = new Set<string>();

  for (const v of report.violations) {
    if (v.type === "MISSING_EVIDENCE") failing.add(v.claimId);
    if (v.type === "LOW_CONFIDENCE") failing.add(v.claimId);
    if (v.type === "CONTRADICTION") {
      failing.add(v.claimA);
      failing.add(v.claimB);
    }
  }

  return [...failing];
}

export async function repairOnce(params: {
  adapter: LLMAdapter;
  question: string;
  originalAnswer: string;
  claims: Claim[];
  sources?: Source[];
  failingClaimIds: string[];
  requireCitations: boolean;
}): Promise<{ repairedAnswer: string; notes: string[] }> {
  const { adapter, question, originalAnswer, claims, sources, failingClaimIds, requireCitations } = params;

  return adapter.repairOnePass({
    question,
    originalAnswer,
    claims,
    sources,
    failingClaimIds,
    policy: {
      requireCitations,
      allowHedging: true,
      maxAnswerChars: 2000
    }
  });
}
