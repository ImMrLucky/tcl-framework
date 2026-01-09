# Analysis Fixes Progress

This document tracks progress on the comprehensive analysis fixes.

## Phase 0: Remove Hard-Coded and Debug Logic ✅

### 0.1 Remove hard-coded thresholds from outputs ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/orchestrator.ts` (lines 477-479):
  - Replaced hard-coded `supportThreshold: 0.65` with `getTemplateConfig().thresholds.support`
  - Replaced hard-coded `contradictionThreshold: 0.70` with `getTemplateConfig().thresholds.contradiction`
  - Replaced hard-coded `groundingThreshold: 0.60` with `getTemplateConfig().thresholds.grounding`
  - Added import: `import { getTemplateConfig } from "./graph/template-config.js";`

- `packages/tcl-core/src/graph/edge-classification.ts` (line 600):
  - Removed hard-coded clamp: `Math.min(config.thresholds.grounding, 0.4)`
  - Replaced with: `config.thresholds.grounding` (no clamp)

**Acceptance**: ✅ No numeric thresholds appear in outputs unless they come from config

### 0.2 Eliminate debug-only scoring influence
**Status**: IN PROGRESS

**To Do**:
- Search for debug flags that affect scoring
- Ensure debug fields are metadata only
- Remove any scoring logic that depends on debug flags

## Phase 1: Fix Traceability + Grounding Correctness

### 1.1 Fix transcript evidence ID/anchor mismatch ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/orchestrator.ts` (lines 277-289):
  - Fixed turn index extraction to use `evidenceNode.anchors[0].ref` instead of `g.sourceId`
  - Added fallback to extract from sourceId if anchor not available
  - Now correctly extracts turn index from `turn-12` format in anchor ref

**Acceptance**: ✅ Every grounding edge includes correct turnIndex and transcript span reference

### 1.2 Guarantee transcript EvidenceNodes are created
**Status**: VERIFIED (already working)

**Verification**:
- `packages/tcl-core/src/graph/graph-builder.ts` (lines 467-495):
  - `buildEvidenceNodes()` always creates transcript evidence nodes when `input.transcript` exists
  - Creates nodes with ID format: `e-transcript-${turnIndex}`
  - Creates anchors with ref format: `turn-${turnIndex}`

**Acceptance**: ✅ Transcript evidence nodes are always created for transcript-only runs

### 1.3 Make grounding threshold truly "high recall" ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/graph/template-config.ts`:
  - Lowered default grounding threshold from `0.4` to `0.25` (high recall)
  - Lowered telco template grounding threshold to `0.2` (call-center critical)

- `packages/tcl-core/src/graph/edge-classification.ts`:
  - Improved grounding score computation with temporal proximity boosts:
    - Same turn (temporalProximity >= 1.0): minimum score 0.5, boost with text similarity
    - Adjacent turn (>= 0.8): minimum score 0.4
    - Within 3 turns (>= 0.5): minimum score 0.3
  - More permissive scoring to achieve >80% grounding rate

- `packages/tcl-core/src/graph/candidate-generation.ts`:
  - Added span overlap calculation when claim and evidence are from same turn
  - Uses span overlap when available (more reliable than semantic similarity alone)
  - Falls back to semantic similarity when span overlap not available

**Acceptance**: ✅ Grounding threshold lowered and scoring improved for high recall (>80% of claims should get grounding edges)

## Phase 2: Fix Edge Quality

### 2.1 Replace semanticSimilarity with better baseline ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/graph/candidate-generation.ts`:
  - Replaced token-based Jaccard with character 3-gram cosine similarity
  - Implemented `TrigramCosineProvider` class with interface-based design
  - Added text normalization (lowercase, punctuation removal, whitespace normalization)
  - Added value-aware matching for MONEY, DATE, PERCENT entities:
    - Money: Matches values within 1% (handles rounding)
    - Percent: Matches values within 0.1%
    - Dates: Normalizes to ISO format for exact matching
  - Kept Jaccard as fallback when trigrams fail
  - Added `setTextSimilarityProvider()` function for future embedding swap

