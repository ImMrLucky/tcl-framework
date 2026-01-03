# Spec Feedback: Graph Quality Hardening for Truth Engine

## ✅ **Overall Assessment: EXCELLENT & CRITICAL**

This spec addresses a **real production problem** and provides a **sound architectural solution**. The approach is well-reasoned and will significantly improve graph quality and spectral analysis reliability.

---

## 🎯 **Strengths of the Spec**

### 1. **Architectural Principle is Correct**
✅ **"Spectral is a structure amplifier, not a semantic reasoner"** - This is the key insight. Spectral analysis amplifies what's already in the graph; it cannot fix semantic errors.

### 2. **Problem Identification is Accurate**
✅ The examples (Promise ↔ Policy, Customer intent ↔ Agent factual, Explanation ↔ Follow-up) are real issues that inflate contradiction energy and destroy trust.

### 3. **Three-Gate Strategy is Sound**
✅ Claim Type Compatibility + Proposition Signature Match + Temporal/Scope Overlap provides comprehensive semantic gating.

### 4. **Edge Downgrading is Smart**
✅ Instead of dropping edges, downgrading to structure/context/support preserves graph connectivity while avoiding spectral poisoning.

### 5. **Single Source of Truth**
✅ Centralizing thresholds in `scoring.json` prevents drift and makes tuning auditable.

---

## 🔧 **Implementation Considerations & Refinements**

### 1. **ClaimType vs ClaimKind (Needs Clarification)**

**Current State:**
- We have `ClaimKind`: `assertion`, `intent`, `question`, `meta`, `emotion`, `promise`, `unknown`
- Spec wants `ClaimType`: `FACT`, `POLICY_TERM`, `PROMISE`, `ACTION`, `CUSTOMER_INTENT`, `META`, `EXPLANATION`

**Recommendation:**
- **Option A (Recommended)**: Add `ClaimType` as a **semantic refinement** of `ClaimKind`
  - `ClaimKind` = pragmatic classification (for gating)
  - `ClaimType` = semantic classification (for proposition matching)
  - Map: `assertion` → `FACT` or `POLICY_TERM` (based on content)
  - Map: `promise` → `PROMISE` or `ACTION` (based on tense)
  - Map: `intent` → `CUSTOMER_INTENT`
  - Map: `meta` → `META` or `EXPLANATION` (based on content)

- **Option B**: Replace `ClaimKind` with `ClaimType` (breaking change, more work)

**Implementation:**
```typescript
// In fact-extractor.ts
export function classifyClaimType(claim: EnhancedClaim, fact?: Fact): ClaimType {
  // Use existing claimKind as base
  if (claim.claimKind === 'promise') {
    // Check if past tense (action) or future (promise)
    if (claim.text.match(/\b(sent|emailed|did|completed)\b/i)) {
      return 'ACTION';
    }
    return 'PROMISE';
  }
  
  if (claim.claimKind === 'intent' && claim.speaker === 'customer') {
    return 'CUSTOMER_INTENT';
  }
  
  if (claim.claimKind === 'assertion') {
    // Check if policy-related
    if (fact && fact.subjectNormalized.includes('fee') || 
        claim.text.match(/\b(terms?|policy|agreement|cancellation)\b/i)) {
      return 'POLICY_TERM';
    }
    return 'FACT';
  }
  
  if (claim.claimKind === 'meta') {
    if (claim.text.match(/\b(because|depends|explanation|reason)\b/i)) {
      return 'EXPLANATION';
    }
    return 'META';
  }
  
  return 'FACT'; // Default fallback
}
```

### 2. **PropositionSignature Structure (Excellent Addition)**

**Current State:**
- We have `subjectNormalized`, `predicateNormalized`, `polarity`, `timeframeNormalized` scattered across `Fact`
- No unified `PropositionSignature` on `EnhancedClaim`

**Recommendation:**
✅ **Implement as specified** - This is a clean abstraction that will improve semantic matching.

**Implementation:**
```typescript
// In facts/types.ts
export interface PropositionSignature {
  topic: string;          // From claim.topics[0] or fact.subjectNormalized
  predicate: string;      // From fact.predicateNormalized
  polarity: 'positive' | 'negative' | 'unknown';
  scope?: string;         // From fact.timeframeNormalized?.bucket
}

// Add to EnhancedClaim
export interface EnhancedClaim {
  // ... existing fields
  claimType: ClaimType;  // NEW
  signature?: PropositionSignature;  // NEW - extracted from associated Fact
}
```

**Extraction Logic:**
```typescript
// In fact-extractor.ts, after extracting facts
function extractPropositionSignature(claim: EnhancedClaim, fact?: Fact): PropositionSignature {
  if (fact) {
    return {
      topic: fact.subjectNormalized,
      predicate: fact.predicateNormalized,
      polarity: fact.polarity === 'affirm' ? 'positive' : 
                fact.polarity === 'deny' ? 'negative' : 'unknown',
      scope: fact.timeframeNormalized?.bucket
    };
  }
  
  // Fallback to claim-level extraction
  return {
    topic: claim.topics[0] || 'general',
    predicate: 'states',
    polarity: claim.polarity === 'affirm' ? 'positive' : 
              claim.polarity === 'deny' ? 'negative' : 'unknown',
    scope: undefined
  };
}
```

