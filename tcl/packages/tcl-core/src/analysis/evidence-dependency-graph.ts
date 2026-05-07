import type { Claim, ClaimSpeakerRole, EvidenceDependencyStatus, IssueV2 } from "../types.js";

export interface EvidenceNode {
  claimId: string;
  speakerType?: ClaimSpeakerRole;
  turnIndex?: number;
  claimText: string;
  claimKind?: string;
  requiredEvidenceTypes: string[];
  presentEvidenceTypes: string[];
  missingEvidenceTypes: string[];
  status: EvidenceDependencyStatus;
}

const EVIDENCE_HINTS: Array<{ patterns: RegExp[]; required: string[] }> = [
  {
    patterns: [/\bapprove/i, /\bqualify/i, /\beligib/i],
    required: ["carrier_underwriting_rule", "application_status", "approved_policy"],
  },
  {
    patterns: [/\bdeath benefit\b/i, /\bpayout\b/i, /\bbeneficiary\b/i],
    required: ["policy_terms", "waiting_period_or_graded_terms", "premium_payment_status"],
  },
  {
    patterns: [/\blicense/i, /\bstates?\b/i],
    required: ["agent_license_record", "state_jurisdiction"],
  },
  {
    patterns: [/\bprivacy\b/i, /\bshare\b/i, /\bdata\b/i],
    required: ["privacy_policy_excerpt"],
  },
  {
    patterns: [/\bprice\b/i, /\brate\b/i, /\bpremium\b/i, /\$\d/],
    required: ["carrier_rate_table", "quote_id_or_disclosure"],
  },
  {
    patterns: [/\brefund\b/i, /\bshipment\b/i, /\btracking\b/i],
    required: ["crm_or_order_record", "policy_doc"],
  },
  {
    patterns: [/\bSOC\b/i, /\bHIPAA\b/i, /\bintegration\b/i],
    required: ["product_doc", "contract_or_security_packet"],
  },
];

function requiredForClaim(text: string): string[] {
  const out = new Set<string>(["transcript_anchor"]);
  for (const hint of EVIDENCE_HINTS) {
    if (hint.patterns.some(p => p.test(text))) hint.required.forEach(r => out.add(r));
  }
  return Array.from(out);
}

function statusForClaim(
  claim: Claim,
  hasExternal: boolean,
  issuesByClaim: Map<string, IssueV2[]>
): EvidenceDependencyStatus {
  const issues = issuesByClaim.get(claim.id) ?? [];
  if (issues.some(i => /false|CONTRADICT|NUMERIC_MISMATCH/i.test(i.type))) return "contradicted";
  if (issues.some(i => /PROTECTQA|GUARANTEE|MISLEADING|HALLUCIN/i.test(i.type) && i.severity === "critical")) return "false_by_rule";

  const externallySupported = claim.truthState === "SUPPORTED" || (claim.verification?.status === "verified");
  const hasTranscriptGrounding = (claim.evidenceRefs?.length ?? 0) > 0 || claim.grounding?.kind === "transcript";

  if (externallySupported && hasTranscriptGrounding) return "supported";
  if (externallySupported) return "partially_supported";
  if (issues.some(i => /UNSUPPORTED|UNVERIFIED|missing evidence/i.test(i.type + (i.what.issueSummary || "")))) return "unsupported";

  if (hasTranscriptGrounding) return hasExternal ? "unsupported" : "transcript_only";
  return "unverifiable";
}

export function buildEvidenceDependencyGraph(
  claims: Claim[],
  issues: IssueV2[],
  opts: { hasExternalEvidence: boolean }
): EvidenceNode[] {
  const byClaim = new Map<string, IssueV2[]>();
  for (const i of issues) {
    const cid = i.what.primaryClaimId;
    if (!cid) continue;
    const list = byClaim.get(cid) ?? [];
    list.push(i);
    byClaim.set(cid, list);
  }

  return claims.map(claim => {
    const requiredEvidenceTypes = requiredForClaim(claim.text);
    let presentEvidenceTypes: string[] = ["transcript"];
    if (opts.hasExternalEvidence && claim.truthState === "SUPPORTED") presentEvidenceTypes.push("approved_policy_or_doc");
    const status = statusForClaim(claim, opts.hasExternalEvidence, byClaim);
    let missing = requiredEvidenceTypes.filter(r => !presentEvidenceTypes.some(p => r.includes(p.split("_")[0]) || p === "approved_policy_or_doc"));
    if (status === "transcript_only" || status === "unsupported" || status === "unverifiable") {
      missing = [...new Set([...missing, ...requiredEvidenceTypes.filter(x => x !== "transcript_anchor")])];
    }
    return {
      claimId: claim.id,
      speakerType: claim.meta?.speakerType,
      turnIndex: claim.meta?.turnIndex,
      claimText: claim.text,
      claimKind: claim.claimKind,
      requiredEvidenceTypes,
      presentEvidenceTypes,
      missingEvidenceTypes: missing.slice(0, 8),
      status,
    };
  });
}

export function averageEvidenceSupportScore(nodes: EvidenceNode[], hasExternalEvidence: boolean): number {
  if (nodes.length === 0) return hasExternalEvidence ? 40 : 55;
  let sum = 0;
  for (const n of nodes) {
    switch (n.status) {
      case "supported":
        sum += 95;
        break;
      case "partially_supported":
        sum += 75;
        break;
      case "transcript_only":
        sum += hasExternalEvidence ? 45 : 62;
        break;
      case "unsupported":
        sum += 28;
        break;
      case "contradicted":
      case "false_by_rule":
        sum += 12;
        break;
      default:
        sum += 48;
    }
  }
  return Math.round(sum / nodes.length);
}

export function evidenceGapCount(nodes: EvidenceNode[]): number {
  return nodes.filter(n => n.missingEvidenceTypes.length > 2 || n.status === "unsupported" || n.status === "unverifiable").length;
}
