# Empty Graph Fixes - Implementation Summary

## Overview

This document summarizes the comprehensive fixes implemented to address empty graph issues and improve debugging capabilities.

---

## Root Causes Fixed

### 1. ✅ Pair Generation - Brute Force for Small N

**Problem**: ANN candidate selection could return zero pairs for small claim sets (e.g., n=2).

**Fix**: 
- Use brute force pair generation for n ≤ 50
- Always generate all directed pairs (i, j) where i ≠ j
- For n=2, guarantees pairs: [(0,1), (1,0)]
- ANN only used for large n (>50)

**File**: `packages/tcl-core/src/graph/edge_builder.ts` (lines 412-450)

---

### 2. ✅ Always Run Claim↔Claim Scoring

**Problem**: If sources were not present, claim↔claim scoring was skipped, resulting in empty graphs.

**Fix**:
- Always run claim↔claim NLI scoring when n > 1
- Grounding is optional (only if sources exist)
- Support and contradiction edges are always generated

**File**: `packages/tcl-core/src/graph/edge_builder.ts` (lines 412-550)

---

### 3. ✅ Fixed MNLI Label Mapping

**Problem**: Hardcoded label order assumption could misread probabilities, causing no edges.

**Fix**:
- Extract `id2label` from model config
- Map labels by string name, not index order
- Handle variants: "ENTAILMENT"/"entailment", "CONTRADICTION"/"contradiction", "NEUTRAL"/"neutral"
- Support both direct label format and logits format
- Expose `labelMap` for debug output

**File**: `packages/tcl-core/src/graph/transformers_scorer.ts` (lines 32-62, 110-160)

---

### 4. ✅ Comprehensive Debug Output

**Problem**: No visibility into why graphs were empty.

**Fix**: Added complete debug object with:
- `numClaims`, `numSourceClaims`
- `annEnabled`, `cacheEnabled`, `spectralEnabled`
- `neighborK`, thresholds
- `pairsGenerated`, `pairsScored`
- `edges`: `supportsAdded`, `contradictionsAdded`, `groundingAdded`
- `filtered`: counts for each threshold filter
- `model`: `scorerId`, `labelMap`
- `reasonIfEmptyGraph`: specific reason if graph is empty

**File**: `packages/tcl-core/src/graph/edge_builder.ts` (lines 560-594)
**Type**: `packages/tcl-core/src/types.ts` (GraphDebugInfo)

---

### 5. ✅ Honest Scores When No Edges

**Problem**: Scores showed 100/100 even when no pairs were scored.

**Fix**:
- If `pairsScored == 0`: consistency defaults to 50 (unknown)
- If Spectral skipped: coherence is `null` (not 50)
- Spectral returns `spectralSkipped: true` and `debugReason` when no edges
- Overall score uses 50 for null coherence (honest default)

**Files**:
- `packages/tcl-core/src/orchestrator.ts` (lines 248-291, 293-298)
- `packages/tcl-core/src/scoring.ts` (line 6)
- `packages/tcl-core/src/types.ts` (coherence: number | null)

---

### 6. ✅ Fixed Claim Confidence Metrics

**Problem**: Confidence metrics appeared constant, not reflecting actual graph edges.

**Fix**:
- `groundingScore`: Use max weight (not average) of grounding edges, 0 if none
- `supportScore`: Normalized sum of incoming support weights, 0 if none (not 0.5)
- `contradictionScore`: Based on contradiction weight sum (not just count)
- All metrics now reflect actual graph state

**File**: `packages/tcl-core/src/confidence.ts` (lines 19-58)

---

## Debug Output Structure

```typescript
{
  debug: {
    numClaims: 2,
    numSourceClaims: 0,
    annEnabled: false,  // Brute force for small n
    cacheEnabled: true,
    spectralEnabled: true,
    neighborK: 10,
    supportThreshold: 0.45,
    contradictionThreshold: 0.55,
    groundingThreshold: 0.45,
    pairsGenerated: 2,  // For n=2: [(0,1), (1,0)]
    pairsScored: 2,
    edges: {
      supportsAdded: 0,
      contradictionsAdded: 1,
      groundingAdded: 0
    },
    filtered: {
      belowSupportThreshold: 1,
      belowContradictionThreshold: 0,
      belowGroundingThreshold: 0,
      droppedByMaxEdges: 0
    },
    model: {
      scorerId: "transformers-roberta-large-mnli",
      labelMap: {
        "0": "CONTRADICTION",
        "1": "NEUTRAL",
        "2": "ENTAILMENT"
      }
    },
    reasonIfEmptyGraph: null  // null if graph has edges
  }
}
```

**Empty Graph Reasons**:
- `"only_one_claim"` - n ≤ 1
- `"no_candidates_generated"` - Pair generation failed
- `"pairwise_scoring_disabled"` - Scoring was skipped
- `"all_probs_below_threshold"` - All scores below thresholds
- `"edges_dropped_by_cap"` - Hit maxPairs limit
- `"unknown_reason"` - Fallback

---

## Spectral Service Updates

**When Spectral is skipped**:
```typescript
{
  coherenceScore: 50,
  contradictionEnergy: 0,
  supportEnergy: 0,
  circularityScore: 0,
  spectralGap: 0,
  spectralSkipped: true,
  debugReason: "no_edges_for_spectral" | "no_spectral_url_configured" | "spectral_service_error: ..."
}
```

**Coherence Score**:
- `number` (0-100) if Spectral ran successfully
- `null` if Spectral was skipped or failed
- Overall score uses 50 as default for null coherence

---

## Testing Checklist

- [ ] Test with n=2 claims (should generate 2 pairs)
- [ ] Test with n=100 claims (should use ANN)
- [ ] Test without sources (should still generate claim↔claim edges)
- [ ] Test with MNLI model (verify label mapping)
- [ ] Test with empty graph (verify debug output and honest scores)
- [ ] Test Spectral with no edges (verify spectralSkipped flag)
- [ ] Test confidence metrics with actual edges (verify they reflect graph state)

---

## Files Modified

1. `packages/tcl-core/src/types.ts` - Added GraphDebugInfo, null coherence support
2. `packages/tcl-core/src/graph/edge_builder.ts` - Fixed pair generation, added debug
3. `packages/tcl-core/src/graph/transformers_scorer.ts` - Fixed MNLI label mapping
4. `packages/tcl-core/src/orchestrator.ts` - Honest scores, Spectral skip handling
5. `packages/tcl-core/src/scoring.ts` - Null coherence support
6. `packages/tcl-core/src/confidence.ts` - Fixed confidence calculation

---

## Next Steps

1. Test with real data to verify fixes
2. Monitor debug output in production
3. Consider adding UI display for debug info (optional)
4. Update Spectral service to handle empty graphs (if needed)

