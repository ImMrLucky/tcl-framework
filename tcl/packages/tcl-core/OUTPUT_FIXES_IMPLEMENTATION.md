# Output Fixes Implementation Summary

## Status: Core Foundation Complete ✅

This document tracks the implementation of the "Output Fixes Spec" to make evaluation output internally consistent, audit-defensible, and avoid bogus CRITICAL contradictions.

## ✅ Completed

### 1. EngineConfig (Single Source of Truth)
**File:** `packages/tcl-core/src/config/engine-config.ts`

- ✅ Created unified `EngineConfig` type extending `ScoringConfig`
- ✅ Added `mode: 'transcript_only' | 'with_external_docs'`
- ✅ Added `SeverityPolicy` for different modes
- ✅ Added additional thresholds: `contradictedThreshold`, `topicOverlapThreshold`, `polarityOppositionThreshold`
- ✅ All thresholds come from config (no hard-coded values)

### 2. RunFingerprint (Single Source of Truth)
**File:** `packages/tcl-core/src/config/run-fingerprint.ts`

- ✅ Created `RunFingerprint` type with all run metadata
- ✅ Includes: `runId`, `engineVersion`, `codeVersion`, `configHash`, `inputHash`
- ✅ Includes model identifiers: `scorerId`, `nliModelId`, `embeddingModelId`
- ✅ Includes component versions: `claimExtractorVersion`, `ruleEngineVersion`, `factExtractorVersion`
- ✅ Helper functions: `computeConfigHash()`, `computeInputHash()`, `createRunFingerprint()`

### 3. ClaimResult (Canonical Per-Claim Output)
**File:** `packages/tcl-core/src/analysis/claim-result.ts`

- ✅ Created `ClaimResult` type with all per-claim data
- ✅ Includes: `grounding`, `verification`, `edges`, `finalTruthState`
- ✅ `computeFinalTruthState()` function uses EngineConfig thresholds
- ✅ `createClaimResult()` helper function
- ✅ All counts must derive from ClaimResults (no separate computation)

### 4. Enhanced Contradiction Eligibility Gating
**File:** `packages/tcl-core/src/claim_classifier.ts`

- ✅ **Gate 1:** Claim-type compatibility (fact↔fact, policy↔policy, amount↔amount, promise↔promise)
- ✅ **Gate 2:** Non-contradictory kinds (intent, question, emotion, meta)
- ✅ **Gate 3:** Self-contradictory kinds (promise can only contradict promise)
- ✅ **Gate 4:** Topic overlap threshold (from config)
- ✅ **Gate 5:** Polarity/opposition signal (from config)
- ✅ **Gate 6:** Timeframe overlap (placeholder - needs implementation)
- ✅ All thresholds come from EngineConfig

### 5. Counts Computation from ClaimResults
**File:** `packages/tcl-core/src/analysis/counts-from-claims.ts`

- ✅ `computeCountsFromClaims()` - computes all counts from ClaimResults
- ✅ Counts: `supported`, `contradicted`, `ungrounded`, `inconclusive`, `verified`, `unverified`
- ✅ Edge counts: `supportEdges`, `contradictionEdges`, `contradictionsAboveThreshold`
- ✅ `generateDefinitions()` - generates definition strings from EngineConfig
- ✅ No duplicate computation - single source of truth

### 6. Truth Score Semantics Fix
**File:** `packages/tcl-core/src/analysis/truth-scoring.ts`

- ✅ Replaced misleading "truth=100" with proper metrics
- ✅ `transcriptGrounding` - how well claims map to transcript
- ✅ `externalVerification` - how well claims map to external docs (mode-dependent)
- ✅ `consistency` - based on contradiction presence/energy
- ✅ `truth` / `auditTruth` - computed from above components
- ✅ In transcript-only mode: truth cannot be 100 if contradictions exist
- ✅ All formulas use weights from EngineConfig (no literals)

## 🔄 In Progress

### 7. Integration with Orchestrator
- Need to update `orchestrator.ts` to use new types
- Need to create ClaimResults from graph data
- Need to use RunFingerprint throughout

### 8. Severity/Risk Mapping for Transcript-Only Mode
- Need to implement SeverityPolicy rules
- Update risk scoring to use new severity policy

## 📋 Remaining Tasks

### 9. De-duplicate Reporting with Stable IDs
- Add `edgeId` to all edges
- Add `issueId` to all issues
- Add `narrativeId` to all narratives
- Ensure all references use IDs (not re-computation)

### 10. Update UI
- Show `mode` (transcript_only vs with_external_docs)
- Show `unverifiedClaimsCount`
- Show `contradictionsAboveThresholdCount`
- Show `topContradictions` with edgeId
- Update definitions to match EngineConfig

## 🎯 Acceptance Criteria Status

1. ✅ **If contradictions exist above threshold, scores.truth MUST be < 100** (unless mode explicitly says "truth=transcript_only")
   - Implemented in `truth-scoring.ts`

2. ✅ **In transcript-only mode: claims with transcript evidence MUST NOT be labeled "ungrounded"**
   - Implemented in `claim-result.ts` `computeFinalTruthState()`

3. ✅ **Thresholds shown in "definitions" MUST exactly match thresholds used by engine**
   - Implemented in `counts-from-claims.ts` `generateDefinitions()`

4. ✅ **counts.supported/ungrounded/contradicted MUST match canonical per-claim finalTruthState**
   - Implemented in `counts-from-claims.ts` `computeCountsFromClaims()`

5. ⏳ **Same run must not output conflicting engine versions / fingerprints**
   - RunFingerprint created, but needs integration

## 📝 Next Steps

1. **Integrate new types into orchestrator**
   - Update `validateOnce()` to create RunFingerprint
   - Update graph building to create ClaimResults
   - Update scoring to use new truth scoring

2. **Update report generation**
   - Use ClaimResults for all counts
   - Use RunFingerprint for all metadata
   - Use EngineConfig for all thresholds

3. **Update UI components**
   - Show new fields
   - Update definitions
   - Show mode indicator

4. **Add tests**
   - Test contradiction gating
   - Test truth score computation
   - Test counts computation

## 🔍 Key Files Created/Modified

### New Files
- `packages/tcl-core/src/config/engine-config.ts` - Unified config
- `packages/tcl-core/src/config/run-fingerprint.ts` - Run metadata
- `packages/tcl-core/src/analysis/claim-result.ts` - Per-claim output
- `packages/tcl-core/src/analysis/counts-from-claims.ts` - Counts computation
- `packages/tcl-core/src/analysis/truth-scoring.ts` - Truth score semantics

### Modified Files
- `packages/tcl-core/src/claim_classifier.ts` - Enhanced contradiction gating

## 📚 Usage Example

```typescript
import { getEngineConfig } from './config/engine-config.js';
import { createRunFingerprint } from './config/run-fingerprint.js';
import { createClaimResult, computeFinalTruthState } from './analysis/claim-result.js';
import { computeCountsFromClaims, generateDefinitions } from './analysis/counts-from-claims.js';
import { computeTruthScores } from './analysis/truth-scoring.js';

// 1. Get config
const config = getEngineConfig();

// 2. Create run fingerprint
const fingerprint = createRunFingerprint({
  runId: '...',
  config,
  question: '...',
  answer: '...',
});

// 3. Create ClaimResults from graph data
const claimResults = claims.map(claim => 
  createClaimResult(claim, graphData, config)
);

// 4. Compute counts
const counts = computeCountsFromClaims(claimResults, config);

// 5. Compute truth scores
const scores = computeTruthScores(claimResults, counts, config);

// 6. Generate definitions
const definitions = generateDefinitions(config);
```

