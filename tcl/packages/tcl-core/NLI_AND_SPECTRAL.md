# How NLI and Spectral Work Together

## The Value Proposition

**TCL's value comes from BOTH NLI and Spectral working together** - they're complementary, not separate:

1. **NLI (Natural Language Inference)**: Builds the semantic graph
2. **Spectral Analysis**: Analyzes the graph structure for coherence

---

## The Pipeline

### Step 1: NLI Builds the Graph

**NLI's job**: Score semantic relationships between claims

```typescript
// NLI scores each pair of claims:
- Entailment: "Does claim A support claim B?" → score 0.0-1.0
- Contradiction: "Does claim A contradict claim B?" → score 0.0-1.0
- Grounding: "Is claim A supported by source B?" → score 0.0-1.0
```

**Output**: A graph with:
- **Support edges**: `{ claimA: "c1", claimB: "c2", weight: 0.75 }`
- **Contradiction edges**: `{ claimA: "c1", claimB: "c3", weight: 0.85 }`
- **Grounding edges**: `{ claimId: "c1", sourceId: "s1", weight: 0.90 }`

**What NLI provides**:
- ✅ Semantic understanding (what claims mean)
- ✅ Pairwise relationships (which claims support/contradict each other)
- ✅ Evidence grounding (which claims are backed by sources)

**What NLI doesn't provide**:
- ❌ Overall structural coherence
- ❌ Circular reasoning detection
- ❌ Graph-level stability analysis

---

### Step 2: Spectral Analyzes the Graph

**Spectral's job**: Analyze the graph structure using linear algebra

```python
# Spectral takes the graph and:
1. Builds adjacency matrices from edges
2. Computes signed Laplacian (H = D - A)
3. Calculates eigenvalues (spectral gap)
4. Detects cycles (circular reasoning)
5. Computes coherence score
```

**Input**: The graph built by NLI
- Claims: `[{ id: "c1", text: "..." }, ...]`
- Support edges: `[{ claimA: "c1", claimB: "c2", weight: 0.75 }, ...]`
- Contradiction edges: `[{ claimA: "c1", claimB: "c3", weight: 0.85 }, ...]`
- Grounded claims: `["c1", "c2"]`

**Output**: Structural analysis
- **Coherence Score** (0-100): Overall structural coherence
- **Circularity Score** (0-100): How much circular reasoning exists
- **Spectral Gap**: Measure of graph stability
- **Contradiction Energy**: How much contradictions destabilize the graph
- **Support Energy**: How well claims support each other

**What Spectral provides**:
- ✅ Structural coherence analysis
- ✅ Circular reasoning detection
- ✅ Graph-level stability metrics
- ✅ Per-claim truth vectors (new platform feature)

**What Spectral doesn't provide**:
- ❌ Semantic understanding (needs NLI for that)
- ❌ Pairwise relationship detection (needs NLI for that)

---

## Why Both Are Essential

### Without NLI:
```
❌ No graph to analyze
❌ No understanding of claim relationships
❌ No semantic scoring
→ Spectral has nothing to work with
```

### Without Spectral:
```
❌ Only pairwise relationships (no structural view)
❌ Can't detect circular reasoning
❌ Can't measure overall coherence
→ Missing the "big picture" analysis
```

### With Both:
```
✅ NLI builds semantic graph (what claims mean, how they relate)
✅ Spectral analyzes graph structure (how coherent, stable, circular)
✅ Complete validation: semantic + structural
```

---

## The Value Proposition

**TCL's unique value = NLI + Spectral**

### What Makes TCL Different:

1. **Semantic Understanding (NLI)**:
   - Understands what claims mean
   - Scores relationships accurately
   - Works with any NLI model (local, cloud, custom)

2. **Structural Analysis (Spectral)**:
   - Detects circular reasoning (unique!)
   - Measures overall coherence (unique!)
   - Graph-level stability analysis (unique!)

3. **Together**:
   - Not just "claim A contradicts claim B" (NLI)
   - But also "the overall structure is unstable due to circular reasoning" (Spectral)
   - Complete picture: semantic + structural

---

## Example

### Input:
```
Claims:
- c1: "AI will replace all jobs"
- c2: "AI will create new jobs"
- c3: "AI will replace all jobs, but new jobs will be created"
- c4: "AI is beneficial for society"
```

### NLI Builds Graph:
```
Support edges:
- c3 → c1 (weight: 0.8)  // "c3 supports c1"
- c3 → c2 (weight: 0.8)  // "c3 supports c2"
- c4 → c2 (weight: 0.7)  // "c4 supports c2"

Contradiction edges:
- c1 ↔ c2 (weight: 0.9)  // "c1 contradicts c2"
```

### Spectral Analyzes Graph:
```
Structural issues detected:
- Circular reasoning: c1 → c3 → c2 → c1 (cycle detected!)
- Low coherence: Contradictions create instability
- Spectral gap: Small (unstable structure)

Coherence Score: 35/100
Circularity Score: 75/100
```

### Result:
- **NLI found**: Individual contradictions and supports
- **Spectral found**: The contradictions create a circular reasoning pattern that destabilizes the entire structure

---

## Technical Details

### NLI Implementation:
- Uses Natural Language Inference models (roberta-large-mnli, Mistral, etc.)
- Scores entailment, contradiction, grounding
- Builds graph edges based on thresholds
- Can use local models (Transformers.js) or cloud APIs

### Spectral Implementation:
- Uses linear algebra (numpy)
- Builds signed Laplacian matrix
- Computes eigenvalues (spectral gap)
- Detects cycles in ungrounded subgraph
- Calculates coherence from multiple factors

### Integration:
```typescript
// orchestrator.ts flow:
1. Extract claims from text
2. Build graph using NLI (buildClaimGraph)
   → Returns: { supports, contradictions, grounding }
3. Send graph to Spectral service
   → Input: claims, supports, contradictions, grounded
   → Output: { coherenceScore, circularityScore, ... }
4. Combine scores:
   → Overall = 0.5 * truth + 0.3 * consistency + 0.2 * coherence
```

---

## Summary

**You're correct**: The value comes from **Spectral.py working alongside NLI**.

- **NLI** = Semantic understanding (what claims mean, how they relate)
- **Spectral** = Structural analysis (how coherent, stable, circular)

**Together** = Complete validation that competitors don't have:
- Not just pairwise relationships (everyone has that)
- But structural coherence analysis (unique to TCL)

**The core value proposition**:
> "TCL doesn't just find contradictions - it analyzes the entire structure to detect circular reasoning, measure coherence, and identify unstable patterns that simple pairwise checks miss."

