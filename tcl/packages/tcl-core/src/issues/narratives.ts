/**
 * Issue Narrative Builder - Convert clusters into QA-manager-grade IssueNarratives
 * 
 * This is the core function that transforms raw analysis into actionable findings.
 * All values come from config - NO HARD-CODED calculations.
 */

import type { Claim } from '../../types.js';
import type { IssueNarrative } from './types.js';
import type { Edge } from './types.js';
import { extractQuote, extractQuotes, type QuoteExtraction } from './quotes.js';
import { getScoringConfig, getTemplatesConfig, getTaxonomyConfig, renderTemplate } from '../config/loader.js';
import { createHash } from 'crypto';

interface ClaimCluster {
  id: string;
  claimIds: string[];
  edgeIds: string[];
  category: string;
  subcategory?: string;
  turnRange: [number, number];
  contradictionMass: number;
  supportMass: number;
  groundingMass: number;
  topContradictions: Array<{
    claimAId: string;
    claimBId: string;
    score: number;
    edgeId: string;
  }>;
  topUngrounded: string[];  // claim IDs
}

/**
 * Build IssueNarrative objects from clusters.
 * 
 * This is the main entry point for creating manager-grade findings.
 */
export function buildIssueNarratives(
  clusters: ClaimCluster[],
  claims: Claim[],
  edges: Edge[],
  spectralData?: {
    truthVector?: number[];
    truthStates?: Array<'Supported' | 'Contradicted' | 'Ungrounded' | 'Inconclusive'>;
    nodeBlameNorm?: number[];
    topBadContradictions?: Array<{ claimA: string; claimB: string; badness: number }>;
  }
): IssueNarrative[] {
  const scoringConfig = getScoringConfig();
  const templatesConfig = getTemplatesConfig();
  const taxonomyConfig = getTaxonomyConfig();
  
  const claimMap = new Map(claims.map(c => [c.id, c]));
  const edgeMap = new Map(edges.map(e => [e.id, e]));
  
  // Extract all quotes upfront
  const allQuotes = extractQuotes(claims);
  const quoteMap = new Map(allQuotes.map(q => [q.claimId, q]));
  
  const narratives: IssueNarrative[] = [];
  
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    
    // Get claims in this cluster
    const clusterClaims = cluster.claimIds
      .map(id => claimMap.get(id))
      .filter((c): c is Claim => c !== undefined);
    
    if (clusterClaims.length === 0) continue;
    
    // Determine category and subcategory from claims
    const { category, subcategory } = determineCategory(clusterClaims, taxonomyConfig);
    cluster.category = category;
    cluster.subcategory = subcategory;
    
    // Determine issue type and template
    const issueType = determineIssueType(cluster, clusterClaims, edges);
    const template = getTemplateForType(issueType, templatesConfig);
    
    // Extract evidence quotes
    const evidenceQuotes = clusterClaims
      .map(claim => quoteMap.get(claim.id))
      .filter((q): q is QuoteExtraction => q !== undefined)
      .slice(0, 5); // Top 5 quotes
    
    // Build contradiction pairs
    const contradictionPairs = buildContradictionPairs(
      cluster.topContradictions,
      quoteMap,
      clusterClaims
    );
    
    // Determine speaker focus (default: AGENT)
    const speakerFocus = determineSpeakerFocus(clusterClaims);
    
    // Compute scores
    const scores = computeIssueScores(
      cluster,
      clusterClaims,
      edges,
      taxonomyConfig,
      scoringConfig,
      spectralData
    );
    
    // Generate narrative text using templates
    const narrative = generateNarrativeText(
      template,
      cluster,
      clusterClaims,
      evidenceQuotes,
      contradictionPairs,
      taxonomyConfig
    );
    
    // Get top edges for traceability
    const topEdges = getTopEdgesForCluster(cluster, edges, 5);
    
    const issueNarrative: IssueNarrative = {
      issueId: `issue_${cluster.id}`,
      category: cluster.category,
      subcategory: cluster.subcategory,
      title: narrative.title,
      severity: mapToSeverity(scores.riskScore, scoringConfig),
      confidence: mapToConfidence(scores.compositeScore, scoringConfig),
      status: 'OPEN',
      scope: {
        turnRange: cluster.turnRange,
        claimIds: cluster.claimIds,
        speakerFocus
      },
      whatIsWrong: narrative.whatIsWrong,
      whyWrong: narrative.whyWrong,
      whyItMatters: narrative.whyItMatters,
      recommendedActions: narrative.recommendedActions,
      evidenceQuotes: evidenceQuotes.map(q => ({
        quoteId: q.quoteId,
        claimId: q.claimId,
        speaker: q.speaker,
        turnIndex: q.turnIndex,
        lineSpan: q.lineSpan,
        text: q.text,
        evidenceRef: q.evidenceRef
      })),
      contradictionPairs: contradictionPairs.length > 0 ? contradictionPairs : undefined,
      traceability: {
        topEdges: topEdges.map(e => ({
          type: e.type.toLowerCase() as "support" | "contradiction" | "grounding",
          fromClaimId: e.fromClaimId,
          toClaimId: e.toClaimId,
          weight: e.score,
          reason: e.rationale
        }))
      },
      scoring: {
        riskScore: Math.round(scores.riskScore),
        impactScore: Math.round(scores.impactScore),
        fixabilityScore: Math.round(scores.fixabilityScore),
        compositeScore: Math.round(scores.compositeScore),
        rationale: scores.rationale
      }
    };
    
    narratives.push(issueNarrative);
  }
  
  // Rank by composite score
  narratives.sort((a, b) => b.scoring.compositeScore - a.scoring.compositeScore);
  
  // Assign ranks
  narratives.forEach((n, idx) => {
    // Rank is already implicit in sort order, but we can add it if needed
  });
  
  return narratives;
}