### 3. **canContradict() Function (Critical Implementation)**

**Current State:**
- We have `shouldConsiderContradiction()` in `claim_classifier.ts`
- It checks `claimKind` and topic overlap
- It's less strict than the spec requires

**Recommendation:**
✅ **Implement `canContradict()` as specified** - This is the core fix. Make it **mandatory** before creating any contradiction edge.

**Implementation Location:**
- **File**: `packages/tcl-core/src/engine/semantics/contradiction-gate.ts` (NEW)
- **Function**: `canContradict(a: EnhancedClaim, b: EnhancedClaim): boolean`

**Key Rules:**
```typescript
const ALLOWED: Record<ClaimType, ClaimType[]> = {
  FACT: ['FACT', 'POLICY_TERM'],
  POLICY_TERM: ['FACT', 'POLICY_TERM'],
  PROMISE: [],  // Promises can't contradict (only break)
  ACTION: [],   // Actions can't contradict (only fulfill/break promises)
  CUSTOMER_INTENT: [],  // Intent can't contradict facts
  META: [],     // Meta can't contradict
  EXPLANATION: [],  // Explanations can't contradict
};

function canContradict(a: EnhancedClaim, b: EnhancedClaim): boolean {
  // 1. Claim type compatibility
  if (!ALLOWED[a.claimType]?.includes(b.claimType)) {
    return false;
  }
  
  // 2. Proposition signature match
  if (!a.signature || !b.signature) {
    return false;  // Can't contradict without signature
  }
  
  if (a.signature.topic !== b.signature.topic) {
    return false;
  }
  
  if (a.signature.predicate !== b.signature.predicate) {
    return false;
  }
  
  // 3. Polarity conflict (must be opposite)
  if (a.signature.polarity === b.signature.polarity) {
    return false;
  }
  
  // 4. Temporal overlap (if both have scope)
  if (a.signature.scope && b.signature.scope) {
    if (a.signature.scope !== b.signature.scope) {
      return false;  // Different timeframes = no contradiction
    }
  }
  
  return true;
}
```

**Integration:**
- Call `canContradict()` **before** `shouldConsiderContradiction()` in `rule-engine.ts`
- If `canContradict()` returns `false`, **do not create contradiction edge**
- Instead, call `downgradeEdge()` to create structure/context/support edge

### 4. **Edge Downgrading Rules (Needs Implementation)**

**Current State:**
- We currently **drop** edges if gating fails
- No downgrading logic exists

**Recommendation:**
✅ **Implement downgrading as specified** - This preserves graph structure.

**Implementation:**
```typescript
// In rule-engine.ts
function downgradeEdge(
  claimA: EnhancedClaim,
  claimB: EnhancedClaim,
  originalType: 'contradiction',
  config: TruthEngineConfig
): TruthEdge | null {
  // Promise ↔ Policy → structure edge
  if ((claimA.claimType === 'PROMISE' && claimB.claimType === 'POLICY_TERM') ||
      (claimA.claimType === 'POLICY_TERM' && claimB.claimType === 'PROMISE')) {
    return {
      id: generateEdgeId('struct', claimA.id, claimB.id),
      type: 'structure',
      srcId: claimA.id,
      dstId: claimB.id,
      weight: config.edgeWeights.structureBase * 0.8,
      reason: 'Promise references policy term',
      ruleId: 'PROMISE_POLICY_REFERENCE',
      provenance: 'structure',
      metadata: { downgradedFrom: 'contradiction' }
    };
  }
  
  // Customer intent ↔ Fact → context edge (or skip)
  if (claimA.claimType === 'CUSTOMER_INTENT' || claimB.claimType === 'CUSTOMER_INTENT') {
    // Don't create edge - intent is not a factual statement
    return null;
  }
  
  // Explanation ↔ Fact → support edge (low weight)
  if ((claimA.claimType === 'EXPLANATION' && claimB.claimType === 'FACT') ||
      (claimA.claimType === 'FACT' && claimB.claimType === 'EXPLANATION')) {
    return {
      id: generateEdgeId('support', claimA.id, claimB.id),
      type: 'support',
      srcId: claimA.id,
      dstId: claimB.id,
      weight: config.edgeWeights.supportBase * 0.3,  // Low weight
      reason: 'Explanation supports fact',
      ruleId: 'EXPLANATION_SUPPORT',
      provenance: 'rules',
      metadata: { downgradedFrom: 'contradiction' }
    };
  }
  
  // Action ↔ Promise → fulfillment edge
  if ((claimA.claimType === 'ACTION' && claimB.claimType === 'PROMISE') ||
      (claimA.claimType === 'PROMISE' && claimB.claimType === 'ACTION')) {
    return {
      id: generateEdgeId('fulfill', claimA.id, claimB.id),
      type: 'structure',
      srcId: claimA.id,
      dstId: claimB.id,
      weight: config.edgeWeights.structureBase * 1.1,
      reason: 'Action fulfills promise',
      ruleId: 'PROMISE_FULFILLMENT',
      provenance: 'structure',
      metadata: { downgradedFrom: 'contradiction' }
    };
  }
  
  // Default: don't create edge
  return null;
}
```

