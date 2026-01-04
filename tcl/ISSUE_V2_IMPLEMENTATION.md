# Issue V2 Implementation Summary

## Overview

Implemented enterprise-grade issue expansion and ranking system that generates **all issues** (uncapped) from graph edges, then ranks them deterministically.

## Key Features

### 1. Issue Expansion (`issue-expansion.ts`)

**Rule A: Contradiction Edges → CONTRADICTION Issues**
- Creates one issue per contradiction edge
- Stable dedupe key: `contradiction:${min(a,b)}:${max(a,b)}`
- Includes evidence refs from both claims
- Compliance tags: `["consistency", "customer_dispute_risk"]`

**Rule B: Unverified Claims → UNVERIFIED_CLAIM Issues**
- Only in transcript-only mode
- Only for agent assertions/promises (not customer claims)
- Requires grounding (has transcript evidence)
- Stable dedupe key: `unverified:${claimId}`

**Rule C: Pattern Issues**
- Placeholder for future pattern detection
- Only generates if signals already exist (no hallucination)

### 2. Risk Ranking (`risk-ranking.ts`)

**Deterministic Scoring Formula:**
```
riskScore = clamp01(
  typeBase * (0.6 + 0.4*edgeStrength) * speakerMult * verifyMult
)
```

**Deterministic Sorting:**
1. riskScore desc
2. severity desc (critical > high > medium > low)
3. type priority (from config)
4. turnIndex asc
5. issueKey asc

**Config-Driven:**
- All thresholds from `config/risk-ranking.json`
- No hard-coded values
- `maxTopIssues` configurable (default: 4)

### 3. IssueV2 Schema

Enterprise-grade schema with:
- **Stable IDs**: `issueId` = hash(runId + issueKey)
- **Verification**: `TRANSCRIPT_ONLY` | `EXTERNAL_VERIFIED` | `NONE`
- **Compliance**: tags, disclaimers, legal hold suggestions
- **Audit**: engineVersion, scorerId, hashes, timestamps
- **Evidence**: traceable refs with sourceType, sourceId, quotes

### 4. API Response Structure

```json
{
  "report": {
    "allIssuesV2": [...],      // ALL issues (uncapped)
    "topIssuesV2": [...],       // Top N (config-driven)
    "issueSummaryV2": {
      "totalIssues": 64,
      "byType": { "CONTRADICTION": 4, "UNVERIFIED_CLAIM": 60 },
      "bySeverity": { "low": 50, "medium": 10, "high": 4 },
      "topIssuesCount": 4,
      "allIssuesCount": 64
    },
    "issueNarratives": {...},   // Legacy (still present)
    "issueAnalysis": {...}      // Legacy alias
  }
}
```

## Compliance Guarantees

✅ **Transcript-Only Disclaimers**: Every issue includes disclaimer when `evidenceMode === 'TRANSCRIPT_ONLY'`

✅ **No False "Supported"**: Issues never marked as externally verified unless external evidence exists

✅ **Evidence Traceability**: Every issue has at least one evidence ref with `sourceType` and `sourceId`

✅ **Audit Trail**: All issues include `audit` block with engineVersion, scorerId, hashes

✅ **Deterministic Ranking**: Same input + config = same ordering

## Acceptance Tests

### Test 1: All Issues Uncapped ✅
- `allIssuesV2.length >= 64` (60 unverified + 4 contradictions minimum)
- `issueSummaryV2.totalIssues === allIssuesV2.length`

### Test 2: Contradictions Become Issues ✅
- Issue keys: `contradiction:c2:c4`, `contradiction:c33:c35`, etc.
- One issue per contradiction edge

### Test 3: Transcript-Only Disclaimers ✅
- `verification.level === "TRANSCRIPT_ONLY"` for all issues
- `compliance.disclaimers` includes transcript-only disclaimer

### Test 4: Deterministic Ranking ✅
- Repeated runs produce identical `topIssuesV2` ordering

## Files Created/Modified

### New Files
- `packages/tcl-core/src/config/risk-ranking.json` - Config for thresholds/weights
- `packages/tcl-core/src/config/risk-ranking.ts` - Config loader
- `packages/tcl-core/src/analysis/issue-expansion.ts` - Issue expansion logic
- `packages/tcl-core/src/analysis/risk-ranking.ts` - Risk scoring and ranking

### Modified Files
- `packages/tcl-core/src/types.ts` - Added IssueV2 types
- `packages/tcl-core/src/server/express.ts` - Integrated expansion + ranking

## Next Steps

1. **Pattern Detection**: Implement Rule C (numeric mismatches, commitment inconsistencies)
2. **UI Integration**: Update frontend to display `allIssuesV2` and `topIssuesV2`
3. **Export Support**: Add IssueV2 to export endpoints (CSV, JSON, PDF)
4. **Config UI**: Allow admins to adjust `maxTopIssues` and severity thresholds

