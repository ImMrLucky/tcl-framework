/**
 * Truth Engine - Main entry point for deterministic truth graph generation.
 * 
 * Replaces NLI-based edge generation with:
 * 1. Claim extraction (enhanced with modality/polarity)
 * 2. Fact normalization (structured semantic content)
 * 3. Rule-based edge generation (deterministic, auditable)
 * 4. Graph assembly (for spectral.py)
 * 
 * Same input + config = identical output (reproducible).
 * No ML/NLI calls.
 */

import { createHash } from "crypto";
import type { TruthEngineConfig } from "./config/types.js";
import { DEFAULT_CONFIG } from "./config/types.js";
import type { EnhancedClaim, Fact, TruthGraph, TruthEdge } from "./facts/types.js";
import { extractEnhancedClaims, extractFacts } from "./facts/fact-extractor.js";
import { runRuleEngine } from "./rules/rule-engine.js";

const CODE_VERSION = "1.0.0";

export interface TruthEngineInput {
  transcript: string;
  config?: TruthEngineConfig;
  conversationId?: string;
}

export interface TruthEngineOutput {
  graph: TruthGraph;
  
  // For spectral.py compatibility
  spectralInput: {
    claims: Array<{ id: string; text: string }>;
    supports: Array<{ claimA: string; claimB: string; weight: number }>;
    contradictions: Array<{ claimA: string; claimB: string; weight: number }>;
    grounded: string[];
  };
  
  // Performance metrics
  timings: {
    claimExtraction: number;
    factExtraction: number;
    ruleEngine: number;
    total: number;
  };
}

/**
 * Run the deterministic truth engine on a transcript.
 */
export function runTruthEngine(input: TruthEngineInput): TruthEngineOutput {
  const startTime = Date.now();
  const config = input.config || DEFAULT_CONFIG;
  
  // Stage 1: Claim Extraction
  const claimStart = Date.now();
  const claims = extractEnhancedClaims(input.transcript, config);
  const claimTime = Date.now() - claimStart;
  
  console.log(`📋 Truth Engine: Extracted ${claims.length} claims (${claimTime}ms)`);
  
  // Stage 2: Fact Normalization
  const factStart = Date.now();
  const facts = extractFacts(claims, config);
  const factTime = Date.now() - factStart;
  
  console.log(`📊 Truth Engine: Extracted ${facts.length} facts (${factTime}ms)`);
  
  // Stage 3: Rule-based Edge Generation
  const ruleStart = Date.now();
  const ruleResult = runRuleEngine(claims, facts, config);
  const ruleTime = Date.now() - ruleStart;
  
  console.log(`🔗 Truth Engine: Generated ${ruleResult.contradictionEdges.length} contradiction, ${ruleResult.supportEdges.length} support, ${ruleResult.structureEdges.length} structure edges (${ruleTime}ms)`);
  console.log(`   Rules applied: ${ruleResult.rulesApplied.join(', ')}`);
  
  // Stage 4: Graph Assembly
  const inputHash = createHash('sha256').update(input.transcript).digest('hex').substring(0, 16);
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex').substring(0, 16);
  
  // Sort for determinism
  const sortedClaims = [...claims].sort((a, b) => 
    a.turnIndex - b.turnIndex || a.id.localeCompare(b.id)
  );
  
  const sortedFacts = [...facts].sort((a, b) => 
    a.turnIndex - b.turnIndex || a.id.localeCompare(b.id)
  );
  
  const sortEdges = (edges: TruthEdge[]) => 
    [...edges].sort((a, b) => 
      b.weight - a.weight || a.srcId.localeCompare(b.srcId) || a.dstId.localeCompare(b.dstId)
    );
  
  const totalTime = Date.now() - startTime;
  
  const graph: TruthGraph = {
    claims: sortedClaims,
    facts: sortedFacts,
    contradictionEdges: sortEdges(ruleResult.contradictionEdges),
    supportEdges: sortEdges(ruleResult.supportEdges),
    groundingEdges: [], // No grounding without evidence corpus
    structureEdges: sortEdges(ruleResult.structureEdges),
    
    inputHash,
    configHash,
    codeVersion: CODE_VERSION,
    generatedAt: new Date().toISOString(),
    
    stats: {
      claimCount: claims.length,
      factCount: facts.length,
      edgeCounts: {
        contradiction: ruleResult.contradictionEdges.length,
        support: ruleResult.supportEdges.length,
        grounding: 0,
        structure: ruleResult.structureEdges.length,
      },
      rulesApplied: ruleResult.rulesApplied,
      processingTimeMs: totalTime,
    },
  };
  
  // Build spectral.py compatible input
  const spectralInput = {
    claims: sortedClaims.map(c => ({ id: c.id, text: c.text })),
    supports: ruleResult.supportEdges.map(e => ({
      claimA: e.srcId,
      claimB: e.dstId,
      weight: e.weight,
    })),
    contradictions: ruleResult.contradictionEdges.map(e => ({
      claimA: e.srcId,
      claimB: e.dstId,
      weight: e.weight,
    })),
    grounded: [], // All claims considered grounded in transcript-only mode
  };
  
  console.log(`✅ Truth Engine complete: ${totalTime}ms`);
  
  return {
    graph,
    spectralInput,
    timings: {
      claimExtraction: claimTime,
      factExtraction: factTime,
      ruleEngine: ruleTime,
      total: totalTime,
    },
  };
}

