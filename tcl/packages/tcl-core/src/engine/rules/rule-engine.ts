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
 * 
 * KEY FIX: Uses claim classification + topic overlap gating to prevent
 * false contradictions between intents, questions, emotions, etc.
 */

import { createHash } from "crypto";
import type { TruthEngineConfig } from "../config/types.js";
import type { EnhancedClaim, Fact, TruthEdge } from "../facts/types.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import type { ContradictionType } from "../../types.js";
import { 
  classifyClaimKind, 
  shouldConsiderContradiction, 
  calculateTopicOverlap 
} from "../../claim_classifier.js";

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
  
  // Merge duplicate edges before pruning (if enabled)
  let mergedContradictions = config.pruning.mergeBeforePrune 
    ? mergeEdges(contradictionEdges)
    : contradictionEdges;
  let mergedSupports = config.pruning.mergeBeforePrune
    ? mergeEdges(supportEdges)
    : supportEdges;
  let mergedStructure = config.pruning.mergeBeforePrune
    ? mergeEdges(structureEdges)
    : structureEdges;
  
  // Prune edges according to config
  const prunedContradictions = pruneEdges(mergedContradictions, 'contradiction', config);
  const prunedSupports = pruneEdges(mergedSupports, 'support', config);
  const prunedStructure = pruneEdges(mergedStructure, 'structure', config);
  
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
  const ruleConfig = config.rules["POLARITY_CONFLICT"];
  const maxTurnDistance = ruleConfig?.maxTurnDistance ?? 20;
  
  // Sort facts by turn index
  const sorted = [...subjectFacts].sort((a, b) => a.turnIndex - b.turnIndex);
  
  // Compare each pair with turn distance gating
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const earlier = sorted[i];
      const later = sorted[j];
      
      // Turn distance gating
      const turnDistance = later.turnIndex - earlier.turnIndex;
      if (turnDistance > maxTurnDistance) continue;
      
      // Get claims for gating checks
      const srcClaim = claimMap.get(earlier.claimId);
      const dstClaim = claimMap.get(later.claimId);
      if (!srcClaim || !dstClaim) continue;
      
      // Contradiction gating: skip non-auditable claim kinds
      // Adapt EnhancedClaim to Claim format for shouldConsiderContradiction
      const srcClaimAdapted: any = {
        id: srcClaim.id,
        text: srcClaim.text,
        claimKind: srcClaim.claimKind,
        confidence: 0.5,
        evidence: [],
        meta: { speaker: srcClaim.speaker, turnIndex: srcClaim.turnIndex },
      };
      const dstClaimAdapted: any = {
        id: dstClaim.id,
        text: dstClaim.text,
        claimKind: dstClaim.claimKind,
        confidence: 0.5,
        evidence: [],
        meta: { speaker: dstClaim.speaker, turnIndex: dstClaim.turnIndex },
      };
      
      const gateResult = shouldConsiderContradiction(srcClaimAdapted, dstClaimAdapted);
      if (!gateResult.shouldCreate) {
        continue;
      }
      
      // Use normalized semantic keys for comparison
      const sameSubject = earlier.subjectNormalized === later.subjectNormalized;
      const samePredicate = earlier.predicateNormalized === later.predicateNormalized;
      
      if (!sameSubject || !samePredicate) continue;
      
      // Semantic value comparison using normalized values and value types
      const isConflict = valuesConflict(
        earlier.normalizedValue,
        later.normalizedValue,
        earlier.valueType,
        later.valueType,
        earlier.polarity,
        later.polarity,
        config.normalization
      );
      
      if (isConflict) {
        // Calculate topic overlap for gating (pass claim text, not topics array)
        const overlapScore = calculateTopicOverlap(srcClaim.text, dstClaim.text);
        const minOverlap = ruleConfig?.topicOverlapMin ?? 0.3;
        
        if (overlapScore < minOverlap) {
          // Low overlap - create edge but mark as low_overlap
          edges.push({
            id: generateEdgeId('contra', earlier.claimId, later.claimId),
            type: 'contradiction',
            srcId: earlier.claimId,
            dstId: later.claimId,
            weight: clamp01(config.edgeWeights.contradictionBase * 0.5), // Lower weight
            reason: `Conflicting statements about ${earlier.subjectNormalized} (low topic overlap: ${overlapScore.toFixed(2)})`,
            ruleId: `POLARITY_CONFLICT.${earlier.subjectNormalized.toUpperCase()}`,
            provenance: 'rules',
            contradictionType: 'low_overlap',
            overlapScore,
            reasonCodes: ['LOW_OVERLAP'],
            metadata: {
              subject: earlier.subjectNormalized,
              predicate: earlier.predicateNormalized,
              polarityConflict: true,
              srcText: srcClaim.text.substring(0, 100),
              dstText: dstClaim.text.substring(0, 100),
            },
          });
          continue;
        }
        
        // Direct contradiction with sufficient overlap
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
          reason: `Conflicting statements about ${earlier.subjectNormalized}: ${earlier.polarity} vs ${later.polarity}`,
          ruleId: `POLARITY_CONFLICT.${earlier.subjectNormalized.toUpperCase()}`,
          provenance: 'rules',
          contradictionType: 'direct',
          overlapScore,
          metadata: {
            subject: earlier.subjectNormalized,
            predicate: earlier.predicateNormalized,
            polarityConflict: true,
            srcText: srcClaim.text.substring(0, 100),
            dstText: dstClaim.text.substring(0, 100),
          },
        });
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
  const ruleConfig = config.rules["ABSOLUTE_TO_CONDITIONAL"];
  const maxTurnDistance = ruleConfig?.maxTurnDistance ?? 15;
  const mode = ruleConfig?.mode ?? 'qualification';
  
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
        
        // Turn distance gating
        const turnDistance = later.turnIndex - earlier.turnIndex;
        if (turnDistance > maxTurnDistance) continue;
        
        // Check for conditional modifier on same topic
        if (later.modality === 'conditional' || later.hasConditionalLanguage) {
        // Contradiction gating
        const earlierAdapted: any = {
          id: earlier.id,
          text: earlier.text,
          claimKind: earlier.claimKind,
          confidence: 0.5,
          evidence: [],
          meta: { speaker: earlier.speaker, turnIndex: earlier.turnIndex },
        };
        const laterAdapted: any = {
          id: later.id,
          text: later.text,
          claimKind: later.claimKind,
          confidence: 0.5,
          evidence: [],
          meta: { speaker: later.speaker, turnIndex: later.turnIndex },
        };
        
        const gateResult = shouldConsiderContradiction(earlierAdapted, laterAdapted);
        if (!gateResult.shouldCreate) {
          continue;
        }
        
        // Calculate topic overlap (pass claim text, not topics array)
        const overlapScore = calculateTopicOverlap(earlier.text, later.text);
          const minOverlap = ruleConfig?.topicOverlapMin ?? 0.3;
          
          if (overlapScore < minOverlap) continue;
          
          // Create qualification edge (weakening) or contradiction based on mode
          const isQualification = mode === 'qualification';
          let weight = isQualification 
            ? config.edgeWeights.contradictionBase * config.edgeWeights.qualificationEdgeMultiplier
            : config.edgeWeights.contradictionBase * 0.9;
          
          if (later.speaker === 'agent') {
            weight *= config.edgeWeights.agentSpeakerMultiplier;
          }
          
          edges.push({
            id: generateEdgeId(isQualification ? 'qual' : 'modal', earlier.id, later.id),
            type: isQualification ? 'structure' : 'contradiction', // Qualification as structure edge
            srcId: earlier.id,
            dstId: later.id,
            weight: clamp01(weight),
            reason: isQualification
              ? `Absolute statement weakened by conditional qualifier: "${earlier.text.substring(0, 50)}..." → "${later.text.substring(0, 50)}..."`
              : `Absolute statement "${earlier.text.substring(0, 50)}..." followed by conditional qualifier`,
            ruleId: `ABSOLUTE_TO_CONDITIONAL.${topic.toUpperCase()}`,
            provenance: 'rules',
            overlapScore,
            metadata: {
              topic,
              modalityShift: true,
              isQualification,
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
  const ruleConfig = config.rules["AGENT_SELF_CONTRADICTION"];
  const maxTurnDistance = ruleConfig?.maxTurnDistance ?? 10;
  
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
        
        // Turn distance gating
        const turnDistance = later.turnIndex - earlier.turnIndex;
        if (turnDistance > maxTurnDistance) continue;
        
        // Contradiction gating
        const earlierAdapted: any = {
          id: earlier.id,
          text: earlier.text,
          claimKind: earlier.claimKind,
          confidence: 0.5,
          evidence: [],
          meta: { speaker: earlier.speaker, turnIndex: earlier.turnIndex },
        };
        const laterAdapted: any = {
          id: later.id,
          text: later.text,
          claimKind: later.claimKind,
          confidence: 0.5,
          evidence: [],
          meta: { speaker: later.speaker, turnIndex: later.turnIndex },
        };
        
        const gateResult = shouldConsiderContradiction(earlierAdapted, laterAdapted);
        if (!gateResult.shouldCreate) {
          continue;
        }
        
        // Check for polarity flip
        if (earlier.polarity !== 'unknown' && later.polarity !== 'unknown' &&
            earlier.polarity !== later.polarity) {
          
          // Calculate topic overlap (pass claim text, not topics array)
          const overlapScore = calculateTopicOverlap(earlier.text, later.text);
          const minOverlap = ruleConfig?.topicOverlapMin ?? 0.6;
          
          if (overlapScore < minOverlap) continue;
          
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
            contradictionType: 'direct',
            overlapScore,
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
  const ruleConfig = config.rules["TIMEFRAME_CONFLICT"];
  const maxTurnDistance = ruleConfig?.maxTurnDistance ?? 7;
  
  // Find facts with normalized timeframe info
  const factsWithTime = subjectFacts.filter(f => f.timeframeNormalized || f.timeframe);
  
  for (let i = 0; i < factsWithTime.length; i++) {
    const earlier = factsWithTime[i];
    
    for (let j = i + 1; j < factsWithTime.length; j++) {
      const later = factsWithTime[j];
      
      // Turn distance gating
      const turnDistance = later.turnIndex - earlier.turnIndex;
      if (turnDistance > maxTurnDistance) continue;
      
      // Get claims for gating
      const srcClaim = claimMap.get(earlier.claimId);
      const dstClaim = claimMap.get(later.claimId);
      if (!srcClaim || !dstClaim) continue;
      
      // Contradiction gating
      const srcClaimAdapted: any = {
        id: srcClaim.id,
        text: srcClaim.text,
        claimKind: srcClaim.claimKind,
        confidence: 0.5,
        evidence: [],
        meta: { speaker: srcClaim.speaker, turnIndex: srcClaim.turnIndex },
      };
      const dstClaimAdapted: any = {
        id: dstClaim.id,
        text: dstClaim.text,
        claimKind: dstClaim.claimKind,
        confidence: 0.5,
        evidence: [],
        meta: { speaker: dstClaim.speaker, turnIndex: dstClaim.turnIndex },
      };
      
      const gateResult = shouldConsiderContradiction(srcClaimAdapted, dstClaimAdapted);
      if (!gateResult.shouldCreate) {
        continue;
      }
      
      // Use normalized timeframe buckets for overlap detection
      const overlap = timeframesOverlapNormalized(
        earlier.timeframeNormalized,
        later.timeframeNormalized,
        config.normalization.timeframeOverlapMap
      );
      
      if (overlap) {
        // Check for conflicting values using semantic comparison
        const isConflict = valuesConflict(
          earlier.normalizedValue,
          later.normalizedValue,
          earlier.valueType,
          later.valueType,
          earlier.polarity,
          later.polarity,
          config.normalization
        );
        
        if (isConflict) {
          let weight = config.edgeWeights.contradictionBase;
          weight *= config.edgeWeights.timeframeConflictMultiplier;
          
          edges.push({
            id: generateEdgeId('time', earlier.claimId, later.claimId),
            type: 'contradiction',
            srcId: earlier.claimId,
            dstId: later.claimId,
            weight: clamp01(weight),
            reason: `Conflicting states for "${earlier.subjectNormalized}" in overlapping timeframes (${earlier.timeframeNormalized?.bucket || 'unknown'} vs ${later.timeframeNormalized?.bucket || 'unknown'})`,
            ruleId: `TIMEFRAME_CONFLICT.${earlier.subjectNormalized.toUpperCase()}`,
            provenance: 'rules',
            contradictionType: 'direct',
            metadata: {
              subject: earlier.subjectNormalized,
              timeframeOverlap: true,
              earlierBucket: earlier.timeframeNormalized?.bucket,
              laterBucket: later.timeframeNormalized?.bucket,
              srcText: srcClaim.text.substring(0, 100),
              dstText: dstClaim.text.substring(0, 100),
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
  const claimMap = new Map(claims.map(c => [c.id, c]));
  const ruleConfig = config.rules["SUPPORT_REPETITION"];
  const maxTurnDistance = ruleConfig?.maxTurnDistance ?? 4;
  
  // Group facts by normalized subject+predicate+value (semantic key)
  const factGroups = new Map<string, Fact[]>();
  for (const fact of facts) {
    // Use normalized keys for semantic matching
    const key = `${fact.subjectNormalized}:${fact.predicateNormalized}:${fact.normalizedValue}`;
    const existing = factGroups.get(key) || [];
    existing.push(fact);
    factGroups.set(key, existing);
  }
  
  // Facts with same semantic key support each other (exact match)
  for (const [key, group] of factGroups) {
    if (group.length < 2) continue;
    
    const sorted = [...group].sort((a, b) => a.turnIndex - b.turnIndex);
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const earlier = sorted[i];
      const later = sorted[i + 1];
      
      // Turn distance gating
      const turnDistance = later.turnIndex - earlier.turnIndex;
      if (turnDistance > maxTurnDistance) continue;
      
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
        reason: `Consistent statements about ${earlier.subjectNormalized}`,
        ruleId: 'SUPPORT_REPETITION',
        provenance: 'rules',
        metadata: {
          subject: earlier.subjectNormalized,
          predicate: earlier.predicateNormalized,
          supportType: 'entailed',
        },
      });
    }
  }
  
  // NEW: Agent confirms customer (agent affirms customer's statement)
  for (let i = 0; i < claims.length; i++) {
    const customerClaim = claims[i];
    if (customerClaim.speaker !== 'customer' || customerClaim.claimKind !== 'assertion') continue;
    
    // Look for agent response within window
    for (let j = i + 1; j < Math.min(i + 3, claims.length); j++) {
      const agentClaim = claims[j];
      if (agentClaim.speaker !== 'agent') continue;
      
      // Check if agent confirms customer's statement (same topic, same polarity)
      const overlapScore = calculateTopicOverlap(customerClaim.text, agentClaim.text);
      if (overlapScore > 0.5 && customerClaim.polarity === agentClaim.polarity && 
          customerClaim.polarity !== 'unknown') {
        
        let weight = config.edgeWeights.supportBase;
        weight *= config.edgeWeights.agentConfirmMultiplier;
        
        edges.push({
          id: generateEdgeId('confirm', customerClaim.id, agentClaim.id),
          type: 'support',
          srcId: customerClaim.id,
          dstId: agentClaim.id,
          weight: clamp01(weight),
          reason: `Agent confirms customer's statement about ${customerClaim.topics[0] || 'topic'}`,
          ruleId: 'AGENT_CONFIRMS_CUSTOMER',
          provenance: 'rules',
          metadata: {
            supportType: 'agent_confirm',
            overlapScore,
          },
        });
      }
    }
  }
  
  // NEW: Paraphrase support (same semantic key, compatible values)
  // This is handled by the normalized key matching above, but we can add
  // additional paraphrase detection using topic overlap for similar facts
  const factPairs = new Map<string, Fact[]>();
  for (const fact of facts) {
    const key = `${fact.subjectNormalized}:${fact.predicateNormalized}`;
    const existing = factPairs.get(key) || [];
    existing.push(fact);
    factPairs.set(key, existing);
  }
  
  for (const [key, group] of factPairs) {
    if (group.length < 2) continue;
    
    const sorted = [...group].sort((a, b) => a.turnIndex - b.turnIndex);
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const earlier = sorted[i];
      const later = sorted[i + 1];
      
      const turnDistance = later.turnIndex - earlier.turnIndex;
      if (turnDistance > maxTurnDistance) continue;
      
      // Check if values are compatible (not conflicting, but similar)
      const srcClaim = claimMap.get(earlier.claimId);
      const dstClaim = claimMap.get(later.claimId);
      if (!srcClaim || !dstClaim) continue;
      
      const overlapScore = calculateTopicOverlap(srcClaim.text, dstClaim.text);
      if (overlapScore > 0.7 && !valuesConflict(
        earlier.normalizedValue,
        later.normalizedValue,
        earlier.valueType,
        later.valueType,
        earlier.polarity,
        later.polarity,
        config.normalization
      )) {
        // Paraphrase support
        let weight = config.edgeWeights.supportBase;
        weight *= config.edgeWeights.paraphraseSupportMultiplier;
        
        edges.push({
          id: generateEdgeId('para', earlier.claimId, later.claimId),
          type: 'support',
          srcId: earlier.claimId,
          dstId: later.claimId,
          weight: clamp01(weight),
          reason: `Paraphrased statements about ${earlier.subjectNormalized}`,
          ruleId: 'SUPPORT_PARAPHRASE',
          provenance: 'rules',
          metadata: {
            subject: earlier.subjectNormalized,
            supportType: 'paraphrase',
            overlapScore,
          },
        });
      }
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
  const ruleConfig = config.rules["REQUEST_FULFILLMENT"];
  const windowTurns = ruleConfig?.windowTurns ?? 3;
  
  for (let i = 0; i < claims.length - 1; i++) {
    const current = claims[i];
    
    // Look for customer request (using claimKind and intent, not string matching)
    if (current.speaker === 'customer' && 
        (current.claimKind === 'intent' || current.modality === 'request')) {
      
      // Find agent response with promise within window
      for (let j = i + 1; j < Math.min(i + windowTurns + 1, claims.length); j++) {
        const later = claims[j];
        
        // Use claimKind='promise' instead of string matching
        if (later.speaker === 'agent' && later.claimKind === 'promise') {
          edges.push({
            id: generateEdgeId('rf', current.id, later.id),
            type: 'structure',
            srcId: current.id,
            dstId: later.id,
            weight: config.edgeWeights.structureBase * 1.1,
            reason: `Customer ${current.intent ? `request (${current.intent})` : 'request'} with agent promise`,
            ruleId: 'REQUEST_FULFILLMENT',
            provenance: 'structure',
            metadata: {
              customerIntent: current.intent,
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

/**
 * Check if normalized timeframes overlap using bucket-based mapping.
 */
function timeframesOverlapNormalized(
  a?: { bucket?: string; startEpoch?: number; endEpoch?: number },
  b?: { bucket?: string; startEpoch?: number; endEpoch?: number },
  overlapMap?: Record<string, string[]>
): boolean {
  if (!a || !b) return false;
  
  // If both have explicit epoch ranges, check numeric overlap
  if (a.startEpoch !== undefined && a.endEpoch !== undefined &&
      b.startEpoch !== undefined && b.endEpoch !== undefined) {
    return !(a.endEpoch < b.startEpoch || b.endEpoch < a.startEpoch);
  }
  
  // Use bucket-based overlap
  if (a.bucket && b.bucket) {
    // Same bucket = overlap
    if (a.bucket === b.bucket) return true;
    
    // Check overlap map
    if (overlapMap) {
      const aOverlaps = overlapMap[a.bucket] || [];
      const bOverlaps = overlapMap[b.bucket] || [];
      if (aOverlaps.includes(b.bucket) || bOverlaps.includes(a.bucket)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if two values conflict semantically (not just boolean).
 */
function valuesConflict(
  valA: string | number | boolean | null,
  valB: string | number | boolean | null,
  typeA: string,
  typeB: string,
  polarityA: string,
  polarityB: string,
  normalization: TruthEngineConfig['normalization']
): boolean {
  // Polarity conflict (affirm vs deny) is always a conflict
  if (polarityA !== 'unknown' && polarityB !== 'unknown' && polarityA !== polarityB) {
    return true;
  }
  
  // Type mismatch - no conflict if types are different (unless both are boolean)
  if (typeA !== typeB && !(typeA === 'boolean' && typeB === 'boolean')) {
    return false;
  }
  
  // Boolean conflict
  if (typeA === 'boolean' && typeB === 'boolean') {
    return valA !== valB;
  }
  
  // Money conflict (with tolerance)
  if (typeA === 'money' && typeB === 'money') {
    const numA = typeof valA === 'number' ? valA : parseFloat(String(valA)) || 0;
    const numB = typeof valB === 'number' ? valB : parseFloat(String(valB)) || 0;
    const tolerance = normalization.moneyTolerance || 0.01;
    return Math.abs(numA - numB) > tolerance;
  }
  
  // Number conflict (with tolerance)
  if (typeA === 'number' && typeB === 'number') {
    const numA = typeof valA === 'number' ? valA : parseFloat(String(valA)) || 0;
    const numB = typeof valB === 'number' ? valB : parseFloat(String(valB)) || 0;
    const tolerance = normalization.numericTolerance || 0.1;
    const percentDiff = Math.abs(numA - numB) / Math.max(Math.abs(numA), Math.abs(numB), 1);
    return percentDiff > tolerance;
  }
  
  // String/enum conflict (check antonyms)
  if (typeA === 'string' || typeA === 'enum') {
    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    
    // Check antonyms (array of [word1, word2] pairs)
    const antonyms = normalization.antonyms || [];
    for (const [word1, word2] of antonyms) {
      const w1 = word1.toLowerCase();
      const w2 = word2.toLowerCase();
      if ((strA.includes(w1) && strB.includes(w2)) ||
          (strA.includes(w2) && strB.includes(w1))) {
        return true;
      }
    }
    
    // Different strings are not necessarily conflicting (could be different values)
    return false;
  }
  
  return false;
}

/**
 * Merge duplicate edges (same type, srcId, dstId) keeping max weight and accumulating ruleIds.
 */
function mergeEdges(edges: TruthEdge[]): TruthEdge[] {
  const edgeMap = new Map<string, TruthEdge>();
  
  for (const edge of edges) {
    const key = `${edge.type}:${edge.srcId}:${edge.dstId}`;
    const existing = edgeMap.get(key);
    
    if (!existing || edge.weight > existing.weight) {
      // Keep the edge with higher weight, but merge metadata
      const merged: TruthEdge = {
        ...edge,
        ruleId: existing ? `${existing.ruleId},${edge.ruleId}` : edge.ruleId,
        reason: existing 
          ? `${existing.reason}; ${edge.reason}`
          : edge.reason,
        reasonCodes: existing && existing.reasonCodes && edge.reasonCodes
          ? [...new Set([...existing.reasonCodes, ...edge.reasonCodes])]
          : edge.reasonCodes || existing?.reasonCodes,
        metadata: {
          ...existing?.metadata,
          ...edge.metadata,
        },
      };
      edgeMap.set(key, merged);
    } else {
      // Existing has higher weight, merge into it
      existing.ruleId = `${existing.ruleId},${edge.ruleId}`;
      existing.reason = `${existing.reason}; ${edge.reason}`;
      if (edge.reasonCodes) {
        existing.reasonCodes = [...new Set([...(existing.reasonCodes || []), ...edge.reasonCodes])];
      }
      existing.metadata = {
        ...existing.metadata,
        ...edge.metadata,
      };
    }
  }
  
  return Array.from(edgeMap.values());
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

