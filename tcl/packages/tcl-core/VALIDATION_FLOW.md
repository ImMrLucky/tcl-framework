# Complete Validation Flow: What Happens When User Clicks "Validate"

## Overview

This document traces the complete flow from when a user clicks "Validate" to when they receive results, including all files called, when NLI is invoked, and when Spectral is called.

---

## Step-by-Step Flow

### 1. **UI Layer** (Frontend)

#### File: `packages/tcl-ui/src/app/input-panel/input-panel.component.ts`
- **Function**: `onSubmit()` (line 521)
- **What it does**:
  - Collects form data (transcript/question, answer, sources, options)
  - Emits `validate` event with `ValidateInput` object

#### File: `packages/tcl-ui/src/app/tcl.service.ts`
- **Function**: `validate()` (line 23)
- **What it does**:
  - Makes HTTP POST request to `/api/validate` (or backend URL)
  - Sends: `{ question, answer, sources, options }`
  - Returns: `Observable<ValidateOutput>`

---

### 2. **API Layer** (Backend Server)

#### File: `packages/tcl-core/src/server/express.ts`
- **Endpoint**: `POST /validate` (line 41)
- **What it does**:
  1. Validates request (checks question is non-empty string)
  2. Loads modules if needed (`loadModules()`)
  3. Adds OpenAI adapter if API key available
  4. Calls `validate(input)` from orchestrator
  5. Returns JSON response

---

### 3. **Orchestrator** (Main Validation Logic)

#### File: `packages/tcl-core/src/orchestrator.ts`
- **Function**: `validate()` (line 376) → calls `validateOnce()` (line 47)

### Step-by-Step in `validateOnce()`:

#### **Step 1: Extract Claims**
- **File**: `packages/tcl-core/src/claim_extractor.ts`
- **Function**: `extractClaims(text)`
- **What it does**: Extracts claims from text using regex patterns
- **Output**: Array of `Claim` objects

#### **Step 2: Evidence Attachment**
- **File**: `packages/tcl-core/src/evidence.ts`
- **Function**: `attachEvidenceAndFindViolations(claims, sources)`
- **What it does**:
  - Matches claims to sources (grounding)
  - Calculates truth score
  - Finds missing evidence violations
- **Output**: `{ claims, violations, missing, truthScore }`

#### **Step 3: Logic Violations**
- **File**: `packages/tcl-core/src/logic.ts`
- **Function**: `findLogicViolations(claims)`
- **What it does**:
  - Detects hard contradictions (e.g., "X is true" vs "X is false")
  - Calculates consistency score
- **Output**: `{ violations, contradictions, consistencyScore }`

#### **Step 4: Build Claim Graph** ⚡ **NLI IS CALLED HERE**

- **File**: `packages/tcl-core/src/graph/edge_builder.ts`
- **Function**: `buildClaimGraph(claims, sources, opts)`
- **What it does**:

  **4a. Select NLI Scorer** (line 81-118 in orchestrator.ts):
  - Priority 1: Custom NLI endpoint (`HttpNliScorer`)
  - Priority 2: Mistral API (`MistralNliScorer`)
  - Priority 3: Local Transformers (`TransformersNliScorer`) - **DEFAULT**
  - Priority 4: Token Heuristic (`TokenHeuristicScorer`) - fallback

  **4b. Build Embeddings** (if ANN enabled):
  - **File**: `packages/tcl-core/src/graph/ann.ts`
  - **Function**: `buildIndexForClaims(claims, annOpts)`
  - Creates embeddings for each claim
  - Builds ANN index (brute-force or HNSW)

  **4c. Grounding Edges** (claim → source):
  - **File**: `packages/tcl-core/src/graph/edge_builder.ts` (line 341-377)
  - **NLI Called**: `scorer.grounding(claim.text, source.text)`
  - Checks cache first (`cache.get(key)`)
  - If cache miss, calls NLI and stores result
  - Creates `GroundingEdge[]`

  **4d. Support & Contradiction Edges** (claim → claim):
  - **File**: `packages/tcl-core/src/graph/edge_builder.ts` (line 379-495)
  - Uses ANN to find candidate pairs (top-K similar claims)
  - For each candidate pair:
    - **NLI Called**: `scorer.entailment(claimA, claimB)` → support score
    - **NLI Called**: `scorer.contradiction(claimA, claimB)` → contradiction score
  - Checks cache first for each pair
  - If cache miss, calls NLI batch scoring (`scorer.scoreBatch()`)
  - Creates `SupportEdge[]` and `ContradictionEdge[]`

  **4e. Cache Management**:
  - **File**: `packages/tcl-core/src/graph/cache.ts`
  - **Class**: `SemanticCache`
  - Stores NLI scores with TTL
  - Persists to disk (JSONL file)

- **Output**: `ClaimGraph { supports, contradictions, grounding, groundedClaimIds, cacheStats }`

