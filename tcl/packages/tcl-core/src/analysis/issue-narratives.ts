/**
 * Issue Narrative Builder
 * 
 * Converts claims + edges + spectral data into QA-Manager Grade IssueNarratives.
 * All narrative text comes from config templates - NO hard-coded text.
 */

import type {
  Claim,
  IssueNarrative,
  EvidenceQuote,
  ContradictionPair,
  SpectralReport,
  DestructiveClaim,
} from "../types.js";
import type { ContradictionEdge, SupportEdge } from "../types.js";
import { getTemplates, substituteTemplate } from "../config/templates.js";
import { getTaxonomy, getSeverity, getConfidence, getRiskMultiplier } from "../config/taxonomy.js";
import { getScoringConfig } from "../config/scoring.js";

export interface BuildNarrativesInput {
  claims: Claim[];
  contradictions: ContradictionEdge[];
  supports: SupportEdge[];
  grounding: Array<{ claimId: string; sourceId: string; weight: number; quote?: string }>;
  spectral?: SpectralReport;
  destructiveClaims?: DestructiveClaim[];
  transcript?: string; // Full transcript for quote extraction
}

export interface BuildNarrativesOutput {
  narratives: IssueNarrative[];
  summary: {
    totalIssues: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
    topCategories: string[];
  };
}

/**
 * Main entry point: Build issue narratives from claims and edges.
 */
export function buildIssueNarratives(input: BuildNarrativesInput): BuildNarrativesOutput {
  const templates = getTemplates();
  const taxonomy = getTaxonomy();
  const config = getScoringConfig();
  
  const narratives: IssueNarrative[] = [];
  const claimMap = new Map(input.claims.map(c => [c.id, c]));
  
  // 1. Cluster claims into issues
  const clusters = clusterClaimsIntoIssues(
    input.claims,
    input.contradictions,
    input.supports,
    input.grounding,
    input.spectral,
    config
  );
  
  console.log(`📊 Issue Narratives: ${input.claims.length} claims → ${clusters.length} issue clusters`);
  
  // 2. Build narrative for each cluster
  for (const cluster of clusters) {
    const narrative = buildNarrativeForCluster(
      cluster,
      claimMap,
      input.transcript || "",
      templates,
      taxonomy,
      config,
      input.spectral
    );
    
    if (narrative) {
      narratives.push(narrative);
    }
  }
  
  // 3. Sort by composite score (highest risk first)
  narratives.sort((a, b) => b.scoring.compositeScore - a.scoring.compositeScore);
  
  // 4. Generate summary
  const summary = generateSummary(narratives);
  
  return { narratives, summary };
}

// ============================================================================
// CLUSTERING
// ============================================================================

interface ClaimCluster {
  claimIds: string[];
  category: string;
  subcategory?: string;
  issueType: "contradiction" | "ungrounded" | "unverified" | "circular" | "policyViolation" | "generic";
  turnRange: [number, number];
  topContradictions: Array<{ claimA: string; claimB: string; score: number }>;
  topUngrounded: string[];
}

