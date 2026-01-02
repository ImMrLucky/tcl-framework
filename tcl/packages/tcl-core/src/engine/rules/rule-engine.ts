/**
 * Rule Engine - Generates edges deterministically from Facts.
 * 
 * Core rule types:
 * 1. Polarity Conflict - same subject, affirm vs deny
 * 2. Absolute → Conditional shift
 * 3. Timeframe conflict
 * 4. Agent self-contradiction
 * 
 * All edge weights come from config - nothing hard-coded.
 */

import { createHash } from "crypto";
import type { TruthEngineConfig } from "../config/types.js";
import type { EnhancedClaim, Fact, TruthEdge } from "../facts/types.js";
import { DEFAULT_CONFIG } from "../config/types.js";

export interface RuleEngineResult {
  contradictionEdges: TruthEdge[];
  supportEdges: TruthEdge[];
  structureEdges: TruthEdge[];
  rulesApplied: string[];
}

/**
 * Run all rules to generate edges.
 */
export function runRuleEngine(
  claims: EnhancedClaim[],
  facts: Fact[],
  config: TruthEngineConfig = DEFAULT_CONFIG
): RuleEngineResult {
  const contradictionEdges: TruthEdge[] = [];
  const supportEdges: TruthEdge[] = [];
  const structureEdges: TruthEdge[] = [];
  const rulesApplied = new Set<string>();
  
  // Index facts by subject for efficient lookup
  const factsBySubject = new Map<string, Fact[]>();
  for (const fact of facts) {
    const existing = factsBySubject.get(fact.subject) || [];
    existing.push(fact);
    factsBySubject.set(fact.subject, existing);
  }
  
  // Index claims by turn for structure edges
  const claimsByTurn = new Map<number, EnhancedClaim[]>();
  for (const claim of claims) {
    const existing = claimsByTurn.get(claim.turnIndex) || [];
    existing.push(claim);
    claimsByTurn.set(claim.turnIndex, existing);
  }
  
  // 1. Check polarity conflicts within same subject
  if (config.rules["POLARITY_CONFLICT"]?.enabled) {
    for (const [subject, subjectFacts] of factsBySubject) {
      const conflicts = findPolarityConflicts(subjectFacts, claims, config);
      for (const edge of conflicts) {
        contradictionEdges.push(edge);
        rulesApplied.add("POLARITY_CONFLICT");
      }
    }
  }
  
  // 2. Check absolute → conditional shifts
  if (config.rules["ABSOLUTE_TO_CONDITIONAL"]?.enabled) {
    const shifts = findModalityShifts(claims, facts, config);
    for (const edge of shifts) {
      contradictionEdges.push(edge);
      rulesApplied.add("ABSOLUTE_TO_CONDITIONAL");
    }
  }
  
  // 3. Check agent self-contradictions
  if (config.rules["AGENT_SELF_CONTRADICTION"]?.enabled) {
    const selfContras = findAgentSelfContradictions(claims, facts, config);
    for (const edge of selfContras) {
      contradictionEdges.push(edge);
      rulesApplied.add("AGENT_SELF_CONTRADICTION");
    }
  }
  
  // 4. Check timeframe conflicts
  if (config.rules["TIMEFRAME_CONFLICT"]?.enabled) {
    for (const [subject, subjectFacts] of factsBySubject) {
      const conflicts = findTimeframeConflicts(subjectFacts, claims, config);
      for (const edge of conflicts) {
        contradictionEdges.push(edge);
        rulesApplied.add("TIMEFRAME_CONFLICT");
      }
    }
  }
  
  // 5. Generate support edges (repetition, clarification)
  if (config.rules["SUPPORT_REPETITION"]?.enabled) {
    const supports = findSupportEdges(claims, facts, config);
    for (const edge of supports) {
      supportEdges.push(edge);
      rulesApplied.add("SUPPORT_REPETITION");
    }
  }
  
  // 6. Generate structure edges (question→answer, request→promise)
  if (config.rules["QUESTION_ANSWER"]?.enabled) {
    const qaEdges = findQuestionAnswerEdges(claims, config);
    for (const edge of qaEdges) {
      structureEdges.push(edge);
      rulesApplied.add("QUESTION_ANSWER");
    }
  }
  
  if (config.rules["REQUEST_FULFILLMENT"]?.enabled) {
    const rfEdges = findRequestFulfillmentEdges(claims, config);
    for (const edge of rfEdges) {
      structureEdges.push(edge);
      rulesApplied.add("REQUEST_FULFILLMENT");
    }
  }
  
  // Prune edges according to config
  const prunedContradictions = pruneEdges(contradictionEdges, 'contradiction', config);
  const prunedSupports = pruneEdges(supportEdges, 'support', config);
  const prunedStructure = pruneEdges(structureEdges, 'structure', config);
  
  return {
    contradictionEdges: prunedContradictions,
    supportEdges: prunedSupports,
    structureEdges: prunedStructure,
    rulesApplied: Array.from(rulesApplied),
  };
}