/**
 * Convert Truth Engine output to legacy graph format for compatibility.
 */
export function toLegacyGraph(output: TruthEngineOutput): {
  supports: Array<{ claimA: string; claimB: string; weight: number }>;
  contradictions: Array<{ claimA: string; claimB: string; weight: number }>;
  grounding: Array<{ claimId: string; sourceId: string; weight: number; quote?: string }>;
  groundedClaimIds: string[];
  debug?: Record<string, any>;
} {
  return {
    supports: output.spectralInput.supports,
    contradictions: output.spectralInput.contradictions,
    grounding: output.graph.groundingEdges.map(e => ({
      claimId: e.srcId,
      sourceId: e.dstId,
      weight: e.weight,
      quote: e.metadata?.srcText,
    })),
    groundedClaimIds: output.graph.claims.map(c => c.id), // All grounded in transcript mode
    debug: {
      engine: 'truth-engine-v1',
      nli: false,
      rulesApplied: output.graph.stats.rulesApplied,
      processingTimeMs: output.timings.total,
      inputHash: output.graph.inputHash,
      configHash: output.graph.configHash,
    },
  };
}

/**
 * Build issues from truth graph for UI display.
 */
export function buildIssuesFromGraph(graph: TruthGraph): Array<{
  issueId: string;
  claimId: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  ruleId: string;
  relatedClaims: string[];
}> {
  const issues: Array<{
    issueId: string;
    claimId: string;
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    ruleId: string;
    relatedClaims: string[];
  }> = [];
  
  // Each contradiction edge = one issue
  for (const edge of graph.contradictionEdges) {
    // Determine severity from rule
    let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    if (edge.ruleId.includes('AGENT_SELF_CONTRADICTION')) {
      severity = 'critical';
    } else if (edge.ruleId.includes('POLARITY_CONFLICT')) {
      severity = 'high';
    } else if (edge.ruleId.includes('ABSOLUTE_TO_CONDITIONAL')) {
      severity = 'high';
    } else if (edge.ruleId.includes('TIMEFRAME_CONFLICT')) {
      severity = 'medium';
    }
    
    // Boost severity if high weight
    if (edge.weight > 0.9 && severity === 'high') {
      severity = 'critical';
    }
    
    issues.push({
      issueId: `issue_${edge.id}`,
      claimId: edge.dstId, // The later claim is the "problem"
      type: edge.ruleId.split('.')[0], // e.g., "POLARITY_CONFLICT"
      severity,
      description: edge.reason,
      ruleId: edge.ruleId,
      relatedClaims: [edge.srcId, edge.dstId],
    });
  }
  
  // Sort by severity then weight
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  
  return issues;
}

