/**
 * Graph Builder - Unified Entry Point
 * 
 * This is the main entry point for building a semantically correct Claim-Evidence-Action Graph.
 * 
 * Pipeline:
 * 1. Extract claims with subject slots
 * 2. Topic segmentation
 * 3. Candidate generation (per-claim budgets)
 * 4. Edge classification (slot-first gating)
 * 5. Weight calibration
 * 6. Truth state derivation (from graph, never assigned directly)
 * 7. Return ClaimGraph + RunDiagnostics
 * 
 * INVARIANTS:
 * - Graph is the single source of truth
 * - Edges are evidence-bearing objects
 * - Support ≠ transcript quote (transcript = GROUNDING, not SUPPORT)
 * - Contradictions require same subject slot
 * - All thresholds are config-driven
 */

import {
  ClaimNode,
  EvidenceNode,
  ActionNode,
  TopicNode,
  GraphEdge,
  ClaimGraph,
  SubjectSlot,
  ExtractedEntity,
  ClaimModality,
  SpeakerRole,
  EvidenceKind,
  RunDiagnostics,
} from './types.js';
import { extractEntities, computeSubjectSlot } from './subject-slot.js';
import { getTemplateConfig, setTemplateConfig, TemplateConfig } from './template-config.js';

// Re-export for convenience
export { setTemplateConfig, getTemplateConfig, TemplateConfig };
import { assignTopicIds, SegmentationResult } from './topic-segmentation.js';
import { generateCandidates, CandidateGenerationResult } from './candidate-generation.js';
import { classifyEdges, EdgeClassificationResult } from './edge-classification.js';
import { calibrateEdges } from './weight-calibration.js';
import { deriveTruthStatesFromGraph, TruthDerivationResult, computeTruthScores, TruthScores } from './truth-state-derivation.js';
import { buildRunDiagnostics, DiagnosticsInput, validateGraphIntegrity } from './run-diagnostics.js';
import { createHash } from 'crypto';
import { logGraph } from '../server/utils/logger.js';

// =============================================================================
// GRAPH BUILDER INPUT
// =============================================================================

export interface GraphBuilderInput {
  /**
   * Raw transcript or interaction text.
   * Will be parsed into claims if rawClaims not provided.
   */
  transcript?: string;
  
  /**
   * Pre-extracted claims (if available).
   * Each must have id, text, speakerRole, and span.
   */
  rawClaims?: Array<{
    id: string;
    text: string;
    speakerRole: SpeakerRole;
    span: { turnId: string; startChar: number; endChar: number };
    timestamp?: string;
    modality?: ClaimModality;
    claimType?: string;
    confidence?: number;
    meta?: Record<string, any>;
  }>;
  
  /**
   * Evidence documents (policies, facts, system records).
   * These can create SUPPORT edges (not transcript).
   */
  evidence?: Array<{
    id: string;
    kind: EvidenceKind;
    content: string;
    title?: string;
    sourceSystem?: string;
    version?: string;
    effectiveDate?: string;
    fields?: Record<string, any>;
  }>;
  
  /**
   * Template ID or custom config.
   * Determines domain-specific lexicon, thresholds, and gating rules.
   */
  template?: string | Partial<TemplateConfig>;
  
  /**
   * Conversation/interaction ID for traceability.
   */
  conversationId?: string;
}

// =============================================================================
// GRAPH BUILDER OUTPUT
// =============================================================================

export interface GraphBuilderOutput {
  /** The complete claim graph */
  graph: ClaimGraph;
  
  /** Truth scores computed from the graph */
  truthScores: TruthScores;
  
  /** Per-claim truth state derivation */
  truthDerivation: TruthDerivationResult;
  
  /** Topic segmentation result */
  topicSegmentation: SegmentationResult;
  
