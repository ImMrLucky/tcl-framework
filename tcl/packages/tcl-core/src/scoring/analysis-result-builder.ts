import type {
  AnalysisIssueV2,
  AnalysisResultPayload,
  Claim,
  ClaimTimelineEventV2,
  ContradictionEdge,
  EvidenceCoverageStatsV2,
  EvidenceRefViewV2,
  IssueV2,
} from "../types.js";
import type { IndustryTemplateDefinition } from "../templates/template-types.js";
import type { RiskAdjustedScoreResult } from "../analysis/risk-adjusted-scoring.js";
import { calibrateAnalysisConfidence } from "./confidence-calibration.js";
import { buildComplianceMetric } from "./compliance-score.js";
import { buildContradictionMetric } from "./contradiction-score.js";
import { buildDriftMetric } from "./drift-score.js";
import { buildEvidenceCoverageMetric } from "./evidence-score.js";
import { buildGroundingMetric } from "./grounding-score.js";
import { buildHallucinationMetric } from "./hallucination-score.js";
import { buildIntegrityCompositeMetric } from "./composite-score.js";
import { enrichIssuesWithEvidence } from "./enrich-issues-evidence.js";

function mapLegacyRefToView(ref: Record<string, unknown>, idx: number): EvidenceRefViewV2 {
  const st = String(ref.sourceType || "TRANSCRIPT");
  const mapped =
    st === "POLICY" || st === "DOC"
      ? "policy_document"
      : st === "SYSTEM_FACT"
        ? "algorithmic_signal"
        : "transcript";
  return {
    id: `ref-${idx}-${String(ref.sourceId ?? idx)}`,
    sourceType: mapped,
    sourceId: ref.sourceId as string | undefined,
    textSnippet: ref.quote as string | undefined,
    turnIndex: ref.turnIndex as number | undefined,
    matchType: "exact",
    matchScore: ref.weight as number | undefined,
    supportsOrContradicts: "neutral",
  };
}

function toAnalysisIssue(issue: IssueV2, idx: number): AnalysisIssueV2 {
  const refs = (issue.evidence?.refs ?? []).map((r, i) => mapLegacyRefToView(r as Record<string, unknown>, i));
  const graphSignals: string[] = [];
  if (issue.evidence?.edges?.length) graphSignals.push(`edges:${issue.evidence.edges.length}`);
  if (issue.scoring?.reasons?.length) graphSignals.push(...issue.scoring.reasons.slice(0, 4));
  return {
    id: issue.issueId || `issue-${idx}`,
    title: issue.what.issueSummary,
    severity: issue.severity,
    category: issue.category,
    issueType: issue.type,
    score: typeof issue.score === "number" ? issue.score : Math.round((issue.riskScore ?? 0) * 100),
    confidence: issue.confidence,
    summary: issue.what.plainEnglishSummary || issue.what.issueSummary,
    flaggedClaim: issue.what.claimText,
    evidenceRefs: refs,
    relatedClaimIds: issue.what.relatedClaimIds,
    graphSignals,
    scoringBreakdown: issue.scoring,
    recommendedAction: issue.what.recommendedActionLabel || issue.recommendedAction?.explanation,
    customerImpact: issue.what.businessImpact,
    complianceImpact: issue.compliance?.impactedPolicies?.map(p => p.policyId).join(", "),
    modelBehaviorImpact: /AI_/i.test(issue.type) ? "AI/automation reliability" : undefined,
  };
}

function buildClaimTimeline(issues: IssueV2[], claims: Claim[]): ClaimTimelineEventV2[] {
  const out: ClaimTimelineEventV2[] = [];
  for (const c of claims) {
    const related = issues.filter(i => i.what.primaryClaimId === c.id);
    let label: ClaimTimelineEventV2["label"] = "claimed";
    if (related.some(i => /CONTRADICT|CONTRADICTION/i.test(i.type))) label = "contradicted";
    else if (related.some(i => /DRIFT|COMMITMENT_ESCALATION/i.test(i.type))) label = "drifted";
    else if (related.some(i => /UNSUPPORTED|UNVERIFIED|UNGROUNDED/i.test(i.type))) label = "unsupported";
    else if (related.length > 1) label = "flagged";
    out.push({
      claimId: c.id,
      turnIndex: c.meta?.turnIndex,
      label,
      textPreview: c.text.length > 120 ? `${c.text.slice(0, 117)}…` : c.text,
    });
  }
  return out.slice(0, 80);
}

