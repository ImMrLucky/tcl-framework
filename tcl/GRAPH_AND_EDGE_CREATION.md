# How the App Creates Edges and Graph

This document explains the detailed mechanics of how edges and the graph are created in the unified graph builder.

## Overview

The graph creation follows a **3-stage pipeline**:

1. **Candidate Generation** (High Recall) - Find potential edge pairs
2. **Edge Classification** (Precision) - Classify candidates into edge types
3. **Weight Calibration** - Assign weights to edges

## Stage 1: Candidate Generation

**File**: `packages/tcl-core/src/graph/candidate-generation.ts`

### Purpose
Generate candidate pairs for potential edges **without** scoring everything. Uses per-claim budgets to ensure each claim gets fair consideration.

### Process

For each claim, the system generates 4 types of candidates:

#### 1. Contradiction Candidates (Claim → Claim)
```typescript
function getCandidatesForContradiction(claim, allClaims, budget, weights)
```

**What it does:**
- Compares claim against all other claims
- Computes retrieval signals:
  - **Slot Match**: Do they share the same subject slot?
  - **Entity Overlap**: Do they mention the same entities?
  - **Semantic Similarity**: Are they textually similar?
  - **Temporal Proximity**: Are they close in the conversation?
  - **Speaker Role**: Are they from different speakers (agent vs customer)?
- Computes weighted retrieval score
- Returns top K candidates (per budget)

**Example:**
```
Claim A: "The account balance is $100"
Claim B: "The account balance is $200"
→ High slot match (both about "account balance")
→ High entity overlap (both mention "account")
→ High semantic similarity
→ Retrieval score: 0.95
```

#### 2. Support Candidates (Claim → Claim)
```typescript
function getCandidatesForSupport(claim, allClaims, budget, weights)
```