  /** For backward compatibility with legacy edge_builder */
  legacy: {
    supports: Array<{ claimA: string; claimB: string; weight: number }>;
    contradictions: Array<{ claimA: string; claimB: string; weight: number }>;
    grounding: Array<{ claimId: string; sourceId: string; weight: number; quote?: string }>;
    groundedClaimIds: string[];
  };
  
  /** Processing metrics */
  metrics: {
    totalClaims: number;
    totalEvidence: number;
    totalEdges: number;
    processingTimeMs: number;
    pipelineSteps: Record<string, number>;
    /** Edge classification diagnostics (for debugging) */
    edgeClassification?: {
      candidatesProcessed: number;
      edgesCreated: number;
      rejectedBySlotGating: number;
      rejectedByTopicGating: number;
      rejectedByPolarityGating: number;
      rejectedByThreshold: number;
      sampleRejections: Array<{
        claimA: string;
        claimB: string;
        reason: string;
        slotA: string;
        slotB: string;
        textA: string;
        textB: string;
      }>;
    };
    /** Candidate generation diagnostics */
    candidateGeneration?: {
      totalCandidatesGenerated: number;
      claimsWithZeroCandidates: number;
      budgetExhausted: boolean;
    };
  };
}

// =============================================================================
// MAIN GRAPH BUILDER
// =============================================================================