#### **Step 5: Custom Rules Validation**
- **File**: `packages/tcl-core/src/custom_rules.ts`
- **Function**: `validateCustomRules(claims, input, customRules)`
- **What it does**: Validates claims against domain-specific rules
- **Output**: `Violation[]`

#### **Step 6: Spectral Analysis** ⚡ **SPECTRAL IS CALLED HERE**

- **File**: `packages/tcl-core/src/orchestrator.ts`
- **Function**: `callSpectralService()` (line 14)
- **When**: Only if `options.spectral === true` (line 266)
- **What it does**:
  1. Sends HTTP POST to Spectral service: `/spectral/score`
  2. **Payload**: `{ claims, supports, contradictions, grounded }`
  3. **Spectral Service**: `packages/tcl-spectral/app/main.py`
     - **Endpoint**: `POST /spectral/score` (line 7)
     - **Function**: `spectral_metrics()` in `spectral.py` (line 89)
     - **What Spectral does**:
       - Builds adjacency matrices from edges
       - Computes signed Laplacian
       - Calculates eigenvalues (spectral gap)
       - Detects cycles (circular reasoning)
       - Computes coherence score
  4. Returns `SpectralReport` with coherence score, circularity, etc.

#### **Step 7: Calculate Scores**
- **File**: `packages/tcl-core/src/scoring.ts`
- **Functions**:
  - `blendScores(truth, consistency, coherence)` → overall score
  - `shouldRefuse(overall, truth, consistency, thresholds)` → refusal decision

#### **Step 8: Confidence Metrics** (if enabled)
- **File**: `packages/tcl-core/src/confidence.ts`
- **Function**: `calculateAllClaimConfidences(claims, supports, contradictions, grounding)`
- **What it does**: Calculates detailed confidence metrics per claim
- **Output**: `Map<claimId, ConfidenceMetrics>`

#### **Step 9: Generate Suggestions** (if enabled)
- **File**: `packages/tcl-core/src/suggestions.ts`
- **Function**: `generateSuggestions(claims, violations, contradictions, missingEvidence, supports, customRules)`
- **What it does**: Creates actionable suggestions for fixing issues
- **Output**: `Suggestion[]`

#### **Step 10: Build Response**
- **File**: `packages/tcl-core/src/orchestrator.ts` (line 348-370)
- **What it does**: Assembles final `ValidateOutput` object
- **Returns**: Complete validation result

---

## File Call Tree

```
User clicks "Validate"
│
├─► input-panel.component.ts::onSubmit()
│   └─► Emits validate event
│
├─► tcl.service.ts::validate()
│   └─► HTTP POST /api/validate
│
├─► express.ts::POST /validate
│   ├─► Validates request
│   ├─► loadModules() (if needed)
│   └─► validate(input) from orchestrator
│
└─► orchestrator.ts::validate()
    └─► orchestrator.ts::validateOnce()
        │
        ├─► claim_extractor.ts::extractClaims()
        │   └─► Extracts claims from text
        │
        ├─► evidence.ts::attachEvidenceAndFindViolations()
        │   └─► Matches claims to sources, calculates truth score
        │
        ├─► logic.ts::findLogicViolations()
        │   └─► Detects hard contradictions, calculates consistency
        │
        ├─► edge_builder.ts::buildClaimGraph() ⚡ NLI CALLED HERE
        │   ├─► Selects NLI scorer (TransformersNliScorer, HttpNliScorer, etc.)
        │   ├─► ann.ts::buildIndexForClaims() (if ANN enabled)
        │   │   └─► Creates embeddings, builds ANN index
        │   ├─► scorer.grounding() → NLI scores claim-source pairs
        │   ├─► scorer.entailment() → NLI scores claim-claim support
        │   ├─► scorer.contradiction() → NLI scores claim-claim contradictions
        │   ├─► cache.ts::SemanticCache (checks/stores NLI scores)
        │   └─► Returns ClaimGraph { supports, contradictions, grounding }
        │
        ├─► custom_rules.ts::validateCustomRules()
        │   └─► Validates against domain-specific rules
        │
        ├─► orchestrator.ts::callSpectralService() ⚡ SPECTRAL CALLED HERE
        │   └─► HTTP POST to Spectral service
        │       └─► spectral/main.py::POST /spectral/score
        │           └─► spectral.py::spectral_metrics()
        │               ├─► Builds adjacency matrices
        │               ├─► Computes signed Laplacian
        │               ├─► Calculates eigenvalues
        │               ├─► Detects cycles
        │               └─► Returns SpectralReport
        │
        ├─► scoring.ts::blendScores()
        │   └─► Calculates overall score
        │
        ├─► confidence.ts::calculateAllClaimConfidences() (if enabled)
        │   └─► Calculates confidence metrics per claim
        │
        ├─► suggestions.ts::generateSuggestions() (if enabled)
        │   └─► Creates actionable suggestions
        │
        └─► Returns ValidateOutput
            └─► Response sent back to UI
```

---

