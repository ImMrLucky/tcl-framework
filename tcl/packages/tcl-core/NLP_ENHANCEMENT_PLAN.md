# NLP Enhancement Plan for Better Graph Quality

## Current State Analysis

### What Works
1. **Rule Engine** (`engine/rules/rule-engine.ts`) - Good architecture for edge creation
2. **Fact Normalization** (`engine/facts/types.ts`) - Rich data model with subject, predicate, value
3. **Contradiction Gating** (`claim_classifier.ts`) - 6-gate system for filtering false contradictions
4. **Entity Extraction** - Basic keyword matching

### What's Broken
1. **Fact Extraction Quality** - Simple regex/keyword patterns miss semantic meaning
2. **Entity Linking** - No coreference resolution ("it", "the fee", "that charge" → what?)
3. **Support Edge Scoring** - NLI models trained on formal text, not transcripts
4. **Subject/Predicate Extraction** - Too brittle, misses conversational patterns

---

## Proposed Solution: Hybrid NLP Pipeline

### Option A: spaCy-Based Enhancement (Recommended)

**Why spaCy?**
- Fast, production-ready (Python)
- Built-in NER, dependency parsing, POS tagging
- Easy custom pipeline components
- Can run locally (no API costs)

**New Components:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    NLP Enhancement Service                       │
├─────────────────────────────────────────────────────────────────┤
│  1. Entity Extraction (NER)                                      │
│     - Custom entities: MONEY, DATE, PRODUCT, FEE, PLAN, POLICY  │
│     - Link entities across claims                                │
│                                                                  │
│  2. Coreference Resolution                                       │
│     - "it" → "the early termination fee"                        │
│     - "that" → "the charge on your bill"                        │
│                                                                  │
│  3. Semantic Role Labeling (SRL)                                 │
│     - WHO: agent/customer                                        │
│     - ACTION: charge, cancel, send, apply                        │
│     - OBJECT: fee, document, refund                              │
│     - CONDITION: if, when, unless                                │
│                                                                  │
│  4. Contradiction Detection (Rule-Based + ML)                    │
│     - X says "fee exists" + Y says "fee doesn't exist" = ⚡     │
│     - X says "$50" + Y says "$25" for same thing = ⚡            │
│                                                                  │
│  5. Support Detection                                            │
│     - Agent confirms customer's understanding                    │
│     - Customer acknowledges agent's statement                    │
│     - Consistent amounts/dates across speakers                   │
└─────────────────────────────────────────────────────────────────┘
```

### Option B: LLM-Based Structured Extraction

**Why LLM?**
- Better at understanding conversational context
- Can extract complex relationships
- No training required

**Prompt Example:**
```
Extract structured facts from this claim:
"Just to clarify, if you cancel before the end of your promotional period, there may be an early termination charge."

Output:
{
  "subject": "early_termination_fee",
  "predicate": "may_apply",
  "value": true,
  "condition": "cancel_before_promo_end",
  "speaker": "agent",
  "modality": "conditional",
  "entities": [
    {"type": "FEE", "value": "early termination charge"},
    {"type": "TIME_PERIOD", "value": "promotional period"}
  ]
}
```

### Option C: Sentence Embeddings + Clustering

**Why?**
- Group semantically similar claims
- Better candidate generation for edge scoring
- Reduce pair explosion

**Tools:**
- sentence-transformers (all-MiniLM-L6-v2) for embeddings
- HDBSCAN for clustering
- Cosine similarity for pair filtering

---

## Implementation Plan

### Phase 1: Enhanced Entity Extraction (Week 1)

**New File: `packages/tcl-nlp/entity_extractor.py`**

```python
import spacy
from spacy.tokens import Doc, Span

# Load model
nlp = spacy.load("en_core_web_lg")