export function buildGraph(input: GraphBuilderInput): GraphBuilderOutput {
  const startTime = Date.now();
  const pipelineSteps: Record<string, number> = {};
  
  // Step 0: Set template config
  if (input.template) {
    if (typeof input.template === 'string') {
      setTemplateConfig(input.template);
    } else {
      setTemplateConfig({
        ...getTemplateConfig(),
        ...input.template,
      });
    }
  }
  const config = getTemplateConfig();
  
  // Step 1: Build ClaimNodes
  const step1Start = Date.now();
  const claimNodes = buildClaimNodes(input);
  pipelineSteps['claimNodes'] = Date.now() - step1Start;
  logGraph('debug', `Claim nodes: ${claimNodes.length}`, { count: claimNodes.length, duration: pipelineSteps['claimNodes'] });
  
  // Step 2: Build EvidenceNodes
  const step2Start = Date.now();
  const evidenceNodes = buildEvidenceNodes(input);
  pipelineSteps['evidenceNodes'] = Date.now() - step2Start;
  logGraph('debug', `Evidence nodes: ${evidenceNodes.length}`, { count: evidenceNodes.length, duration: pipelineSteps['evidenceNodes'] });
  
  // Step 3: Topic Segmentation
  const step3Start = Date.now();
  const segmentation = assignTopicIds(claimNodes);
  pipelineSteps['topicSegmentation'] = Date.now() - step3Start;
  logGraph('debug', `Topic clusters: ${segmentation.clusters.length}`, { count: segmentation.clusters.length, duration: pipelineSteps['topicSegmentation'] });
  
  // Step 4: Candidate Generation
  const step4Start = Date.now();
  const transcriptEvidenceCount = evidenceNodes.filter(e => e.evidenceKind === 'transcript').length;
  logGraph('debug', `Evidence nodes breakdown`, { total: evidenceNodes.length, transcript: transcriptEvidenceCount });
  
  const candidates = generateCandidates(claimNodes, evidenceNodes);
  pipelineSteps['candidateGeneration'] = Date.now() - step4Start;
  logGraph('debug', `Candidates generated`, { 
    total: candidates.diagnostics.totalCandidatesGenerated, 
    duration: pipelineSteps['candidateGeneration'],
    breakdown: {
      contradiction: candidates.contradictionCandidates.length,
      supportClaim: candidates.supportClaimCandidates.length,
      supportEvidence: candidates.supportEvidenceCandidates.length,
      grounding: candidates.groundingCandidates.length
    }
  });
  
  // Step 5: Edge Classification
  const step5Start = Date.now();
  const classified = classifyEdges(
    candidates.contradictionCandidates,
    candidates.supportClaimCandidates,
    candidates.supportEvidenceCandidates,
    candidates.groundingCandidates
  );
  pipelineSteps['edgeClassification'] = Date.now() - step5Start;
  logGraph('debug', `Edges created`, { 
    total: classified.diagnostics.edgesCreated, 
    duration: pipelineSteps['edgeClassification'],
    breakdown: {
      contradictions: classified.contradictions.length,
      supports: classified.supports.length,
      groundings: classified.groundings.length
    }
  });
  
  // Step 6: Weight Calibration
  const step6Start = Date.now();
  const claimMap = new Map(claimNodes.map(c => [c.id, c]));
  const evidenceMap = new Map(evidenceNodes.map(e => [e.id, e]));
  
  const calibratedSupports = calibrateEdges(classified.supports, claimMap, evidenceMap);
  const calibratedContradictions = calibrateEdges(classified.contradictions, claimMap, evidenceMap);
  const calibratedGroundings = calibrateEdges(classified.groundings, claimMap, evidenceMap);
  pipelineSteps['weightCalibration'] = Date.now() - step6Start;
  logGraph('debug', `Weight calibration completed`, { duration: pipelineSteps['weightCalibration'] });
  
  // Step 7: Build ClaimGraph
  const inputHash = createHash('sha256')
    .update(input.transcript || JSON.stringify(input.rawClaims))
    .digest('hex')
    .substring(0, 16);
  const configHash = createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex')
    .substring(0, 16);
  
  const graph: ClaimGraph = {
    nodes: {
      claims: claimNodes,
      evidence: evidenceNodes,
      actions: [], // TODO: Extract actions from transcript
      topics: segmentation.topicNodes,
    },
    edges: {
      support: calibratedSupports,
      contradiction: calibratedContradictions,
      grounding: calibratedGroundings,
      actionResult: [],
      correction: [],
    },
    diagnostics: {
      status: 'OK', // Will be updated below
      reasons: [],
      counters: {},
      timestamp: new Date().toISOString(),
    },
    meta: {
      templateId: config.templateId,
      createdAt: new Date().toISOString(),
      inputHash,
      configHash,
    },
  };
  
  // Step 8: Truth State Derivation
  const step8Start = Date.now();
  const truthDerivation = deriveTruthStatesFromGraph(graph);
  
  // Determine if external evidence exists (non-transcript evidence)
  const hasExternalEvidence = evidenceNodes.some(e => e.evidenceKind !== 'transcript');
  const truthScores = computeTruthScores(truthDerivation, hasExternalEvidence);
  
  pipelineSteps['truthDerivation'] = Date.now() - step8Start;
  logGraph('debug', `Truth scores computed`, { 
    duration: pipelineSteps['truthDerivation'],
    mode: hasExternalEvidence ? 'evidence-backed' : 'transcript-only',
    truth: truthScores.auditTruth
  });
  
  // Step 9: Run Diagnostics
  const diagnosticsInput: DiagnosticsInput = {
    candidateDiagnostics: candidates.diagnostics,
    edgeDiagnostics: classified.diagnostics,
    truthSummary: truthDerivation.summary,
    hasExternalEvidence: evidenceNodes.some(e => e.evidenceKind !== 'transcript'),
    spectralSkipped: false, // Will be set by caller
  };
  graph.diagnostics = buildRunDiagnostics(diagnosticsInput);
  
  // Add consistency check warnings from truth derivation
  if (truthDerivation.diagnostics && truthDerivation.diagnostics.length > 0) {
    graph.diagnostics.status = 'DEGRADED';
    graph.diagnostics.reasons.push(...truthDerivation.diagnostics);
  }
  
  // Step 10: Validate Graph Integrity
  const integrity = validateGraphIntegrity(graph);
  if (!integrity.isValid) {
    console.warn(`⚠️ Graph integrity violations: ${integrity.violations.join(', ')}`);
    graph.diagnostics.reasons.push(...integrity.violations.slice(0, 3)); // Limit to first 3
    if (graph.diagnostics.status === 'OK') {
      graph.diagnostics.status = 'DEGRADED';
    }
  }
  
  const totalTime = Date.now() - startTime;
  pipelineSteps['total'] = totalTime;
  console.log(`🏁 Graph Builder: Complete in ${totalTime}ms`);
  
  // Build legacy format for backward compatibility
  const legacy = {
    supports: calibratedSupports.map(e => ({
      claimA: e.from,
      claimB: e.to,
      weight: e.weight,
    })),
    contradictions: calibratedContradictions.map(e => ({
      claimA: e.from,
      claimB: e.to,
      weight: e.weight,
    })),
    grounding: calibratedGroundings.map(e => ({
      claimId: e.from,
      sourceId: e.to,
      weight: e.weight,
      quote: e.provenance.anchors?.[0]?.text,
    })),
    groundedClaimIds: calibratedGroundings.map(e => e.from),
  };
  
  return {
    graph,
    truthScores,
    truthDerivation,
    topicSegmentation: segmentation,
    legacy,
    metrics: {
      totalClaims: claimNodes.length,
      totalEvidence: evidenceNodes.length,
      totalEdges: 
        calibratedSupports.length + 
        calibratedContradictions.length + 
        calibratedGroundings.length,
      processingTimeMs: totalTime,
      pipelineSteps,
      // Edge classification diagnostics
      edgeClassification: {
        candidatesProcessed: classified.diagnostics.candidatesProcessed,
        edgesCreated: classified.diagnostics.edgesCreated,
        rejectedBySlotGating: classified.diagnostics.rejectedBySlotGating,
        rejectedByTopicGating: classified.diagnostics.rejectedByTopicGating,
        rejectedByPolarityGating: classified.diagnostics.rejectedByPolarityGating,
        rejectedByThreshold: classified.diagnostics.rejectedByThreshold,
        sampleRejections: classified.diagnostics.sampleRejections,
      },
      // Candidate generation diagnostics
      candidateGeneration: {
        totalCandidatesGenerated: candidates.diagnostics.totalCandidatesGenerated,
        claimsWithZeroCandidates: candidates.diagnostics.claimsWithZeroCandidates,
        budgetExhausted: candidates.diagnostics.budgetExhausted,
      },
    },
  };
}