export function buildAnalysisResultPayload(args: {
  industry: IndustryTemplateDefinition;
  graphTemplateId: string;
  domainPackIds: string[];
  riskAdjusted: RiskAdjustedScoreResult;
  truthSummary: { supported: number; contradicted: number; unverified: number; ungrounded: number; total: number };
  claims: Claim[];
  detectorIssues: IssueV2[];
  hasExternalEvidence: boolean;
  contradictionEdges: number;
  crossTurnPairs: number;
  driftScore: number;
  driftIssues: number;
  hallucinationIssues: number;
  transcriptQuality01: number;
  speakerConfidence01: number;
  contradictionClarity01: number;
  contradictionEdgePairs?: ContradictionEdge[];
  salientClaimCount?: number;
  unsupportedProductClaimIssueCount?: number;
}): AnalysisResultPayload {
  const enriched = enrichIssuesWithEvidence(args.detectorIssues, args.claims);
  const criticalCompliance = enriched.filter(i => i.severity === "critical" && i.category === "compliance").length;
  const conf = calibrateAnalysisConfidence({
    transcriptQuality01: args.transcriptQuality01,
    speakerConfidence01: args.speakerConfidence01,
    hasExternalEvidence: args.hasExternalEvidence,
    evidenceMatchStrength01: Math.min(
      1,
      args.truthSummary.supported / Math.max(1, args.truthSummary.total) + (args.hasExternalEvidence ? 0.25 : 0)
    ),
    contradictionClarity01: args.contradictionClarity01,
    ruleSpecificity01: Math.min(1, Object.keys(args.industry.scoringWeights).length / 6),
    supportingSignals: args.truthSummary.supported + args.truthSummary.unverified,
    conflictingSignals: args.truthSummary.contradicted + args.contradictionEdges,
  });

  const evidenceStats: EvidenceCoverageStatsV2 = {
    claimsExtracted: args.claims.length,
    supported: args.truthSummary.supported,
    unverified: args.truthSummary.unverified,
    ungrounded: args.truthSummary.ungrounded,
    contradicted: args.truthSummary.contradicted,
    sourcesUsed: [
      { sourceType: "transcript", count: args.truthSummary.total },
      ...(args.hasExternalEvidence ? [{ sourceType: "uploaded_evidence", count: 1 }] : []),
      { sourceType: "industry_template", count: 1 },
    ],
  };

  const integrity = buildIntegrityCompositeMetric({
    tcl0to100: args.riskAdjusted.scores.tcl,
    weights: args.industry.scoringWeights,
    factualTruth: args.riskAdjusted.scores.factualTruth,
    consistency: args.riskAdjusted.scores.consistency,
    evidenceSupport: args.riskAdjusted.scores.evidenceSupport,
    confidence: conf,
  });

  const complianceRisk = buildComplianceMetric(args.riskAdjusted.scores.compliance, criticalCompliance, conf);

  const hallucinationRisk = buildHallucinationMetric(
    args.riskAdjusted.scores.hallucination,
    args.hallucinationIssues,
    conf
  );

  const drift = buildDriftMetric({
    driftScore0to100: args.driftScore,
    driftIssues: args.driftIssues,
    confidence: conf,
  });

  const evidenceCoverage = buildEvidenceCoverageMetric({
    supported: args.truthSummary.supported,
    contradicted: args.truthSummary.contradicted,
    unverified: args.truthSummary.unverified,
    ungrounded: args.truthSummary.ungrounded,
    total: args.truthSummary.total,
    hasExternalEvidence: args.hasExternalEvidence,
    confidence: conf,
  });

  const transcriptQuality = buildGroundingMetric(args.riskAdjusted.scores.transcriptGrounding, conf);

  const graphConflict = buildContradictionMetric({
    contradictionEdges: args.contradictionEdges,
    claims: args.claims.length,
    crossTurnPairs: args.crossTurnPairs,
    confidence: conf,
  });

  const issuesEnriched = enriched.map(toAnalysisIssue);

  return {
    schemaVersion: "3.0.0",
    industryTemplateId: args.industry.id,
    graphTemplateId: args.graphTemplateId,
    domainPackIds: args.domainPackIds,
    integrity,
    complianceRisk,
    hallucinationRisk,
    drift,
    evidenceCoverage,
    transcriptQuality,
    graphConflict,
    issuesEnriched,
    issuesV2: enriched,
    evidenceCoverageStats: evidenceStats,
    claimTimeline: buildClaimTimeline(enriched, args.claims),
    templatePanel: {
      selectedTemplateId: args.industry.id,
      selectedTemplateName: args.industry.name,
      graphTemplateId: args.graphTemplateId,
      rulesSignalsApplied: [...args.industry.riskCategories, ...args.industry.claimTypesToWatch.slice(0, 6)],
      confidenceImpactNote:
        "Template weights adjust how much compliance vs. integrity moves the composite; they do not inject fixed confidence constants.",
    },
    contradictionEdgePairs: args.contradictionEdgePairs,
    salientClaimCount: args.salientClaimCount ?? args.claims.filter(c => c.meta?.isSalient !== false).length,
    unsupportedProductClaimIssues: args.unsupportedProductClaimIssueCount ?? 0,
  };
}