# Add custom entity ruler for domain terms
patterns = [
    {"label": "FEE", "pattern": [{"LOWER": {"IN": ["fee", "charge", "cost", "penalty"]}}]},
    {"label": "FEE", "pattern": "early termination fee"},
    {"label": "FEE", "pattern": "cancellation fee"},
    {"label": "FEE", "pattern": "service adjustment fee"},
    {"label": "AMOUNT", "pattern": [{"LIKE_NUM": True}, {"LOWER": {"IN": ["dollars", "cents", "%"]}}]},
    {"label": "AMOUNT", "pattern": [{"TEXT": {"REGEX": r"\$\d+(\.\d{2})?"}}]},
    {"label": "PLAN", "pattern": [{"LOWER": {"IN": ["plan", "package", "subscription", "service"]}}]},
    {"label": "TIME_PERIOD", "pattern": [{"LOWER": {"IN": ["cycle", "month", "year", "period", "today"]}}]},
]

ruler = nlp.add_pipe("entity_ruler", before="ner")
ruler.add_patterns(patterns)

def extract_entities(text: str) -> dict:
    doc = nlp(text)
    return {
        "entities": [(ent.text, ent.label_) for ent in doc.ents],
        "noun_chunks": [chunk.text for chunk in doc.noun_chunks],
        "root_verb": doc[0].root.lemma_ if doc else None,
    }
```

### Phase 2: Improved Fact Normalization (Week 2)

**Enhance `engine/facts/fact_extractor.ts`**

```typescript
interface ExtractedFact {
  subject: string;           // Normalized entity
  subjectType: 'FEE' | 'AMOUNT' | 'PLAN' | 'DATE' | 'ACTION';
  predicate: string;         // Normalized action
  predicateType: 'EXISTS' | 'AMOUNT' | 'APPLIES' | 'CHANGES';
  value: string | number | boolean;
  valueType: 'boolean' | 'number' | 'money' | 'string';
  conditions: string[];      // Normalized conditions
  timeframe?: string;        // Normalized timeframe bucket
  modality: 'definite' | 'possible' | 'conditional';
  polarity: 'positive' | 'negative';
}

// Example:
// "There may be an early termination charge"
// →
// {
//   subject: "early_termination_fee",
//   subjectType: "FEE",
//   predicate: "applies",
//   predicateType: "EXISTS",
//   value: true,
//   valueType: "boolean",
//   conditions: [],
//   modality: "possible",
//   polarity: "positive"
// }
```

### Phase 3: Entity-Based Edge Creation (Week 3)

**New Edge Types:**

1. **ENTITY_LINK** - Claims share the same entity
   ```
   c1: "There may be an early termination fee"
   c2: "The early termination fee is $50"
   → ENTITY_LINK(c1, c2, entity="early_termination_fee", weight=0.9)
   ```

2. **AMOUNT_MATCH / AMOUNT_CONFLICT**
   ```
   c1: "The fee is $50"
   c2: "The fee is $25"
   → AMOUNT_CONFLICT(c1, c2, entity="fee", values=[$50, $25], weight=0.95)
   ```

3. **SPEAKER_INTERACTION**
   ```
   Customer: "I was told my rate wouldn't change"
   Agent: "Your plan hasn't changed, but..."
   → SPEAKER_INTERACTION(c_customer, c_agent, type="dispute", weight=0.7)
   ```

### Phase 4: Integration with Spectral (Week 4)

**Updated Pipeline:**

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Transcript │────▶│ NLP Extract │────▶│ Fact Engine  │
│   (turns)   │     │  (spaCy)    │     │  (rules)     │
└─────────────┘     └─────────────┘     └──────────────┘
                                               │
                                               ▼
                         ┌──────────────────────────────┐
                         │      Entity-Linked Graph     │
                         │  - Entity edges (SAME_ENTITY)│
                         │  - Amount edges (CONFLICT)   │
                         │  - Semantic edges (SUPPORTS) │
                         └──────────────────────────────┘
                                               │
                                               ▼
                         ┌──────────────────────────────┐
                         │       Spectral Analysis      │
                         │  - Truth propagation         │
                         │  - Coherence scoring         │
                         │  - Blame attribution         │
                         └──────────────────────────────┘
```