// =============================================================================
// BUILD CLAIM NODES
// =============================================================================

function buildClaimNodes(input: GraphBuilderInput): ClaimNode[] {
  const claimNodes: ClaimNode[] = [];
  
  if (input.rawClaims) {
    // Use pre-extracted claims
    for (const raw of input.rawClaims) {
      const entities = extractEntities(raw.text);
      const slot = computeSubjectSlot(raw.text, entities, raw.modality);
      
      const node: ClaimNode = {
        id: raw.id,
        type: 'CLAIM',
        text: raw.text,
        speakerRole: raw.speakerRole,
        span: raw.span,
        timestamp: raw.timestamp,
        modality: raw.modality || detectModality(raw.text),
        claimType: raw.claimType,
        entities,
        normalized: {
          amount: entities.find(e => e.type === 'MONEY')?.normalized,
          date: entities.find(e => e.type === 'DATE')?.normalized,
          duration: entities.find(e => e.type === 'DURATION')?.normalized,
          percentage: entities.find(e => e.type === 'PERCENT')?.normalized,
        },
        slot,
        confidence: raw.confidence,
        createdAt: new Date().toISOString(),
        meta: raw.meta,
      };
      
      claimNodes.push(node);
    }
  } else if (input.transcript) {
    // Parse transcript into claims (simple line-based extraction)
    const lines = input.transcript.split('\n').filter(l => l.trim());
    let turnIndex = 0;
    
    for (const line of lines) {
      const parsed = parseTurn(line, turnIndex);
      if (!parsed) {
        turnIndex++;
        continue;
      }
      
      const entities = extractEntities(parsed.text);
      const slot = computeSubjectSlot(parsed.text, entities);
      
      const node: ClaimNode = {
        id: `c${turnIndex}`,
        type: 'CLAIM',
        text: parsed.text,
        speakerRole: parsed.speaker,
        span: {
          turnId: `turn-${turnIndex}`,
          startChar: 0,
          endChar: parsed.text.length,
        },
        modality: detectModality(parsed.text),
        entities,
        normalized: {
          amount: entities.find(e => e.type === 'MONEY')?.normalized,
          date: entities.find(e => e.type === 'DATE')?.normalized,
        },
        slot,
        createdAt: new Date().toISOString(),
      };
      
      claimNodes.push(node);
      turnIndex++;
    }
  }
  
  return claimNodes;
}