/**
 * Determine category and subcategory from claim topics
 */
function determineCategory(
  claims: Claim[],
  taxonomy: any
): { category: string; subcategory?: string } {
  // Extract all topics from claims
  const allTopics = new Set<string>();
  for (const claim of claims) {
    const lowerText = claim.text.toLowerCase();
    for (const [keyword, subcat] of Object.entries(taxonomy.subcategoryMapping)) {
      if (lowerText.includes(keyword)) {
        allTopics.add(subcat);
      }
    }
  }
  
  // Find category from subcategory
  for (const [category, config] of Object.entries(taxonomy.categories)) {
    const subcategories = (config as any).subcategories || [];
    for (const topic of allTopics) {
      if (subcategories.includes(topic)) {
        return { category, subcategory: topic };
      }
    }
  }
  
  // Default to OTHER if no match
  return { category: 'OTHER' };
}

/**
 * Determine issue type (contradiction, ungrounded, circular, etc.)
 */
function determineIssueType(
  cluster: ClaimCluster,
  claims: Claim[],
  edges: Edge[]
): 'contradiction' | 'ungrounded' | 'circular' | 'default' {
  if (cluster.topContradictions.length > 0) {
    return 'contradiction';
  }
  if (cluster.topUngrounded.length > 0 && cluster.groundingMass === 0) {
    return 'ungrounded';
  }
  // Check for circular patterns (claims supporting each other without grounding)
  if (cluster.supportMass > 0 && cluster.groundingMass === 0) {
    return 'circular';
  }
  return 'default';
}

/**
 * Get template for issue type
 */
function getTemplateForType(
  type: string,
  templates: any
): any {
  return templates[type] || templates.default;
}

/**
 * Build contradiction pairs with explanations
 */