### 5. **Weight Normalization (Needs Clarification)**

**Spec Says:**
- "Contradiction weights must be scaled after eligibility"
- "Must be clamped before spectral"
- "No contradiction edge < config threshold"

**Current State:**
- We have `minWeightContradiction: 0.3` in config
- We prune edges below threshold

**Recommendation:**
✅ **Clarify**: Apply threshold **after** `canContradict()` check, **before** sending to spectral.

**Implementation:**
```typescript
// In rule-engine.ts, after creating contradiction edges
const validContradictions = contradictionEdges.filter(edge => {
  // 1. Must pass canContradict() (already checked)
  // 2. Must meet minimum weight threshold
  return edge.weight >= config.pruning.minWeightContradiction;
});

// Clamp weights to [threshold, 1.0]
const normalizedContradictions = validContradictions.map(edge => ({
  ...edge,
  weight: Math.max(config.pruning.minWeightContradiction, Math.min(1.0, edge.weight))
}));
```

### 6. **Threshold Single Source of Truth**

**Spec Wants:**
```json
{
  "edgeThresholds": {
    "contradiction": 0.55,
    "support": 0.25,
    "structure": 0.1
  }
}
```

**Current State:**
- We have `minWeightContradiction: 0.3` in `DEFAULT_CONFIG`
- We have `minContradictionScore: 0.3` in `scoring.json`

**Recommendation:**
✅ **Add to `scoring.json`** and **use consistently**:
- Update `scoring.json` with `edgeThresholds`
- Update `DEFAULT_CONFIG` to read from `scoring.json`
- Use in `rule-engine.ts`, `issue classification`, `UI definitions`, `manifest`

**Implementation:**
```json
// scoring.json
{
  "edgeThresholds": {
    "contradiction": 0.55,  // Higher threshold = fewer false positives
    "support": 0.25,
    "structure": 0.1
  },
  // ... existing fields
}
```

### 7. **Truth State Renaming (UI Layer)**

**Spec Wants:**
- "Supported" → "Transcript-Grounded"
- "Contradicted" → "Contradicted" (unchanged)
- "Inconclusive" → "Inconclusive" (unchanged)

**Recommendation:**
✅ **Implement as display mapping** - Keep internal state as-is, map in UI.

**Implementation:**
```typescript
// In evaluation-results.component.ts or audit.service.ts
const TRUTH_STATE_LABELS: Record<string, string> = {
  'Supported': 'Transcript-Grounded',
  'Contradicted': 'Contradicted',
  'Ungrounded': 'Ungrounded',
  'Inconclusive': 'Inconclusive'
};

function getTruthStateLabel(state: string): string {
  return TRUTH_STATE_LABELS[state] || state;
}
```

---

## 🚨 **Critical Implementation Order**

1. **Add `ClaimType` enum** to `facts/types.ts`
2. **Add `PropositionSignature` interface** to `facts/types.ts`
3. **Implement `classifyClaimType()`** in `fact-extractor.ts`
4. **Implement `extractPropositionSignature()`** in `fact-extractor.ts`
5. **Create `canContradict()` function** in new `semantics/contradiction-gate.ts`
6. **Create `downgradeEdge()` function** in `rule-engine.ts`
7. **Update `findPolarityConflicts()`** to call `canContradict()` first
8. **Add `edgeThresholds` to `scoring.json`**
9. **Update weight normalization** to use thresholds
10. **Add truth state label mapping** in UI

---

## ✅ **Success Criteria Validation**

The spec's success criteria are **achievable and measurable**:

✅ **Fee ↔ Email is not a contradiction**
- `canContradict()` will return `false` (different predicates: "exists" vs "sent")

✅ **Intent ↔ Fact is not a contradiction**
- `canContradict()` will return `false` (CUSTOMER_INTENT not in ALLOWED[FACT])

✅ **Only same-topic, same-predicate polarity flips contradict**
- Enforced by `canContradict()` signature matching

✅ **Spectral blame highlights true risk claims**
- With valid contradictions only, spectral's `nodeBlame` will be meaningful

✅ **Customers can defend output in audits**
- `canContradict()` logic is deterministic and auditable
- `PropositionSignature` provides clear semantic justification

---

## 📝 **Final Recommendation**

**APPROVE & IMPLEMENT** with the following refinements:

1. ✅ Use `ClaimType` as semantic refinement of `ClaimKind` (not replacement)
2. ✅ Implement `PropositionSignature` as specified
3. ✅ Implement `canContradict()` with strict rules
4. ✅ Implement edge downgrading to preserve graph structure
5. ✅ Add `edgeThresholds` to `scoring.json` and use consistently
6. ✅ Add truth state label mapping in UI layer

**Priority: 🔴 CRITICAL** - This directly addresses production issues and will significantly improve output quality and customer trust.