// =============================================================================
// BUILD EVIDENCE NODES
// =============================================================================

function buildEvidenceNodes(input: GraphBuilderInput): EvidenceNode[] {
  const evidenceNodes: EvidenceNode[] = [];
  
  if (input.evidence) {
    for (const ev of input.evidence) {
      const node: EvidenceNode = {
        id: ev.id,
        type: 'EVIDENCE',
        evidenceKind: ev.kind,
        sourceSystem: ev.sourceSystem,
        title: ev.title,
        version: ev.version,
        effectiveDate: ev.effectiveDate,
        anchors: [],
        content: ev.content,
        fields: ev.fields,
        createdAt: new Date().toISOString(),
      };
      
      evidenceNodes.push(node);
    }
  }
  
  // Also create transcript evidence nodes for grounding
  if (input.transcript) {
    const lines = input.transcript.split('\n').filter(l => l.trim());
    let turnIndex = 0;
    
    for (const line of lines) {
      const parsed = parseTurn(line, turnIndex);
      if (!parsed) {
        turnIndex++;
        continue;
      }
      
      const node: EvidenceNode = {
        id: `e-transcript-${turnIndex}`,
        type: 'EVIDENCE',
        evidenceKind: 'transcript',
        content: parsed.text,
        anchors: [{
          type: 'line',
          ref: `turn-${turnIndex}`,
          text: parsed.text,
        }],
        createdAt: new Date().toISOString(),
      };
      
      evidenceNodes.push(node);
      turnIndex++;
    }
  }
  
  return evidenceNodes;
}

// =============================================================================
// HELPERS
// =============================================================================

function parseTurn(line: string, turnIndex: number): { speaker: SpeakerRole; text: string } | null {
  // Common patterns: "Agent: ...", "Customer: ...", "[Agent] ...", etc.
  const patterns = [
    /^(?:Agent|AGENT|agent)\s*[:\]]\s*(.+)$/i,
    /^(?:Customer|CUSTOMER|customer)\s*[:\]]\s*(.+)$/i,
    /^(?:System|SYSTEM|system)\s*[:\]]\s*(.+)$/i,
    /^(?:Assistant|ASSISTANT|assistant)\s*[:\]]\s*(.+)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      let speaker: SpeakerRole = 'unknown';
      if (/agent/i.test(line)) speaker = 'agent';
      else if (/customer/i.test(line)) speaker = 'customer';
      else if (/system/i.test(line)) speaker = 'system';
      else if (/assistant/i.test(line)) speaker = 'assistant';
      
      return { speaker, text: match[1].trim() };
    }
  }
  
  // If no pattern matches, treat as unknown speaker
  if (line.trim().length > 10) {
    return { speaker: 'unknown', text: line.trim() };
  }
  
  return null;
}

