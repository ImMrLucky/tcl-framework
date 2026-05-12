import type { Claim, IssueV2 } from "../types.js";

/**
 * Ensure every issue has at least one evidence ref (transcript anchor or explicit algorithmic signal).
 */
export function enrichIssuesWithEvidence(issues: IssueV2[], claims: Claim[]): IssueV2[] {
  const byId = new Map(claims.map(c => [c.id, c]));
  return issues.map(issue => {
    const existing = issue.evidence?.refs?.filter(Boolean) ?? [];
    if (existing.length > 0) {
      return issue;
    }
    const claim = issue.what?.primaryClaimId ? byId.get(issue.what.primaryClaimId) : undefined;
    const quote = (claim?.text || issue.what?.claimText || "").trim();
    const turn = claim?.meta?.turnIndex ?? issue.who?.turnIndex;
    if (quote.length > 0) {
      return {
        ...issue,
        evidence: {
          ...issue.evidence,
          refs: [
            {
              sourceType: "TRANSCRIPT",
              sourceId: `e-transcript-${turn ?? 0}`,
              quote: quote.length > 400 ? `${quote.slice(0, 397)}…` : quote,
              turnIndex: turn,
            },
          ],
          edges: issue.evidence?.edges ?? [],
        },
      };
    }
    return {
      ...issue,
      evidence: {
        ...issue.evidence,
        refs: [
          {
            sourceType: "TRANSCRIPT",
            sourceId: "e-signal-only",
            quote: "No supporting transcript quote captured — issue driven by algorithmic signals over the claim graph.",
            turnIndex: turn,
          },
        ],
        edges: issue.evidence?.edges ?? [],
      },
      compliance: {
        ...issue.compliance,
        disclaimers: [
          ...(issue.compliance?.disclaimers ?? []),
          "No supporting evidence snippet was attached; review the claim id and turn context in the structured issue payload.",
        ],
      },
    };
  });
}