**Benefits**:
- Better handles paraphrases: "your rate will remain the same" vs "we won't change your rate"
- Value-aware matching catches numeric similarities even with different phrasing
- Interface-based design allows easy swap to embeddings later

**Acceptance**: ✅ Paraphrases become candidates, value-aware matching works, interface ready for embeddings

### 2.2 Tighten contradiction gating for numeric/value slots ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/graph/subject-slot.ts`:
  - Enhanced `valuesContradict()` function with tolerance-based comparison
  - Added `hasExplicitContradictionPattern()` for semantic contradictions:
    - Increase vs Decrease: "increase", "higher", "more" vs "decrease", "lower", "less"
    - Waived vs Fee: "waived", "no fee", "free", "$0" vs "fee", "charge", "cost"
    - Zero vs Non-zero: Detects $0 vs $25, etc.
  - Added `valuesContradictNumeric()` with slot-type-specific tolerances:
    - Money: 1% tolerance or $0.01 minimum (handles rounding)
    - Percentages: 0.1% tolerance
    - Dates: Exact match required
    - Durations: 1 unit minimum difference
    - Other numeric: 1% relative tolerance

- `packages/tcl-core/src/graph/edge-classification.ts`:
  - Increased value contradiction boost from 0.3 to 0.4
  - Added extra 0.2 boost for explicit patterns
  - Enhanced opposing pairs list with fee-related contradictions

**Acceptance**: ✅ Classic cases work:
- "fee is $0" vs "fee is $25" → contradiction edge
- "rate won't change" vs "rate increased" → contradiction edge
- "refund issued" vs "refund not issued" → contradiction edge

### 2.3 Ensure support edges don't become "semantic echo" ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/graph/edge-classification.ts`:
  - **Claim-to-Claim Support Gating**:
    - GATE 1: Requires slot match (>0.3) OR entity overlap (>0.2) OR shared entity key
    - GATE 2: Modality compatibility check (questions can't support assertions)
    - Prevents "semantic echo" - only creates edges when there's real reinforcement
  
  - **Claim-to-Evidence Support Gating**:
    - GATE 1: Requires entity overlap (>0.2) OR definition/policy evidence (policy, kb, document)
    - GATE 2: Questions can't be supported by evidence (evidence supports assertions)
    - Ensures evidence support represents real backing from external sources
  
  - Added `areModalitiesCompatible()` function:
    - Questions can't support anything (they're asking, not asserting)
    - Other modalities (assert, deny, hedge, promise) can support each other appropriately

**Acceptance**: ✅ Support edges represent real reinforcement, not just "similar sentences"

## Phase 3: Fix Scoring