function clusterClaimsIntoIssues(
  claims: Claim[],
  contradictions: ContradictionEdge[],
  supports: SupportEdge[],
  grounding: Array<{ claimId: string; sourceId: string; weight: number }>,
  spectral?: SpectralReport,
  config?: any
): ClaimCluster[] {
  const clusters: ClaimCluster[] = [];
  const processedClaims = new Set<string>();
  
  // Group by category (if available) and contradiction relationships
  const categoryMap = new Map<string, string[]>();
  const contradictionMap = new Map<string, Set<string>>();
  
  // Build contradiction graph
  for (const edge of contradictions) {
    if (!contradictionMap.has(edge.claimA)) {
      contradictionMap.set(edge.claimA, new Set());
    }
    if (!contradictionMap.has(edge.claimB)) {
      contradictionMap.set(edge.claimB, new Set());
    }
    contradictionMap.get(edge.claimA)!.add(edge.claimB);
    contradictionMap.get(edge.claimB)!.add(edge.claimA);
  }
  
  // Find ungrounded claims
  const groundedClaimIds = new Set(grounding.map(g => g.claimId));
  const ungroundedClaims = claims.filter(c => !groundedClaimIds.has(c.id));
  
  // Cluster 1: Top contradictions (by score)
  const sortedContradictions = [...contradictions].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const topK = Math.min(config?.review?.topKContradictions || 5, sortedContradictions.length);
  
  for (let i = 0; i < topK; i++) {
    const edge = sortedContradictions[i];
    if (processedClaims.has(edge.claimA) || processedClaims.has(edge.claimB)) {
      continue;
    }
    
    const claimA = claims.find(c => c.id === edge.claimA);
    const claimB = claims.find(c => c.id === edge.claimB);
    
    if (claimA && claimB) {
      const turnA = claimA.meta?.turnIndex || 0;
      const turnB = claimB.meta?.turnIndex || 0;
      
      clusters.push({
        claimIds: [edge.claimA, edge.claimB],
        category: inferCategory(claimA, claimB),
        issueType: "contradiction",
        turnRange: [Math.min(turnA, turnB), Math.max(turnA, turnB)],
        topContradictions: [{ claimA: edge.claimA, claimB: edge.claimB, score: edge.weight || 1 }],
        topUngrounded: [],
      });
      
      processedClaims.add(edge.claimA);
      processedClaims.add(edge.claimB);
    }
  }
  
  // Cluster 2: Top ungrounded claims
  const sortedUngrounded = ungroundedClaims
    .filter(c => !processedClaims.has(c.id))
    .sort((a, b) => {
      const scoreA = a.confidenceMetrics?.groundingScore || 0;
      const scoreB = b.confidenceMetrics?.groundingScore || 0;
      return scoreA - scoreB; // Lower grounding = higher priority
    });
  
  const topUngrounded = sortedUngrounded.slice(0, Math.min(3, sortedUngrounded.length));
  
  for (const claim of topUngrounded) {
    clusters.push({
      claimIds: [claim.id],
      category: inferCategory(claim),
      issueType: "ungrounded",
      turnRange: [claim.meta?.turnIndex || 0, claim.meta?.turnIndex || 0],
      topContradictions: [],
      topUngrounded: [claim.id],
    });
    
    processedClaims.add(claim.id);
  }
  
  return clusters;
}