## When NLI is Called

**NLI is called during Step 4 (Build Claim Graph)**:

1. **Grounding** (claim → source):
   - `scorer.grounding(claim.text, source.text)`
   - Called for each claim-source pair
   - Checks cache first

2. **Support** (claim → claim):
   - `scorer.entailment(claimA.text, claimB.text)`
   - Called for candidate pairs (from ANN)
   - Checks cache first
   - Uses batch scoring if available

3. **Contradiction** (claim → claim):
   - `scorer.contradiction(claimA.text, claimB.text)`
   - Called for candidate pairs (from ANN)
   - Checks cache first
   - Uses batch scoring if available

**NLI Scorers Available**:
- `TransformersNliScorer` (local, default) - `packages/tcl-core/src/graph/transformers_scorer.ts`
- `HttpNliScorer` (custom endpoint) - `packages/tcl-core/src/graph/edge_builder.ts`
- `MistralNliScorer` (Mistral API) - `packages/tcl-core/src/graph/edge_builder.ts`
- `TokenHeuristicScorer` (fallback) - `packages/tcl-core/src/graph/edge_builder.ts`

---

## When Spectral is Called

**Spectral is called during Step 6 (Spectral Analysis)**:

1. **Condition**: Only if `options.spectral === true`
2. **When**: After graph is built (needs supports, contradictions, grounded claims)
3. **How**: HTTP POST to Spectral service
4. **What it receives**:
   - Claims (id, text)
   - Support edges (claimA, claimB, weight)
   - Contradiction edges (claimA, claimB, weight)
   - Grounded claim IDs

5. **Spectral Service** (`packages/tcl-spectral/app/spectral.py`):
   - `spectral_metrics()` - Main function
   - Builds adjacency matrices
   - Computes signed Laplacian
   - Calculates eigenvalues (spectral gap)
   - Detects cycles (circular reasoning)
   - Computes coherence score

6. **Returns**: `SpectralReport` with:
   - `coherenceScore` (0-100)
   - `circularityScore` (0-100)
   - `spectralGap`
   - `contradictionEnergy`
   - `supportEnergy`

---

## Key Files Summary

### Frontend
- `packages/tcl-ui/src/app/input-panel/input-panel.component.ts` - UI form
- `packages/tcl-ui/src/app/tcl.service.ts` - HTTP client

### Backend API
- `packages/tcl-core/src/server/express.ts` - Express server, `/validate` endpoint

### Core Validation
- `packages/tcl-core/src/orchestrator.ts` - Main orchestrator, coordinates everything
- `packages/tcl-core/src/claim_extractor.ts` - Extracts claims from text
- `packages/tcl-core/src/evidence.ts` - Evidence attachment, truth scoring
- `packages/tcl-core/src/logic.ts` - Logic violations, consistency scoring
- `packages/tcl-core/src/scoring.ts` - Score blending, refusal logic

### Graph Building (NLI)
- `packages/tcl-core/src/graph/edge_builder.ts` - Main graph builder, NLI scorer selection
- `packages/tcl-core/src/graph/transformers_scorer.ts` - Local NLI scorer (Transformers.js)
- `packages/tcl-core/src/graph/ann.ts` - ANN index for candidate selection
- `packages/tcl-core/src/graph/cache.ts` - Semantic cache for NLI scores

### Spectral Analysis
- `packages/tcl-spectral/app/main.py` - FastAPI server, `/spectral/score` endpoint
- `packages/tcl-spectral/app/spectral.py` - Spectral analysis algorithms

### New Features
- `packages/tcl-core/src/confidence.ts` - Confidence metrics calculation
- `packages/tcl-core/src/suggestions.ts` - Suggestion generation
- `packages/tcl-core/src/custom_rules.ts` - Custom rule validation

---

## Execution Order

1. **UI** → User clicks Validate
2. **API** → Request received, validated
3. **Claims** → Extract claims from text
4. **Evidence** → Match claims to sources, calculate truth
5. **Logic** → Detect hard contradictions, calculate consistency
6. **Graph** → Build graph using NLI (grounding, support, contradiction edges)
7. **Custom Rules** → Validate against domain rules
8. **Spectral** → Analyze graph structure (if enabled)
9. **Scores** → Blend scores, determine refusal
10. **Confidence** → Calculate confidence metrics (if enabled)
11. **Suggestions** → Generate suggestions (if enabled)
12. **Response** → Return complete validation result

---

## Performance Considerations

- **NLI calls**: Happen during graph building (Step 4)
  - Can be cached (if cache enabled)
  - Batched for efficiency
  - Uses ANN to reduce number of pairs checked

- **Spectral call**: Happens after graph is built (Step 6)
  - Single HTTP request
  - Receives complete graph
  - Can be disabled for faster validation

- **Total time**: Typically 1-5 seconds depending on:
  - Number of claims
  - NLI scorer used (local vs cloud)
  - Cache hit rate
  - Spectral enabled/disabled