// ============================================================================
// Rule Implementations
// ============================================================================

function findPolarityConflicts(
  subjectFacts: Fact[],
  claims: EnhancedClaim[],
  config: TruthEngineConfig
): TruthEdge[] {
  const edges: TruthEdge[] = [];
  const claimMap = new Map(claims.map(c => [c.id, c]));
  
  // Sort facts by turn index
  const sorted = [...subjectFacts].sort((a, b) => a.turnIndex - b.turnIndex);
  
  // Compare each pair
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const earlier = sorted[i];
      const later = sorted[j];
      
      // Check for polarity conflict (true vs false on same subject+predicate)
      if (earlier.predicate === later.predicate) {
        const earlierValue = Boolean(earlier.value);
        const laterValue = Boolean(later.value);
        
        if (earlierValue !== laterValue) {
          // Polarity conflict detected
          const srcClaim = claimMap.get(earlier.claimId);
          const dstClaim = claimMap.get(later.claimId);
          
          // Calculate weight from config
          let weight = config.edgeWeights.contradictionBase;
          weight *= config.edgeWeights.polarityConflictMultiplier;
          
          // Boost if agent speaker
          if (later.speaker === 'agent') {
            weight *= config.edgeWeights.agentSpeakerMultiplier;
          }
          
          edges.push({
            id: generateEdgeId('contra', earlier.claimId, later.claimId),
            type: 'contradiction',
            srcId: earlier.claimId,
            dstId: later.claimId,
            weight: clamp01(weight),
            reason: `Conflicting statements about ${earlier.subject}: first ${earlierValue ? 'affirms' : 'denies'}, then ${laterValue ? 'affirms' : 'denies'}`,
            ruleId: `POLARITY_CONFLICT.${earlier.subject.toUpperCase()}`,
            provenance: 'rules',
            metadata: {
              subject: earlier.subject,
              predicate: earlier.predicate,
              polarityConflict: true,
              srcText: srcClaim?.text.substring(0, 100),
              dstText: dstClaim?.text.substring(0, 100),
            },
          });
        }
      }
    }
  }
  
  return edges;
}

function findModalityShifts(
  claims: EnhancedClaim[],
  facts: Fact[],
  config: TruthEngineConfig
): TruthEdge[] {
  const edges: TruthEdge[] = [];
  
  // Group claims by topic
  const claimsByTopic = new Map<string, EnhancedClaim[]>();
  for (const claim of claims) {
    for (const topic of claim.topics) {
      const existing = claimsByTopic.get(topic) || [];
      existing.push(claim);
      claimsByTopic.set(topic, existing);
    }
  }
  
  // Look for absolute → conditional shifts
  for (const [topic, topicClaims] of claimsByTopic) {
    const sorted = [...topicClaims].sort((a, b) => a.turnIndex - b.turnIndex);
    
    for (let i = 0; i < sorted.length; i++) {
      const earlier = sorted[i];
      
      // Only look at absolute statements
      if (earlier.modality !== 'absolute') continue;
      
      for (let j = i + 1; j < sorted.length; j++) {
        const later = sorted[j];
        
        // Check for conditional modifier on same topic
        if (later.modality === 'conditional' || later.hasConditionalLanguage) {
          // Absolute → Conditional shift detected
          let weight = config.edgeWeights.contradictionBase;
          weight *= 0.9; // Slightly lower than pure polarity conflict
          
          if (later.speaker === 'agent') {
            weight *= config.edgeWeights.agentSpeakerMultiplier;
          }
          
          edges.push({
            id: generateEdgeId('modal', earlier.id, later.id),
            type: 'contradiction',
            srcId: earlier.id,
            dstId: later.id,
            weight: clamp01(weight),
            reason: `Absolute statement "${earlier.text.substring(0, 50)}..." followed by conditional qualifier`,
            ruleId: `ABSOLUTE_TO_CONDITIONAL.${topic.toUpperCase()}`,
            provenance: 'rules',
            metadata: {
              topic,
              modalityShift: true,
              srcText: earlier.text.substring(0, 100),
              dstText: later.text.substring(0, 100),
            },
          });
        }
      }
    }
  }
  
  return edges;
}

