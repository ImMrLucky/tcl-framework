import { Claim, Violation } from "./types.js";

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function isNegationPair(a: string, b: string): boolean {
  const A = normalize(a);
  const B = normalize(b);

  const notA = A.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");
  const notB = B.replace(/\bis not\b/g, "is").replace(/\bnot\b/g, "");

  return normalize(notA) === normalize(B) || normalize(notB) === normalize(A);
}

export function findLogicViolations(claims: Claim[]): {
  violations: Violation[];
  contradictions: { claimA: string; claimB: string; reason: string }[];
  consistencyScore: number;
} {
  const violations: Violation[] = [];
  const contradictions: { claimA: string; claimB: string; reason: string }[] = [];

  let contradictionCount = 0;

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      if (isNegationPair(claims[i].text, claims[j].text)) {
        contradictionCount++;
        contradictions.push({
          claimA: claims[i].id,
          claimB: claims[j].id,
          reason: "Negation-style contradiction detected."
        });
        violations.push({
          type: "CONTRADICTION",
          claimA: claims[i].id,
          claimB: claims[j].id,
          detail: "Two claims appear to be logical negations."
        });
      }
    }
  }

  const base = 100;
  const penalty = Math.min(100, contradictionCount * 25);
  const consistencyScore = Math.max(0, base - penalty);

  return { violations, contradictions, consistencyScore };
}