function detectModality(text: string): ClaimModality {
  const lowerText = text.toLowerCase();
  
  // Questions
  if (text.includes('?') || /^(what|who|where|when|why|how|is|are|can|could|would|do|does|did)\b/.test(lowerText)) {
    return 'question';
  }
  
  // Promises/Commitments - Enhanced detection for risky commitments
  // Patterns: "will", "guarantee", "promise", "you'll receive", "assure", "commit"
  const commitmentPatterns = [
    /\b(i will|i'll|we will|we'll|you will|you'll)\b/i,
    /\b(i promise|we promise|i guarantee|we guarantee)\b/i,
    /\b(i assure|we assure|i can assure)\b/i,
    /\b(you'll receive|you will receive|you'll get|you will get)\b/i,
    /\b(i commit|we commit|committed to)\b/i,
    /\b(guaranteed|promised|assured)\b/i,
    /\b(rest assured|be assured)\b/i,
  ];
  
  if (commitmentPatterns.some(pattern => pattern.test(lowerText))) {
    return 'promise';
  }
  
  // Denials
  if (/\b(no|not|never|don't|doesn't|didn't|won't|can't|cannot|isn't|aren't)\b/.test(lowerText)) {
    return 'deny';
  }
  
  // Hedges
  if (/\b(maybe|perhaps|might|could be|possibly|i think|i believe|it seems)\b/.test(lowerText)) {
    return 'hedge';
  }
  
  // Default to assertion
  return 'assert';
}

// =============================================================================
// EXPORTS FOR SPECTRAL.PY COMPATIBILITY
// =============================================================================

export interface SpectralInput {
  claims: Array<{ id: string; text: string }>;
  supports: Array<{ claimA: string; claimB: string; weight: number }>;
  contradictions: Array<{ claimA: string; claimB: string; weight: number }>;
  grounded: string[];
}

export function toSpectralInput(output: GraphBuilderOutput): SpectralInput {
  return {
    claims: output.graph.nodes.claims.map(c => ({ id: c.id, text: c.text })),
    supports: output.legacy.supports,
    contradictions: output.legacy.contradictions,
    grounded: output.legacy.groundedClaimIds,
  };
}

// =============================================================================
// REGRESSION TEST HELPERS
// =============================================================================

export function assertGraphInvariants(graph: ClaimGraph): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  
  // Invariant 1: All contradiction edges must have same slotType/entityKey
  for (const edge of graph.edges.contradiction) {
    if (!edge.slot || edge.slot.slotType === 'unknown') {
      failures.push(`Contradiction edge ${edge.id} has unknown slot`);
    }
  }
  
  // Invariant 2: All edges must have rationale
  const allEdges = [
    ...graph.edges.support,
    ...graph.edges.contradiction,
    ...graph.edges.grounding,
  ];
  for (const edge of allEdges) {
    if (!edge.rationale?.method) {
      failures.push(`Edge ${edge.id} missing rationale.method`);
    }
  }
  
  // Invariant 3: All edges must have provenance
  for (const edge of allEdges) {
    if (!edge.provenance) {
      failures.push(`Edge ${edge.id} missing provenance`);
    }
  }
  
  // Invariant 4: No cross-topic contradictions (if gating enabled)
  const config = getTemplateConfig();
  if (config.gating.contradictionRequiresSameTopic) {
    for (const edge of graph.edges.contradiction) {
      const claimA = graph.nodes.claims.find(c => c.id === edge.from);
      const claimB = graph.nodes.claims.find(c => c.id === edge.to);
      if (claimA?.topicId && claimB?.topicId && claimA.topicId !== claimB.topicId) {
        failures.push(`Contradiction edge ${edge.id} crosses topics: ${claimA.topicId} ≠ ${claimB.topicId}`);
      }
    }
  }
  
  // Invariant 5: Support edges from transcript must be GROUNDING, not SUPPORT
  for (const edge of graph.edges.support) {
    const evidence = graph.nodes.evidence.find(e => e.id === edge.to);
    if (evidence?.evidenceKind === 'transcript') {
      failures.push(`Support edge ${edge.id} points to transcript evidence (should be GROUNDING)`);
    }
  }
  
  return {
    passed: failures.length === 0,
    failures,
  };
}