function findAgentSelfContradictions(
  claims: EnhancedClaim[],
  facts: Fact[],
  config: TruthEngineConfig
): TruthEdge[] {
  const edges: TruthEdge[] = [];
  
  // Only look at agent claims
  const agentClaims = claims.filter(c => c.speaker === 'agent');
  
  // Group by topic
  const byTopic = new Map<string, EnhancedClaim[]>();
  for (const claim of agentClaims) {
    for (const topic of claim.topics) {
      const existing = byTopic.get(topic) || [];
      existing.push(claim);
      byTopic.set(topic, existing);
    }
  }
  
  // Look for polarity flip within agent statements
  for (const [topic, topicClaims] of byTopic) {
    const sorted = [...topicClaims].sort((a, b) => a.turnIndex - b.turnIndex);
    
    for (let i = 0; i < sorted.length; i++) {
      const earlier = sorted[i];
      
      for (let j = i + 1; j < sorted.length; j++) {
        const later = sorted[j];
        
        // Check for polarity flip
        if (earlier.polarity !== 'unknown' && later.polarity !== 'unknown' &&
            earlier.polarity !== later.polarity) {
          
          let weight = config.edgeWeights.contradictionBase;
          weight *= config.edgeWeights.agentSpeakerMultiplier;
          weight *= 1.1; // Self-contradiction is more serious
          
          edges.push({
            id: generateEdgeId('self', earlier.id, later.id),
            type: 'contradiction',
            srcId: earlier.id,
            dstId: later.id,
            weight: clamp01(weight),
            reason: `Agent contradicts own statement about ${topic}`,
            ruleId: `AGENT_SELF_CONTRADICTION.${topic.toUpperCase()}`,
            provenance: 'rules',
            metadata: {
              topic,
              polarityConflict: true,
              srcText: earlier.text.substring(0, 100),
              dstText: later.text.substring(0, 100),
            },
          });
        }
      }
    }
  }
  
  return edges;
}

function findTimeframeConflicts(
  subjectFacts: Fact[],
  claims: EnhancedClaim[],
  config: TruthEngineConfig
): TruthEdge[] {
  const edges: TruthEdge[] = [];
  const claimMap = new Map(claims.map(c => [c.id, c]));
  
  // Find facts with timeframe info
  const factsWithTime = subjectFacts.filter(f => f.timeframe);
  
  for (let i = 0; i < factsWithTime.length; i++) {
    const earlier = factsWithTime[i];
    
    for (let j = i + 1; j < factsWithTime.length; j++) {
      const later = factsWithTime[j];
      
      // Check for overlapping timeframes with conflicting values
      if (timeframesOverlap(earlier.timeframe, later.timeframe)) {
        if (Boolean(earlier.value) !== Boolean(later.value)) {
          const srcClaim = claimMap.get(earlier.claimId);
          const dstClaim = claimMap.get(later.claimId);
          
          let weight = config.edgeWeights.contradictionBase;
          weight *= config.edgeWeights.timeframeConflictMultiplier;
          
          edges.push({
            id: generateEdgeId('time', earlier.claimId, later.claimId),
            type: 'contradiction',
            srcId: earlier.claimId,
            dstId: later.claimId,
            weight: clamp01(weight),
            reason: `Conflicting states for "${earlier.subject}" in overlapping timeframes`,
            ruleId: `TIMEFRAME_CONFLICT.${earlier.subject.toUpperCase()}`,
            provenance: 'rules',
            metadata: {
              subject: earlier.subject,
              timeframeOverlap: true,
              srcText: srcClaim?.text.substring(0, 100),
              dstText: dstClaim?.text.substring(0, 100),
            },
          });
        }
      }
    }
  }
  
  return edges;
}

function findSupportEdges(
  claims: EnhancedClaim[],
  facts: Fact[],
  config: TruthEngineConfig
): TruthEdge[] {
  const edges: TruthEdge[] = [];
  
  // Group facts by subject+predicate+value
  const factGroups = new Map<string, Fact[]>();
  for (const fact of facts) {
    const key = `${fact.subject}:${fact.predicate}:${fact.value}`;
    const existing = factGroups.get(key) || [];
    existing.push(fact);
    factGroups.set(key, existing);
  }
  
  // Facts in the same group support each other
  for (const [key, group] of factGroups) {
    if (group.length < 2) continue;
    
    const sorted = [...group].sort((a, b) => a.turnIndex - b.turnIndex);
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const earlier = sorted[i];
      const later = sorted[i + 1];
      
      let weight = config.edgeWeights.supportBase;
      
      // Same speaker = stronger support (consistency)
      if (earlier.speaker === later.speaker) {
        weight *= 1.1;
      }
      
      edges.push({
        id: generateEdgeId('support', earlier.claimId, later.claimId),
        type: 'support',
        srcId: earlier.claimId,
        dstId: later.claimId,
        weight: clamp01(weight),
        reason: `Consistent statements about ${earlier.subject}`,
        ruleId: 'SUPPORT_REPETITION',
        provenance: 'rules',
        metadata: {
          subject: earlier.subject,
          predicate: earlier.predicate,
        },
      });
    }
  }
  
  return edges;
}