---

## Quick Win: Improve Current System Without spaCy

If you want to improve today without adding spaCy:

### 1. Better Entity Patterns

```typescript
// packages/tcl-core/src/entity_patterns.ts

const FEE_PATTERNS = [
  /early\s+termination\s+(fee|charge)/i,
  /cancellation\s+(fee|charge)/i,
  /service\s+adjustment\s+fee/i,
  /monthly\s+fee/i,
  /(\$[\d,]+(?:\.\d{2})?)\s+(fee|charge)/i,
];

const AMOUNT_PATTERNS = [
  /\$[\d,]+(?:\.\d{2})?/g,
  /(\d+)\s*(dollars?|cents?|percent|%)/gi,
];

const DATE_PATTERNS = [
  /this\s+(cycle|month|billing\s+period)/i,
  /next\s+(cycle|month)/i,
  /(promotional|promo)\s+period/i,
  /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
];

export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  
  for (const pattern of FEE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({ type: 'FEE', value: match[0], normalized: normalizeFee(match[0]) });
    }
  }
  
  for (const pattern of AMOUNT_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({ type: 'AMOUNT', value: match[0], normalized: parseAmount(match[0]) });
    }
  }
  
  return entities;
}
```

### 2. Entity-Based Edge Boosting

```typescript
// Boost support score if claims share entities
function boostedSupportScore(claimA: Claim, claimB: Claim, baseScore: number): number {
  const entitiesA = extractEntities(claimA.text);
  const entitiesB = extractEntities(claimB.text);
  
  const sharedEntities = entitiesA.filter(ea => 
    entitiesB.some(eb => ea.normalized === eb.normalized)
  );
  
  if (sharedEntities.length > 0) {
    // Boost by 20% for each shared entity
    return Math.min(1.0, baseScore + (sharedEntities.length * 0.2));
  }
  
  return baseScore;
}
```

### 3. Amount Conflict Detection

```typescript
function detectAmountConflict(claimA: Claim, claimB: Claim): ConflictResult | null {
  const amountsA = extractAmounts(claimA.text);
  const amountsB = extractAmounts(claimB.text);
  
  // Check if both claims reference an amount for the same entity
  const entitiesA = extractEntities(claimA.text);
  const entitiesB = extractEntities(claimB.text);
  
  const sharedFees = entitiesA
    .filter(e => e.type === 'FEE')
    .filter(ea => entitiesB.some(eb => eb.type === 'FEE' && ea.normalized === eb.normalized));
  
  if (sharedFees.length > 0 && amountsA.length > 0 && amountsB.length > 0) {
    if (amountsA[0] !== amountsB[0]) {
      return {
        type: 'AMOUNT_CONFLICT',
        entity: sharedFees[0].normalized,
        valueA: amountsA[0],
        valueB: amountsB[0],
        confidence: 0.95,
      };
    }
  }
  
  return null;
}
```

---

## Recommendation

**Start with Option A (spaCy) but implement the Quick Win first:**

1. **Today**: Add entity patterns and entity-based edge boosting
2. **This Week**: Create spaCy microservice in `packages/tcl-nlp/`
3. **Next Week**: Integrate with fact extractor and rule engine
4. **Following Week**: Connect enhanced graph to spectral

This gives you immediate improvement while building toward a proper NLP pipeline.

---

## File Changes Required

1. **New**: `packages/tcl-nlp/` - Python spaCy service
2. **Update**: `packages/tcl-core/src/entity_patterns.ts` - Enhanced entity extraction
3. **Update**: `packages/tcl-core/src/graph/edge_builder.ts` - Entity-based edge boosting
4. **Update**: `packages/tcl-core/src/engine/facts/fact_extractor.ts` - NLP-enhanced extraction
5. **Update**: `packages/tcl-spectral/app/spectral.py` - Handle new edge types

