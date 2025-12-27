# TCL Scoring System - How It Works

## Score Components

### 1. Truth Score (0-100)
**What it measures:** How many claims are supported by sources

**Calculation:**
```typescript
truthScore = (supported_claims / total_claims) × 100
```

**How it works:**
- Each claim is checked against provided sources
- If a claim has sufficient overlap with source text (≥35% token overlap), it's "grounded"
- Score = percentage of grounded claims

**Examples:**
- 8 claims, 0 supported → Truth = 0
- 8 claims, 4 supported → Truth = 50
- 8 claims, 8 supported → Truth = 100

**If no sources provided:** Truth defaults to 50 (neutral)

---

### 2. Consistency Score (0-100)
**What it measures:** How many contradictions exist between claims

**Calculation:**
```typescript
base = 100
penalty = contradiction_count × 25
consistencyScore = max(0, base - penalty)
```

**How it works:**
- Compares all claim pairs for contradictions
- Detects:
  - Negation pairs ("X is true" vs "X is not true")
  - Keyword contradictions ("should remove" vs "should not censor")
- Each contradiction reduces score by 25 points

**Examples:**
- 0 contradictions → Consistency = 100
- 1 contradiction → Consistency = 75
- 2 contradictions → Consistency = 50
- 4+ contradictions → Consistency = 0

---

### 3. Coherence Score (0-100)
**What it measures:** Overall logical structure and flow

**Calculation:**
- If Spectral enabled: Uses Spectral analysis (graph structure, cycles, etc.)
- If Spectral disabled: Defaults to 50 (neutral)

**Spectral analysis considers:**
- Support relationships between claims
- Contradiction relationships
- Circular reasoning patterns
- Graph structure quality

---

### 4. Overall Score (0-100)
**What it measures:** Weighted combination of all three scores

**Calculation:**
```typescript
overall = (0.5 × truth) + (0.3 × consistency) + (0.2 × coherence)
```

**Weights:**
- Truth: 50% (most important - claims must be supported)
- Consistency: 30% (important - no contradictions)
- Coherence: 20% (nice to have - logical flow)

**Examples:**
- Truth=0, Consistency=0, Coherence=50 → Overall = 10
- Truth=50, Consistency=50, Coherence=50 → Overall = 50
- Truth=100, Consistency=100, Coherence=100 → Overall = 100

---

## Failure Conditions

An answer **fails** (refusal = true) if ANY of these are true:

1. **Overall < 60** (default threshold)
2. **Truth < 50** (default threshold)
3. **Consistency < 50** (default threshold)

**Default thresholds:**
- Overall: 60
- Truth: 50
- Consistency: 50

**Custom thresholds:** Can be set via `options.thresholds`

---

## Example: Score of 14

**What it means:**
- Overall = 14 (very low)
- Likely: Truth ≈ 0-20, Consistency ≈ 0-20, Coherence = 50

**Why it fails:**
- ✅ Overall (14) < 60 → FAIL
- ✅ Truth likely < 50 → FAIL
- ✅ Consistency likely < 50 → FAIL

**What caused it:**
- Most/all claims are ungrounded (no source support)
- Multiple contradictions detected
- Poor logical structure

**This is correct behavior!** A score of 14 indicates the answer is unreliable.

---

## Verification Checklist

To verify scoring is working correctly:

### ✅ Test 1: Perfect Answer
**Input:**
- Question: "What is 2+2?"
- Answer: "2+2 equals 4."
- Sources: "2+2 equals 4."

**Expected:**
- Truth: 100 (claim supported)
- Consistency: 100 (no contradictions)
- Coherence: 50-100
- Overall: 80-100
- Refusal: false

### ✅ Test 2: Contradictory Answer
**Input:**
- Question: "Should we do X?"
- Answer: "We should do X. We should not do X."
- Sources: (none)

**Expected:**
- Truth: 50 (no sources = neutral)
- Consistency: 75 (1 contradiction = -25)
- Coherence: 50
- Overall: ~55
- Refusal: true (consistency < 50)

### ✅ Test 3: Ungrounded Claims
**Input:**
- Question: "What is the capital of France?"
- Answer: "The capital of France is Paris. The capital is also London."
- Sources: "The capital of France is Paris."

**Expected:**
- Truth: 50 (1 of 2 claims supported)
- Consistency: 50-75 (contradiction between Paris/London)
- Coherence: 50
- Overall: ~45-55
- Refusal: true (overall < 60, truth < 50)

### ✅ Test 4: Very Low Score (14)
**Input:**
- Question: Complex question
- Answer: Many ungrounded claims + contradictions
- Sources: None or insufficient

**Expected:**
- Truth: 0-20
- Consistency: 0-20
- Coherence: 50
- Overall: 10-20
- Refusal: true (all thresholds failed)

---

## Is It Working Correctly?

**If you see:**
- ✅ Low scores (14) for bad answers → **Working correctly**
- ✅ High scores (80+) for good answers → **Working correctly**
- ✅ Failures when thresholds not met → **Working correctly**
- ✅ Contradictions detected → **Working correctly**
- ✅ Missing evidence flagged → **Working correctly**

**If you see:**
- ❌ High scores for clearly bad answers → **Issue**
- ❌ Low scores for clearly good answers → **Issue**
- ❌ No failures when should fail → **Issue**
- ❌ Contradictions not detected → **Issue**

---

## Debugging Low Scores

If you get a score of 14, check:

1. **Truth Score:**
   - Are sources provided?
   - Do sources actually support the claims?
   - Check "Missing Evidence" in report

2. **Consistency Score:**
   - Are there contradictions in the answer?
   - Check "Contradictions" in report
   - Look for red edges in graph

3. **Coherence Score:**
   - Is Spectral enabled?
   - Check graph structure
   - Look for circular reasoning

4. **Overall Score:**
   - Is it calculated correctly? (0.5×truth + 0.3×consistency + 0.2×coherence)
   - Are all components contributing?

---

## Summary

**A score of 14 is correct for a bad answer!** It means:
- Claims are not supported by sources
- Multiple contradictions exist
- Answer should be rejected

The framework is working as designed to catch unreliable answers.