function inferCategory(...claims: Claim[]): string {
  // Simple keyword-based category inference
  // In production, this could use embeddings or more sophisticated NLP
  const text = claims.map(c => c.text.toLowerCase()).join(" ");
  
  if (text.match(/\b(bill|billing|charge|payment|rate|cost|price|invoice)\b/)) {
    return "BILLING";
  }
  if (text.match(/\b(cancel|cancellation|terminate|termination)\b/)) {
    return "BILLING"; // Cancellation is usually billing-related
  }
  if (text.match(/\b(fee|fees|penalty|surcharge)\b/)) {
    return "DISCLOSURE";
  }
  if (text.match(/\b(policy|terms|agreement|contract)\b/)) {
    return "DISCLOSURE";
  }
  if (text.match(/\b(promise|will|i'll|guarantee)\b/)) {
    return "PROMISE_BREACH";
  }
  
  return "OTHER";
}

// ============================================================================
// NARRATIVE BUILDING
// ============================================================================

function buildNarrativeForCluster(
  cluster: ClaimCluster,
  claimMap: Map<string, Claim>,
  transcript: string,
  templates: any,
  taxonomy: any,
  config: any,
  spectral?: SpectralReport
): IssueNarrative | null {
  const claims = cluster.claimIds.map(id => claimMap.get(id)).filter(Boolean) as Claim[];
  
  if (claims.length === 0) {
    return null;
  }
  
  // Extract evidence quotes
  const evidenceQuotes = extractEvidenceQuotes(claims, transcript);
  
  // Build contradiction pairs if applicable
  const contradictionPairs = cluster.issueType === "contradiction"
    ? buildContradictionPairs(cluster.topContradictions, evidenceQuotes)
    : undefined;
  
  // Determine speaker focus (default: AGENT)
  const speakerFocus = determineSpeakerFocus(claims);
  
  // Compute scores
  const scores = computeIssueScores(cluster, claims, spectral, taxonomy, config);
  
  // Generate narrative text using templates
  const subcategory = cluster.subcategory || inferSubcategory(claims);
  const templateVars = {
    subcategory,
    turnA: cluster.turnRange[0] + 1,
    turnB: cluster.turnRange[1] + 1,
  };
  
  const title = substituteTemplate(
    templates.titles[cluster.issueType] || templates.titles.generic,
    templateVars
  );
  
  const whatIsWrong = substituteTemplate(
    templates.whatIsWrong[cluster.issueType] || templates.whatIsWrong.generic,
    templateVars
  );
  
  const whyWrong = (templates.whyWrong[cluster.issueType] || templates.whyWrong.generic).map(
    (t: string) => substituteTemplate(t, templateVars)
  );
  
  const whyItMatters = (templates.whyItMatters[cluster.issueType] || templates.whyItMatters.generic).map(
    (t: string) => substituteTemplate(t, templateVars)
  );
  
  const recommendedActions = templates.recommendedActions[cluster.issueType] || templates.recommendedActions.generic;
  
  // Build traceability edges
  const topEdges = buildTraceabilityEdges(cluster, claims);
  
  return {
    issueId: `issue_${cluster.claimIds.join("_")}`,
    category: cluster.category,
    subcategory,
    title,
    severity: getSeverity(scores.riskScore, taxonomy),
    confidence: getConfidence(scores.confidence || 0.7, taxonomy),
    status: "OPEN",
    scope: {
      turnRange: cluster.turnRange,
      claimIds: cluster.claimIds,
      speakerFocus,
    },
    whatIsWrong,
    whyWrong,
    whyItMatters,
    recommendedActions,
    evidenceQuotes,
    contradictionPairs,
    traceability: {
      topEdges,
    },
    scoring: scores,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractEvidenceQuotes(claims: Claim[], transcript: string): EvidenceQuote[] {
  const quotes: EvidenceQuote[] = [];
  
  for (const claim of claims) {
    // Use claim text as quote (exact, not truncated)
    const quote: EvidenceQuote = {
      quoteId: `quote_${claim.id}`,
      claimId: claim.id,
      speaker: (claim.meta?.speaker === "Agent" ? "Agent" : 
                claim.meta?.speaker === "Customer" ? "Customer" : 
                "System") as "Agent" | "Customer" | "System",
      turnIndex: claim.meta?.turnIndex || 0,
      text: claim.text, // Exact quote
      evidenceRef: {
        type: "Call",
        ref: `Turn ${(claim.meta?.turnIndex || 0) + 1}`,
      },
    };
    
    // Add line span if available from grounding
    if (claim.grounding?.quoteSpans && claim.grounding.quoteSpans.length > 0) {
      const span = claim.grounding.quoteSpans[0];
      quote.lineSpan = [span.start, span.end];
    }
    
    quotes.push(quote);
  }
  
  return quotes;
}

function buildContradictionPairs(
  contradictions: Array<{ claimA: string; claimB: string; score: number }>,
  quotes: EvidenceQuote[]
): ContradictionPair[] {
  const pairs: ContradictionPair[] = [];
  
  for (const contra of contradictions) {
    const quoteA = quotes.find(q => q.claimId === contra.claimA);
    const quoteB = quotes.find(q => q.claimId === contra.claimB);
    
    if (quoteA && quoteB) {
      pairs.push({
        claimAId: contra.claimA,
        claimBId: contra.claimB,
        score: contra.score,
        explanation: `These statements cannot both be true. Statement A (turn ${quoteA.turnIndex + 1}) contradicts Statement B (turn ${quoteB.turnIndex + 1}).`,
        quoteIds: [quoteA.quoteId, quoteB.quoteId],
      });
    }
  }
  
  return pairs;
}

function determineSpeakerFocus(claims: Claim[]): "AGENT" | "SYSTEM" | "CUSTOMER" {
  // Default to AGENT (agent-focused framing)
  const hasAgent = claims.some(c => c.meta?.speaker === "Agent");
  const hasCustomer = claims.some(c => c.meta?.speaker === "Customer");
  
  if (hasAgent) {
    return "AGENT";
  }
  if (hasCustomer && !hasAgent) {
    return "CUSTOMER";
  }
  return "SYSTEM";
}

function computeIssueScores(
  cluster: ClaimCluster,
  claims: Claim[],
  spectral?: SpectralReport,
  taxonomy?: any,
  config?: any
): IssueNarrative["scoring"] {
  // Risk score: based on contradiction strength, category risk, spectral signals
  let riskScore = 0;
  
  if (cluster.issueType === "contradiction" && cluster.topContradictions.length > 0) {
    const maxContraScore = Math.max(...cluster.topContradictions.map(c => c.score));
    riskScore = maxContraScore * 100; // Scale to 0-100
  } else if (cluster.issueType === "ungrounded") {
    // Ungrounded claims are risky
    riskScore = 60; // Medium-high baseline
  } else {
    riskScore = 40; // Medium baseline
  }
  
  // Apply category risk multiplier
  const riskMultiplier = getRiskMultiplier(cluster.category, cluster.subcategory, taxonomy);
  riskScore = Math.min(100, riskScore * riskMultiplier);
  
  // Impact score: based on category and customer harm potential
  let impactScore = riskScore * 0.8; // Slightly lower than risk
  
  // Fixability score: based on clarity and number of claims
  const fixabilityScore = Math.max(0, 100 - (claims.length * 10)); // Fewer claims = easier to fix
  
  // Composite score: weighted sum from config
  const weights = config?.weights?.issueComposite || { risk: 0.5, impact: 0.3, fixability: 0.2 };
  const compositeScore = 
    riskScore * weights.risk +
    impactScore * weights.impact +
    fixabilityScore * weights.fixability;
  
  // Rationale
  const rationale: string[] = [];
  if (cluster.issueType === "contradiction") {
    rationale.push("Direct contradiction detected between claims.");
  }
  if (cluster.issueType === "ungrounded") {
    rationale.push("Claim lacks supporting evidence.");
  }
  rationale.push(`Category: ${cluster.category} (risk multiplier: ${riskMultiplier.toFixed(2)})`);
  
  return {
    riskScore: Math.round(riskScore),
    impactScore: Math.round(impactScore),
    fixabilityScore: Math.round(fixabilityScore),
    compositeScore: Math.round(compositeScore),
    rationale,
  };
}

function buildTraceabilityEdges(
  cluster: ClaimCluster,
  claims: Claim[]
): IssueNarrative["traceability"]["topEdges"] {
  const edges: IssueNarrative["traceability"]["topEdges"] = [];
  
  // Add contradiction edges
  for (const contra of cluster.topContradictions) {
    edges.push({
      type: "contradiction",
      fromClaimId: contra.claimA,
      toClaimId: contra.claimB,
      weight: contra.score,
      reason: "Contradiction detected",
    });
  }
  
  return edges;
}

function inferSubcategory(claims: Claim[]): string {
  const text = claims.map(c => c.text.toLowerCase()).join(" ");
  
  if (text.match(/\b(cancel|cancellation)\b/)) {
    return "cancellation";
  }
  if (text.match(/\b(refund|credit|reimburse)\b/)) {
    return "refund";
  }
  if (text.match(/\b(fee|fees)\b/)) {
    return "fees";
  }
  if (text.match(/\b(rate|rates|pricing)\b/)) {
    return "rates";
  }
  
  return "general";
}

function generateSummary(narratives: IssueNarrative[]): BuildNarrativesOutput["summary"] {
  const bySeverity: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const byCategory: Record<string, number> = {};
  
  for (const narrative of narratives) {
    bySeverity[narrative.severity] = (bySeverity[narrative.severity] || 0) + 1;
    byCategory[narrative.category] = (byCategory[narrative.category] || 0) + 1;
  }
  
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);
  
  return {
    totalIssues: narratives.length,
    bySeverity,
    byCategory,
    topCategories,
  };
}