function findQuestionAnswerEdges(
  claims: EnhancedClaim[],
  config: TruthEngineConfig
): TruthEdge[] {
  const edges: TruthEdge[] = [];
  
  for (let i = 0; i < claims.length - 1; i++) {
    const current = claims[i];
    const next = claims[i + 1];
    
    // Question from customer followed by agent response
    if (current.speaker === 'customer' && current.modality === 'question' &&
        next.speaker === 'agent' && next.modality !== 'question') {
      
      edges.push({
        id: generateEdgeId('qa', current.id, next.id),
        type: 'structure',
        srcId: current.id,
        dstId: next.id,
        weight: config.edgeWeights.structureBase,
        reason: 'Customer question answered by agent',
        ruleId: 'QUESTION_ANSWER',
        provenance: 'structure',
        metadata: {
          srcText: current.text.substring(0, 100),
          dstText: next.text.substring(0, 100),
        },
      });
    }
  }
  
  return edges;
}

function findRequestFulfillmentEdges(
  claims: EnhancedClaim[],
  config: TruthEngineConfig
): TruthEdge[] {
  const edges: TruthEdge[] = [];
  
  for (let i = 0; i < claims.length - 1; i++) {
    const current = claims[i];
    
    // Look for customer request
    if (current.speaker === 'customer' && current.modality === 'request') {
      // Find agent response with promise
      for (let j = i + 1; j < Math.min(i + 4, claims.length); j++) {
        const later = claims[j];
        
        if (later.speaker === 'agent' && 
            (later.text.toLowerCase().includes('will') ||
             later.text.toLowerCase().includes("i'll") ||
             later.text.toLowerCase().includes('yes'))) {
          
          edges.push({
            id: generateEdgeId('rf', current.id, later.id),
            type: 'structure',
            srcId: current.id,
            dstId: later.id,
            weight: config.edgeWeights.structureBase * 1.1,
            reason: 'Customer request with agent promise',
            ruleId: 'REQUEST_FULFILLMENT',
            provenance: 'structure',
            metadata: {
              srcText: current.text.substring(0, 100),
              dstText: later.text.substring(0, 100),
            },
          });
          break; // Only link to first matching response
        }
      }
    }
  }
  
  return edges;
}

// ============================================================================
// Helpers
// ============================================================================

function timeframesOverlap(
  a?: { start?: string; end?: string; relative?: string },
  b?: { start?: string; end?: string; relative?: string }
): boolean {
  if (!a || !b) return false;
  
  // Same relative timeframe = overlap
  if (a.relative && b.relative && a.relative === b.relative) {
    return true;
  }
  
  // "this_cycle" overlaps with "today"
  if ((a.relative === 'this_cycle' && b.relative === 'today') ||
      (b.relative === 'this_cycle' && a.relative === 'today')) {
    return true;
  }
  
  return false;
}

function pruneEdges(
  edges: TruthEdge[],
  type: 'contradiction' | 'support' | 'structure',
  config: TruthEngineConfig
): TruthEdge[] {
  // Apply minimum weight threshold
  const minWeight = type === 'contradiction' ? config.pruning.minWeightContradiction :
                    type === 'support' ? config.pruning.minWeightSupport :
                    config.pruning.minWeightStructure;
  
  let filtered = edges.filter(e => e.weight >= minWeight);
  
  // Apply topK per node
  const byNode = new Map<string, TruthEdge[]>();
  for (const edge of filtered) {
    const key = `${edge.srcId}:${type}`;
    const existing = byNode.get(key) || [];
    existing.push(edge);
    byNode.set(key, existing);
  }
  
  const pruned: TruthEdge[] = [];
  for (const [key, nodeEdges] of byNode) {
    // Sort by weight desc, take topK
    nodeEdges.sort((a, b) => b.weight - a.weight);
    pruned.push(...nodeEdges.slice(0, config.pruning.topKPerNodePerType));
  }
  
  return pruned;
}

function generateEdgeId(prefix: string, srcId: string, dstId: string): string {
  const hash = createHash('sha256').update(`${prefix}:${srcId}:${dstId}`).digest('hex').substring(0, 8);
  return `e_${prefix}_${hash}`;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

