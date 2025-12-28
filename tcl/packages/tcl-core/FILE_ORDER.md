# File Execution Order: When User Clicks "Validate"

## Complete File Call Sequence

### 1. **Frontend (UI Layer)**

**File**: `packages/tcl-ui/src/app/input-panel/input-panel.component.ts`
- **Function**: `onSubmit()` (line 521)
- **Action**: Collects form data, emits validate event

**File**: `packages/tcl-ui/src/app/tcl.service.ts`
- **Function**: `validate()` (line 23)
- **Action**: HTTP POST to `/api/validate`

---

### 2. **Backend API (Server)**

**File**: `packages/tcl-core/src/server/express.ts`
- **Endpoint**: `POST /validate` (line 41)
- **Actions**:
  - Validates request
  - Loads modules if needed
  - Calls orchestrator `validate()`

---

### 3. **Orchestrator (Main Coordinator)**

**File**: `packages/tcl-core/src/orchestrator.ts`
- **Function**: `validate()` (line 376) → calls `validateOnce()` (line 47)

**Inside `validateOnce()`, files called in order:**

#### Step 1: Extract Claims
**File**: `packages/tcl-core/src/claim_extractor.ts`
- **Function**: `extractClaims(text)`
- **Action**: Extracts claims from text using regex

#### Step 2: Evidence Attachment
**File**: `packages/tcl-core/src/evidence.ts`
- **Function**: `attachEvidenceAndFindViolations(claims, sources)`
- **Action**: Matches claims to sources, calculates truth score

#### Step 3: Logic Violations
**File**: `packages/tcl-core/src/logic.ts`
- **Function**: `findLogicViolations(claims)`
- **Action**: Detects hard contradictions, calculates consistency

#### Step 4: Build Graph (NLI Called Here)
**File**: `packages/tcl-core/src/graph/edge_builder.ts`
- **Function**: `buildClaimGraph(claims, sources, opts)`
- **Actions**:
  - Selects NLI scorer
  - Builds ANN index (if enabled)
  - Calls NLI for grounding, support, contradiction
  - Uses cache

**NLI Scorer Files** (one of these):
- `packages/tcl-core/src/graph/transformers_scorer.ts` (default - local)
- `packages/tcl-core/src/graph/edge_builder.ts` (HttpNliScorer, MistralNliScorer, TokenHeuristicScorer)

**Supporting Files**:
- `packages/tcl-core/src/graph/ann.ts` - ANN index building
- `packages/tcl-core/src/graph/cache.ts` - Semantic cache

#### Step 5: Custom Rules
**File**: `packages/tcl-core/src/custom_rules.ts`
- **Function**: `validateCustomRules(claims, input, customRules)`
- **Action**: Validates domain-specific rules

#### Step 6: Spectral Analysis (Spectral Called Here)
**File**: `packages/tcl-core/src/orchestrator.ts`
- **Function**: `callSpectralService()` (line 14)
- **Action**: HTTP POST to Spectral service

**Spectral Service**:
- `packages/tcl-spectral/app/main.py` - FastAPI endpoint
- `packages/tcl-spectral/app/spectral.py` - Spectral algorithms

#### Step 7: Calculate Scores
**File**: `packages/tcl-core/src/scoring.ts`
- **Functions**: `blendScores()`, `shouldRefuse()`
- **Action**: Blends scores, determines refusal

#### Step 8: Confidence Metrics (if enabled)
**File**: `packages/tcl-core/src/confidence.ts`
- **Function**: `calculateAllClaimConfidences()`
- **Action**: Calculates confidence metrics per claim

#### Step 9: Generate Suggestions (if enabled)
**File**: `packages/tcl-core/src/suggestions.ts`
- **Function**: `generateSuggestions()`
- **Action**: Creates actionable suggestions

#### Step 10: Return Response
**File**: `packages/tcl-core/src/orchestrator.ts`
- **Action**: Assembles `ValidateOutput` object

---

## Visual Flow

```
User Clicks "Validate"
│
├─► input-panel.component.ts::onSubmit()
│   └─► tcl.service.ts::validate()
│       └─► HTTP POST /api/validate
│
├─► express.ts::POST /validate
│   └─► orchestrator.ts::validate()
│       └─► orchestrator.ts::validateOnce()
│           │
│           ├─► claim_extractor.ts::extractClaims()
│           │
│           ├─► evidence.ts::attachEvidenceAndFindViolations()
│           │
│           ├─► logic.ts::findLogicViolations()
│           │
│           ├─► edge_builder.ts::buildClaimGraph() ⚡ NLI HERE
│           │   ├─► transformers_scorer.ts (or other scorer)
│           │   ├─► ann.ts::buildIndexForClaims()
│           │   └─► cache.ts::SemanticCache
│           │
│           ├─► custom_rules.ts::validateCustomRules()
│           │
│           ├─► orchestrator.ts::callSpectralService() ⚡ SPECTRAL HERE
│           │   └─► spectral/main.py::POST /spectral/score
│           │       └─► spectral.py::spectral_metrics()
│           │
│           ├─► scoring.ts::blendScores()
│           │
│           ├─► confidence.ts::calculateAllClaimConfidences()
│           │
│           ├─► suggestions.ts::generateSuggestions()
│           │
│           └─► Return ValidateOutput
│
└─► Response sent to UI
```

---

## File List (Execution Order)

1. `packages/tcl-ui/src/app/input-panel/input-panel.component.ts`
2. `packages/tcl-ui/src/app/tcl.service.ts`
3. `packages/tcl-core/src/server/express.ts`
4. `packages/tcl-core/src/orchestrator.ts`
5. `packages/tcl-core/src/claim_extractor.ts`
6. `packages/tcl-core/src/evidence.ts`
7. `packages/tcl-core/src/logic.ts`
8. `packages/tcl-core/src/graph/edge_builder.ts`
   - `packages/tcl-core/src/graph/transformers_scorer.ts` (or other scorer)
   - `packages/tcl-core/src/graph/ann.ts`
   - `packages/tcl-core/src/graph/cache.ts`
9. `packages/tcl-core/src/custom_rules.ts`
10. `packages/tcl-core/src/orchestrator.ts` (callSpectralService)
    - `packages/tcl-spectral/app/main.py`
    - `packages/tcl-spectral/app/spectral.py`
11. `packages/tcl-core/src/scoring.ts`
12. `packages/tcl-core/src/confidence.ts`
13. `packages/tcl-core/src/suggestions.ts`
14. `packages/tcl-core/src/orchestrator.ts` (return response)

---

## Key Points

- **NLI is called** during Step 8 (`edge_builder.ts::buildClaimGraph()`)
- **Spectral is called** during Step 10 (`orchestrator.ts::callSpectralService()`)
- **All files are in** `packages/tcl-core/src/` except:
  - UI files in `packages/tcl-ui/src/app/`
  - Spectral service in `packages/tcl-spectral/app/`

