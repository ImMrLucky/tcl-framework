import type { Claim, ContradictionEdge } from "../types.js";

const WAITING_IMMEDIATE =
  /\b(no waiting period|no waiting|immediate full coverage|full coverage immediately|from day one|day one coverage|no graded|zero waiting|coverage starts immediately|starts immediately for you)\b/i;
const WAITING_QUALIFIED = /\b(waiting period|graded period|graded benefit|may be a graded|not on every plan|unless.*graded|two[- ]year|contestab)\b/i;

const APPROVAL_GUARANTEE = /\b(guaranteed approval|guarantee approval|definitely qualify|fully approved|you are approved|you'?re approved|everyone qualifies|no denial)\b/i;
const APPROVAL_UNDERWRITING = /\b(health review|underwriting|carrier review|may not qualify|depends on|final approval|approval unless|not guaranteed)\b/i;

const PACKET_SENT = /\b(already (?:emailed|sent)|i (?:emailed|sent)|we (?:emailed|sent)|sent (?:you )?the (?:full )?policy|policy packet (?:is )?on the way|full policy packet)\b/i;
const PACKET_NOT_SENT = /\b(haven'?t (?:actually )?sent|not sent yet|didn'?t send|will send after|haven'?t sent|not actually sent)\b/i;

const BENEFIT_FULL_NOW = /\b(full death benefit immediately|absolutely full benefit|full payout immediately|100% of the benefit right away)\b/i;
const BENEFIT_GRADED = /\b(graded clause|unless graded|waiting period may apply|reduced benefit|partial benefit first years)\b/i;

function orderedClaims(claims: Claim[]): Claim[] {
  return [...claims].sort((a, b) => (a.meta?.turnIndex ?? 0) - (b.meta?.turnIndex ?? 0));
}

function edge(a: string, b: string, weight: number, reason: string): ContradictionEdge {
  const [claimA, claimB] = [a, b].sort();
  return {
    claimA,
    claimB,
    weight,
    contradictionType: "direct",
    reasonCodes: [reason],
  };
}

/**
 * Deterministic cross-turn contradictions when the unified graph misses
 * slot alignment (common on insurance sales transcripts).
 */
export function buildDeterministicContradictionEdges(claims: Claim[]): ContradictionEdge[] {
  const out: ContradictionEdge[] = [];
  const list = orderedClaims(claims);
  const seen = new Set<string>();

  const push = (e: ContradictionEdge) => {
    const k = `${e.claimA}|${e.claimB}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const ta = a.text;
      const tb = b.text;

      if (WAITING_IMMEDIATE.test(ta) && WAITING_QUALIFIED.test(tb)) {
        push(edge(a.id, b.id, 0.9, "DET_WAITING_PERIOD"));
      } else if (WAITING_IMMEDIATE.test(tb) && WAITING_QUALIFIED.test(ta)) {
        push(edge(a.id, b.id, 0.9, "DET_WAITING_PERIOD"));
      }

      if (APPROVAL_GUARANTEE.test(ta) && APPROVAL_UNDERWRITING.test(tb)) {
        push(edge(a.id, b.id, 0.92, "DET_APPROVAL_UNDERWRITING"));
      } else if (APPROVAL_GUARANTEE.test(tb) && APPROVAL_UNDERWRITING.test(ta)) {
        push(edge(a.id, b.id, 0.92, "DET_APPROVAL_UNDERWRITING"));
      }

      if (PACKET_SENT.test(ta) && PACKET_NOT_SENT.test(tb)) {
        push(edge(a.id, b.id, 0.93, "DET_POLICY_PACKET_SENT"));
      } else if (PACKET_SENT.test(tb) && PACKET_NOT_SENT.test(ta)) {
        push(edge(a.id, b.id, 0.93, "DET_POLICY_PACKET_SENT"));
      }

      if (BENEFIT_FULL_NOW.test(ta) && BENEFIT_GRADED.test(tb)) {
        push(edge(a.id, b.id, 0.88, "DET_DEATH_BENEFIT_GRADED"));
      } else if (BENEFIT_FULL_NOW.test(tb) && BENEFIT_GRADED.test(ta)) {
        push(edge(a.id, b.id, 0.88, "DET_DEATH_BENEFIT_GRADED"));
      }
    }
  }

  return out;
}