### 3.1 Make truth score derived from states ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/graph/truth-state-derivation.ts`:
  - Added saturation rule: truth=100 only when truly perfect
  - Requires: no contradictions, high grounding (>=80%), decent support, low ungrounded (<=10%)
  - Prevents false perfect scores by capping at 99 if conditions not met
  - Also prevents false negatives (truth=0 when there's grounding or no contradictions)

**Acceptance**: ✅ No run outputs truth=100 unless truly perfect conditions are met

### 3.2 Add mode-aware scoring semantics ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/graph/truth-state-derivation.ts`:
  - Added `modeAware` field to `TruthScores` interface with separated scores
  - Modified `computeTruthScores()` to accept `hasExternalEvidence` parameter
  - **Transcript-only mode**: weight consistency 50%, grounding 50% (no evidence penalty)
  - **Evidence-backed mode**: weight evidence 40%, consistency 35%, grounding 25%
  - Updated `graph-builder.ts` to pass `hasExternalEvidence` flag
  - Updated `orchestrator.ts` to include `modeAware` scores in output

**Acceptance**: ✅ Transcript-only doesn't produce harsh truth penalties for "no external evidence"

### 3.3 Fix severity computation ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/server/ingestion/issue-derivation.ts`:
  - Refactored `computeSeverity()` to use formula: `(impact × confidence × verifiability) × 100`
  - Added `computeImpact()`: template-driven impact (compliance/financial harm)
    - Contradictions: 0.7-0.9 (agent higher)
    - Ungrounded: 0.5-0.8 (agent higher)
    - Other: 0.3-0.6
  - Added `computeConfidence()`: from edge strength and classification confidence
    - Blends node blame (60%) with edge weights (40%)
    - Minimum 0.3 for detected issues
  - Added `computeVerifiability()`: evidence-backed > transcript-only
    - EXTERNAL_VERIFIED: 1.0
    - AUDIO_VERIFIED: 0.8
    - TRANSCRIPT_PROVIDED: 0.6
    - TRANSCRIPT_ONLY: 0.4
    - MISMATCH_FLAGGED: 0.3
  - Updated `buildIssueDTOs()` to accept and pass `verificationLevel`

**Acceptance**: ✅ Transcript-only runs produce mostly medium issues unless contradictions/risky commitments

## Phase 4: Call-Center Template Realism

### 4.1 Add commitment detector ✅
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/src/server/ingestion/types.ts`:
  - Added `risky_commitment_unverified` to `IssueType`
  
- `packages/tcl-core/src/server/ingestion/issue-derivation.ts`:
  - Enhanced `deriveIssueType()` to detect risky commitments:
    - Checks for agent promises/guarantees that are unverified or ungrounded
    - Priority rule (1.5) - high priority even in transcript-only mode
  - Updated `computeImpact()` to give very high impact (0.95) to risky commitments
  - Added explanation text for risky commitments
  - Updated `ISSUE_TYPE_LABELS` with new type
  
- `packages/tcl-core/src/graph/graph-builder.ts`:
  - Enhanced `detectModality()` to catch more commitment patterns:
    - "will", "guarantee", "promise", "you'll receive", "assure", "commit"
    - "guaranteed", "promised", "assured", "rest assured", "be assured"
  
- `packages/tcl-core/src/server/ingestion/issue-derivation.ts`:
  - Updated `buildIssueDTOs()` to pass claim modality and speaker role to `deriveIssueType()`

**Acceptance**: ✅ These show high severity even without evidence docs

## Deliverable: Build-Time Rule ✅

### Add ESLint/grep-based CI step
**Status**: COMPLETED

**Changes Made**:
- `packages/tcl-core/scripts/check-hardcoded-values.sh`:
  - Created shell-based checker (no dependencies, CI-friendly)
  - Checks for hard-coded thresholds: `supportThreshold:`, `contradictionThreshold:`, `groundingThreshold:`
  - Checks for hard-coded clamps: `Math.min(config.thresholds.*, 0.X)`, `Math.max(config.thresholds.*, 0.X)`
  - Checks for magic numbers in calculations: `0.65`, `0.70`, `0.60`, etc.
  - Automatically excludes: `template-config.ts`, test files, comments, node_modules, dist
  
- `packages/tcl-core/scripts/check-hardcoded-values.ts`:
  - TypeScript version with more detailed reporting
  - Line-by-line violation reporting with file paths and column numbers
  
- `packages/tcl-core/package.json`:
  - Added `check:hardcoded` script (shell version)
  - Added `check:hardcoded:ts` script (TypeScript version)
  
- `packages/tcl-core/scripts/README.md`:
  - Documentation for using the checker
  - Examples of violations and how to fix them
  - CI integration examples

**Usage**:
```bash
cd packages/tcl-core
npm run check:hardcoded
```

**Acceptance**: ✅ Build fails if hard-coded thresholds/clamps appear in calculation paths

## Next Steps

1. Complete Phase 0.2 (debug-only scoring)
2. Complete Phase 1.3 (grounding threshold)
3. Start Phase 2 (edge quality improvements)
4. Continue with Phase 3 and 4
5. Add build-time enforcement