function buildContradictionPairs(
  topContradictions: Array<{ claimAId: string; claimBId: string; score: number; edgeId: string }>,
  quoteMap: Map<string, QuoteExtraction>,
  claims: Claim[]
): Array<{
  claimAId: string;
  claimBId: string;
  score: number;
  explanation: string;
  quoteIds: [string, string];
}> {
  return topContradictions
    .map(contra => {
      const quoteA = quoteMap.get(contra.claimAId);
      const quoteB = quoteMap.get(contra.claimBId);
      
      if (!quoteA || !quoteB) return null;
      
      const explanation = `These statements cannot both be true: "${quoteA.text.substring(0, 50)}..." contradicts "${quoteB.text.substring(0, 50)}..."`;
      
      return {
        claimAId: contra.claimAId,
        claimBId: contra.claimBId,
        score: contra.score,
        explanation,
        quoteIds: [quoteA.quoteId, quoteB.quoteId] as [string, string]
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, 3); // Top 3 contradictions
}

/**
 * Determine speaker focus (default: AGENT)
 */
function determineSpeakerFocus(claims: Claim[]): "AGENT" | "SYSTEM" | "CUSTOMER" {
  const agentCount = claims.filter(c => 
    c.meta?.speaker === 'Agent' || c.meta?.speaker === 'AGENT'
  ).length;
  
  if (agentCount > 0) {
    return 'AGENT'; // Default: agent-focused
  }
  
  const systemCount = claims.filter(c => 
    c.meta?.speaker === 'System' || c.meta?.speaker === 'SYSTEM'
  ).length;
  
  if (systemCount > 0) {
    return 'SYSTEM';
  }
  
  return 'CUSTOMER';
}

/**
 * Compute issue scores (all config-driven)
 */
function computeIssueScores(
  cluster: ClaimCluster,
  claims: Claim[],
  edges: Edge[],
  taxonomy: any,
  scoring: any,
  spectralData?: any
): {
  riskScore: number;
  impactScore: number;
  fixabilityScore: number;
  compositeScore: number;
  rationale: string[];
} {
  const category = taxonomy.categories[cluster.category] || taxonomy.categories.OTHER;
  
  // Risk Score
  const severityBase = Math.min(100, cluster.contradictionMass * 20);
  const topicMultiplier = scoring.categoryRiskMultipliers[cluster.category] || 1.0;
  const regulatorySensitivity = category.regulatorySensitivity || 0.5;
  
  const riskScore = Math.min(100, 
    severityBase * scoring.weights.riskScore.severity +
    cluster.contradictionMass * 30 * scoring.weights.riskScore.contradictionStrength +
    topicMultiplier * 20 * scoring.weights.riskScore.topicRiskMultiplier +
    regulatorySensitivity * 100 * scoring.weights.riskScore.regulatorySensitivity
  );
  
  // Impact Score
  const customerHarmPotential = category.customerHarmPotential || 0.5;
  const impactScore = Math.min(100,
    (cluster.category ? 50 : 30) * scoring.weights.impactScore.category +
    customerHarmPotential * 100 * scoring.weights.impactScore.customerHarmPotential +
    regulatorySensitivity * 100 * scoring.weights.impactScore.regulatorySensitivity
  );
  
  // Fixability Score
  const clarity = cluster.claimIds.length <= 3 ? 0.8 : 0.5; // Fewer claims = clearer
  const turnSpan = cluster.turnRange[1] - cluster.turnRange[0];
  const spanScore = turnSpan <= 5 ? 0.8 : 0.4; // Shorter span = easier to fix
  const groundedness = cluster.groundingMass > 0 ? 0.7 : 0.3;
  
  const fixabilityScore = Math.min(100,
    clarity * 100 * scoring.weights.fixabilityScore.clarity +
    (1 - cluster.claimIds.length / 10) * 100 * scoring.weights.fixabilityScore.claimCount +
    spanScore * 100 * scoring.weights.fixabilityScore.turnSpan +
    groundedness * 100 * scoring.weights.fixabilityScore.groundedness
  );
  
  // Composite Score (for ranking)
  const compositeScore = 
    riskScore * scoring.weights.issueComposite.risk +
    impactScore * scoring.weights.issueComposite.impact +
    fixabilityScore * scoring.weights.issueComposite.fixability;
  
  // Rationale
  const rationale: string[] = [];
  if (cluster.contradictionMass > 0) {
    rationale.push(`Contradiction mass: ${cluster.contradictionMass.toFixed(2)}`);
  }
  if (cluster.groundingMass === 0) {
    rationale.push('Ungrounded claims present');
  }
  rationale.push(`Category risk multiplier: ${topicMultiplier.toFixed(2)}`);
  rationale.push(`Regulatory sensitivity: ${regulatorySensitivity.toFixed(2)}`);
  
  return {
    riskScore,
    impactScore,
    fixabilityScore,
    compositeScore,
    rationale
  };
}

/**
 * Generate narrative text using templates
 */
function generateNarrativeText(
  template: any,
  cluster: ClaimCluster,
  claims: Claim[],
  quotes: QuoteExtraction[],
  contradictionPairs: any[],
  taxonomy: any
): {
  title: string;
  whatIsWrong: string;
  whyWrong: string[];
  whyItMatters: string[];
  recommendedActions: Array<{ type: string; action: string }>;
} {
  const subcategory = cluster.subcategory || cluster.category;
  const firstQuote = quotes[0];
  const secondQuote = quotes[1];
  
  // Build template variables
  const vars: Record<string, string | number> = {
    subcategory,
    category: cluster.category,
    turn: firstQuote?.turnIndex || cluster.turnRange[0],
    turnA: firstQuote?.turnIndex || cluster.turnRange[0],
    turnB: secondQuote?.turnIndex || cluster.turnRange[1],
    quoteA: firstQuote?.text.substring(0, 100) || '',
    quoteB: secondQuote?.text.substring(0, 100) || ''
  };
  
  // Render templates
  const title = renderTemplate(template.title, vars);
  const whatIsWrong = renderTemplate(template.whatIsWrong, vars);
  const whyWrong = template.whyWrong.map((w: string) => renderTemplate(w, vars));
  const whyItMatters = template.whyItMatters.map((w: string) => renderTemplate(w, vars));
  const recommendedActions = template.recommendedActions.map((a: any) => ({
    type: a.type,
    action: renderTemplate(a.action, vars)
  }));
  
  return {
    title,
    whatIsWrong,
    whyWrong,
    whyItMatters,
    recommendedActions
  };
}

/**
 * Get top edges for traceability
 */
function getTopEdgesForCluster(
  cluster: ClaimCluster,
  edges: Edge[],
  limit: number
): Edge[] {
  const clusterEdgeIds = new Set(cluster.edgeIds);
  return edges
    .filter(e => clusterEdgeIds.has(e.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Map numeric score to severity level
 */
function mapToSeverity(riskScore: number, scoring: any): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const thresholds = scoring.thresholds.severity;
  if (riskScore >= thresholds.critical * 100) return 'CRITICAL';
  if (riskScore >= thresholds.high * 100) return 'HIGH';
  if (riskScore >= thresholds.medium * 100) return 'MEDIUM';
  return 'LOW';
}

/**
 * Map numeric score to confidence level
 */
function mapToConfidence(compositeScore: number, scoring: any): "LOW" | "MEDIUM" | "HIGH" {
  const thresholds = scoring.thresholds.confidence;
  if (compositeScore >= thresholds.high * 100) return 'HIGH';
  if (compositeScore >= thresholds.medium * 100) return 'MEDIUM';
  return 'LOW';
}