**What it does:**
- Similar to contradiction, but weights semantic similarity higher
- Lower slot weight (support doesn't require exact slot match)
- Returns top K candidates

#### 3. Support Evidence Candidates (Claim → Evidence)
```typescript
function getCandidatesForEvidenceSupport(claim, evidenceNodes, budget, weights)
```

**What it does:**
- Compares claim against external evidence (policies, documents)
- Prioritizes content match over slot match
- Returns top K candidates

#### 4. Grounding Candidates (Claim → Transcript)
```typescript
function getCandidatesForGrounding(claim, transcriptEvidence, budget, weights)
```

**What it does:**
- Compares claim against transcript evidence nodes
- Prioritizes exact text match and temporal proximity
- Returns top K candidates

### Signal Computation

**For Claim-Claim pairs:**
```typescript
function computeRetrievalSignals(a: ClaimNode, b: ClaimNode): CandidateSignals {
  return {
    slotMatch: computeSlotSimilarity(a.slot, b.slot),        // 0-1
    entityOverlap: computeEntityOverlap(a.entities, b.entities), // 0-1
    semanticSimilarity: computeTextSimilarity(a.text, b.text),     // 0-1
    temporalProximity: computeTemporalProximity(a, b),            // 0-1
    speakerRole: computeSpeakerRoleScore(a.speakerRole, b.speakerRole), // 0-1
  };
}
```

**For Claim-Evidence pairs:**
```typescript
function computeClaimEvidenceSignals(claim, evidence): CandidateSignals {
  return {
    slotMatch: 0, // N/A for evidence
    entityOverlap: computeEntityOverlapWithEvidence(claim.entities, evidence),
    semanticSimilarity: computeTextSimilarity(claim.text, evidenceText),
    temporalProximity: computeTemporalProximity(claim, evidence), // Based on turn IDs
    speakerRole: 0, // N/A
  };
}
```

### Budget System

**Per-Claim Budgets** (from template config):
- `perClaim.contradictionPairs`: e.g., 10 candidates per claim
- `perClaim.supportClaimPairs`: e.g., 10 candidates per claim
- `perClaim.supportEvidencePairs`: e.g., 5 candidates per claim
- `perClaim.groundingPairs`: e.g., 3 candidates per claim

**Why per-claim budgets?**
- Ensures each claim gets fair consideration
- Prevents "starving" claims in large transcripts
- Global caps can be unfair (one claim might get all candidates)

## Stage 2: Edge Classification

**File**: `packages/tcl-core/src/graph/edge-classification.ts`

### Purpose
Classify candidates into actual edges with **strict gating rules** to prevent false positives.

### Gating Rules (Critical!)

#### For Contradiction Edges:

**GATE 1: Slot Compatibility**
```typescript
const exactSlotMatch = slotsMatch(claimA.slot, claimB.slot);
const sameSlotType = claimA.slot.slotType === claimB.slot.slotType;
const hasSharedSubject = hasSharedSubjectReference(claimA, claimB);

if (!exactSlotMatch && !sameSlotType && !hasSharedSubject) {
  return { rejected: true, reason: 'slot' };
}
```

**Why?** Only claims about the same subject can contradict:
- ✅ "Account A: $100" vs "Account A: $200" → Same slot → Can contradict
- ❌ "Account A: $100" vs "Account B: $200" → Different slots → Cannot contradict

**GATE 2: Topic Match** (if configured)
```typescript
if (claimA.topicId && claimB.topicId && claimA.topicId !== claimB.topicId) {
  const turnDistance = Math.abs(turnA - turnB);
  if (turnDistance > 5) {
    return { rejected: true, reason: 'topic' };
  }
}
```

**Why?** Claims in different topics are less likely to contradict (unless very close in conversation).

**GATE 3: Polarity Check**
```typescript
if (!hasOpposingPolarity(claimA, claimB)) {
  return { rejected: true, reason: 'polarity' };
}
```

**What is opposing polarity?**
- One negated, one not: "I didn't add that" vs "It was added"
- Opposing values: "increase" vs "decrease", "higher" vs "lower"
- Denial patterns: "I never..." vs "was added"
- Assertion patterns: "was added" vs "I didn't"

**GATE 4: Threshold Check**
```typescript
const contradictionScore = computeContradictionScore(claimA, claimB, signals);
if (contradictionScore < config.thresholds.contradiction) {
  return { rejected: true, reason: 'threshold' };
}
```

**Score computation:**
```typescript
function computeContradictionScore(a, b, signals): number {
  let score = signals.slotMatch * weights.entityMatch;
  score += signals.semanticSimilarity * 0.3;
  score += polarityConfidence * weights.polarityMatch;
  if (valuesContradict(a.slot, b.slot)) {
    score += 0.3; // Strong signal
  }
  return Math.min(1, Math.max(0, score));
}
```

#### For Support Edges:

**Claim-to-Claim Support:**
```typescript
function classifyClaimSupport(candidate, config): ClassificationResult {
  const supportScore = computeSupportScore(claimA, claimB, signals);
  if (supportScore < config.thresholds.support) {
    return { rejected: true, reason: 'threshold' };
  }
  return { edge: createSupportEdge(...), rejected: false };
}
```

**Claim-to-Evidence Support:**
```typescript
function classifyEvidenceSupport(candidate, config): ClassificationResult {
  const evidenceStrength = config.weights.evidenceStrength[evidence.evidenceKind] || 0.5;
  const supportScore = computeEvidenceSupportScore(claim, evidence, signals) * evidenceStrength;
  if (supportScore < config.thresholds.support) {
    return { rejected: true, reason: 'threshold' };
  }
  return { edge: createSupportEdge(...), rejected: false };
}
```

#### For Grounding Edges:

```typescript
function classifyGrounding(candidate, config): ClassificationResult {
  // Grounding only applies to transcript evidence
  if (evidence.evidenceKind !== 'transcript') {
    return { rejected: true, reason: 'threshold' };
  }
  
  // Compute grounding score using text match AND temporal proximity
  const groundingScore = (signals.semanticSimilarity * 0.6) + (signals.temporalProximity * 0.4);
  
  // Lower threshold for grounding - we want most claims to be grounded
  const effectiveThreshold = Math.min(config.thresholds.grounding, 0.4);
  
  if (groundingScore < effectiveThreshold) {
    return { rejected: true, reason: 'threshold' };
  }
  
  return { edge: createGroundingEdge(...), rejected: false };
}
```

### Edge Creation

Once a candidate passes all gates, an edge is created:

**Contradiction Edge:**
```typescript
function createContradictionEdge(a, b, weight, signals): GraphEdge {
  return {
    id: `contradiction-${a.id}-${b.id}`,
    type: 'CONTRADICTION',
    from: a.id,
    to: b.id,
    weight,
    rationale: {
      method: 'hybrid',
      signals: {
        slotMatchScore: signals.slotMatch,
        entityMatchScore: signals.entityOverlap,
        semanticSimilarity: signals.semanticSimilarity,
        hasOpposingPolarity: hasOpposingPolarity(a, b),
        hasValueContradiction: valuesContradict(a.slot, b.slot),
      },
    },
    provenance: {
      spanPairs: [
        {
          fromSpan: { start: a.span.startChar, end: a.span.endChar, text: a.text },
          toSpan: { start: b.span.startChar, end: b.span.endChar, text: b.text },
        },
      ],
    },
    slot: {
      slotType: a.slot.slotType,
      entityKey: a.slot.entityKey,
    },
    topicId: a.topicId,
    createdAt: new Date().toISOString(),
  };
}
```

**Support Edge:**
```typescript
function createSupportEdge(fromId, toId, weight, signals, sourceType): GraphEdge {
  return {
    id: `support-${fromId}-${toId}`,
    type: 'SUPPORT',
    from: fromId,
    to: toId,
    weight,
    rationale: {
      method: sourceType === 'evidence' ? 'retrieval+rerank' : 'hybrid',
      signals: {
        slotMatchScore: signals.slotMatch,
        entityMatchScore: signals.entityOverlap,
        semanticSimilarity: signals.semanticSimilarity,
        sourceType,
      },
    },
    provenance: {
      sourceIds: [toId],
    },
    createdAt: new Date().toISOString(),
  };
}
```

**Grounding Edge:**
```typescript
function createGroundingEdge(claim, evidence, weight, signals): GraphEdge {
  return {
    id: `grounding-${claim.id}-${evidence.id}`,
    type: 'GROUNDING',
    from: claim.id,
    to: evidence.id,
    weight,
    rationale: {
      method: 'semantic',
      signals: {
        semanticSimilarity: signals.semanticSimilarity,
      },
    },
    provenance: {
      anchors: evidence.anchors,
      sourceIds: [evidence.id],
    },
    slot: {
      slotType: claim.slot.slotType,
      entityKey: claim.slot.entityKey,
    },
    createdAt: new Date().toISOString(),
  };
}
```

### Deduplication

After classification, edges are deduplicated:

```typescript
function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  
  for (const edge of edges) {
    // For undirected edges like contradiction, normalize the key
    let key: string;
    if (edge.type === 'CONTRADICTION') {
      const sorted = [edge.from, edge.to].sort();
      key = `${edge.type}-${sorted[0]}-${sorted[1]}`;
    } else {
      key = `${edge.type}-${edge.from}-${edge.to}`;
    }
    
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    } else {
      // Keep the higher-weight edge
      const existingIndex = result.findIndex(e => ...);
      if (existingIndex >= 0 && result[existingIndex].weight < edge.weight) {
        result[existingIndex] = edge;
      }
    }
  }
  
  return result;
}
```

## Stage 3: Weight Calibration

**File**: `packages/tcl-core/src/graph/weight-calibration.ts`

### Purpose
Refine edge weights based on:
- Classification confidence
- Edge type
- Node properties (claim modality, evidence strength)

### Process

```typescript
export function calibrateEdges(
  edges: GraphEdge[],
  claimMap: Map<string, ClaimNode>,
  evidenceMap: Map<string, EvidenceNode>
): GraphEdge[] {
  return edges.map(edge => {
    const fromNode = claimMap.get(edge.from) || evidenceMap.get(edge.from);
    const toNode = claimMap.get(edge.to) || evidenceMap.get(edge.to);
    
    // Apply calibration factors
    let calibratedWeight = edge.weight;
    
    // Boost for high-confidence signals
    if (edge.rationale?.signals) {
      const signals = edge.rationale.signals;
      if (signals.slotMatchScore > 0.8) {
        calibratedWeight *= 1.1;
      }
      if (signals.semanticSimilarity > 0.8) {
        calibratedWeight *= 1.1;
      }
    }
    
    // Boost for evidence strength
    if (toNode && 'evidenceKind' in toNode) {
      const evidenceStrength = getEvidenceStrength(toNode.evidenceKind);
      calibratedWeight *= evidenceStrength;
    }
    
    // Normalize to 0-1
    calibratedWeight = Math.min(1, Math.max(0, calibratedWeight));
    
    return {
      ...edge,
      weight: calibratedWeight,
    };
  });
}
```

## Subject Slots: The Key Innovation

**File**: `packages/tcl-core/src/graph/subject-slot.ts`

### What is a Subject Slot?

A subject slot identifies **what** a claim is about:

```typescript
interface SubjectSlot {
  slotType: string;      // e.g., "account_balance", "refund_amount", "plan_tier"
  entityKey: string;     // e.g., "account_123", "refund_456", "plan_premium"
  value?: any;           // e.g., 100 (dollars), "premium"
  valueNorm?: string;    // Normalized value
  qualifiers?: Record<string, any>; // Additional context
}
```

### How Slots are Computed

**Step 1: Extract Entities**
```typescript
const entities = extractEntities(claimText);
// Extracts: MONEY, PERCENT, DATE, DURATION, and lexicon-based entities
```

**Step 2: Match to Slot Lexicon**
```typescript
const lexiconEntities = entities.filter(e => 
  Object.values(config.slotLexicon).some(l => l.entityKey === e.normalized)
);

if (lexiconEntities.length > 0) {
  const primary = lexiconEntities[0];
  const lexiconEntry = Object.values(config.slotLexicon).find(
    l => l.entityKey === primary.normalized
  );
  
  return {
    slotType: lexiconEntry.slotType,
    entityKey: lexiconEntry.entityKey,
    value: extractSlotValue(entities),
    valueNorm: normalizeSlotValue(extractSlotValue(entities)),
  };
}
```

**Step 3: Infer from Entity Types**
```typescript
const primaryEntityType = inferPrimaryEntityType(entities);
// Priority: FEE, PROMO, CONTRACT, PLAN, PAYMENT, SERVICE, ACTION, MONEY, DATE
```

**Step 4: Semantic Fallback**
```typescript
const keyTerms = extractKeyTerms(text);
// Extract significant words (non-stopwords, length > 2)
```

### Slot Matching

**Exact Match:**
```typescript
export function slotsMatch(a: SubjectSlot, b: SubjectSlot): boolean {
  return a.slotType === b.slotType && a.entityKey === b.entityKey;
}
```

**Similarity:**
```typescript
export function computeSlotSimilarity(a: SubjectSlot, b: SubjectSlot): number {
  if (a.slotType !== b.slotType) return 0;
  if (a.entityKey === b.entityKey) return 1;
  return 0.3; // Partial credit for same slot type but different entity key
}
```

**Value Contradiction:**
```typescript
export function valuesContradict(a: SubjectSlot, b: SubjectSlot): boolean {
  if (!slotsMatch(a, b)) return false;
  if (a.valueNorm === undefined || b.valueNorm === undefined) return false;
  return a.valueNorm !== b.valueNorm;
}
```

## Complete Flow Example

### Input
```
Transcript:
- Turn 1 (Agent): "The account balance is $100"
- Turn 2 (Customer): "No, the account balance is $200"
- Turn 3 (Agent): "I see $100 in our system"
```

### Step 1: Claim Extraction
```typescript
claims = [
  { id: "c1", text: "The account balance is $100", speakerRole: "agent", ... },
  { id: "c2", text: "No, the account balance is $200", speakerRole: "customer", ... },
  { id: "c3", text: "I see $100 in our system", speakerRole: "agent", ... },
]
```

### Step 2: Subject Slot Computation
```typescript
c1.slot = { slotType: "account_balance", entityKey: "account_123", value: 100 }
c2.slot = { slotType: "account_balance", entityKey: "account_123", value: 200 }
c3.slot = { slotType: "account_balance", entityKey: "account_123", value: 100 }
```

### Step 3: Candidate Generation
```typescript
// For c1:
contradictionCandidates = [
  { claimA: c1, claimB: c2, retrievalScore: 0.95, signals: {...} },
  { claimA: c1, claimB: c3, retrievalScore: 0.85, signals: {...} },
]
```

### Step 4: Edge Classification

**c1 ↔ c2:**
- ✅ Slot match: `slotsMatch(c1.slot, c2.slot)` → `true` (same slot)
- ✅ Topic match: Same topic
- ✅ Polarity: `hasOpposingPolarity(c1, c2)` → `true` ("is $100" vs "is $200")
- ✅ Threshold: `contradictionScore = 0.92` > `threshold = 0.5`
- **Result**: ✅ Create contradiction edge

**c1 ↔ c3:**
- ✅ Slot match: `true`
- ✅ Topic match: `true`
- ❌ Polarity: `hasOpposingPolarity(c1, c3)` → `false` (both say $100)
- **Result**: ❌ Rejected (no opposing polarity)

### Step 5: Weight Calibration
```typescript
contradictionEdge.weight = 0.92 * 1.1 (slot match boost) = 1.0 (capped)
```

### Step 6: Graph Assembly
```typescript
graph = {
  nodes: {
    claims: [c1, c2, c3],
    evidence: [...],
  },
  edges: {
    contradiction: [
      { from: "c1", to: "c2", weight: 1.0, type: "CONTRADICTION" }
    ],
    support: [],
    grounding: [...],
  }
}
```

## Key Design Principles

1. **Slot-First Gating**: Contradictions require same slot (prevents false positives)
2. **Per-Claim Budgets**: Ensures fair candidate distribution
3. **Multi-Stage Filtering**: High recall → High precision
4. **Provenance Tracking**: Every edge has rationale and provenance
5. **Config-Driven**: All thresholds and weights are configurable

## Configuration

All thresholds, weights, and budgets are in template config:

```typescript
interface TemplateConfig {
  thresholds: {
    contradiction: number;  // e.g., 0.5
    support: number;        // e.g., 0.4
    grounding: number;       // e.g., 0.3
  };
  budgets: {
    perClaim: {
      contradictionPairs: number;  // e.g., 10
      supportClaimPairs: number;   // e.g., 10
      supportEvidencePairs: number; // e.g., 5
      groundingPairs: number;       // e.g., 3
    };
  };
  weights: {
    retrieval: {
      slotMatch: number;
      entityOverlap: number;
      semanticSimilarity: number;
      temporalProximity: number;
      speakerRole: number;
    };
    calibration: {
      entityMatch: number;
      polarityMatch: number;
    };
  };
  gating: {
    contradictionRequiresSameSlot: boolean;
    contradictionRequiresOpposingPolarity: boolean;
    contradictionRequiresSameTopic: boolean;
  };
}
```

## Summary

The graph creation process is:

1. **Extract claims** with subject slots
2. **Generate candidates** using per-claim budgets
3. **Classify edges** with strict gating rules
4. **Calibrate weights** based on confidence
5. **Assemble graph** with nodes and edges
6. **Derive truth states** from graph structure

The key innovation is **subject slots**, which prevent false contradictions by ensuring only claims about the same subject can contradict each other.

