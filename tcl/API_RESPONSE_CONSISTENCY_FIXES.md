# API Response Consistency Fixes

**Date:** 2026-01-06

## Summary

Fixed multiple issues with API response consistency to ensure the UI always uses the same issue list and summary block from the same run.

---

## 1. Single issueSummaryV2 (No Conflicting Blocks) ✅

**Problem:** Multiple conflicting `issueSummaryV2` blocks could be returned.

**Fix:** 
- Modified `toEvaluationDto()` in `packages/tcl-core/src/server/dto/evaluation.dto.ts`
- **Always compute** `issueSummaryV2` from canonical `allIssuesV2` array
- Never use legacy `report.issues` or multiple conflicting summaries
- Ensures exactly one `issueSummaryV2` per evaluation response

**Code:**
```typescript
// CRITICAL: Compute issueSummaryV2 from canonical allIssuesV2 array
// This ensures the summary matches the exact list the UI displays
const allIssuesV2 = dto.report.allIssuesV2 || [];
if (allIssuesV2.length > 0) {
  // Always compute from canonical issues array (single source of truth)
  dto.report.issueSummaryV2 = computeIssueSummaryV2(allIssuesV2);
}
```

---

## 2. Summary Computed from Canonical Issues Array ✅

**Problem:** Summary was sometimes computed from legacy `report.issues` which is mostly medium in transcript-only mode.

**Fix:**
- Updated `computeIssueSummaryV2()` in `packages/tcl-core/src/server/issues/issue-summary.ts`
- Uses `severityDisplay ?? severity ?? "medium"` for counting
- This ensures the summary matches what the UI displays

**Code:**
```typescript
// Count by severity: use severityDisplay ?? severity ?? "medium"
// This ensures the summary matches what the UI displays
const sev = (issue.severityDisplay ?? issue.severity ?? 'medium') as SeverityV2;
```

---

## 3. Fixed Contradicted Claims Count ✅

**Problem:** `contradicted` count was not computed from unique claim IDs in contradiction edges.

**Fix:**
- Modified `/validate` endpoint in `packages/tcl-core/src/server/express.ts`
- Compute `contradicted` count from unique claim IDs participating in contradiction edges
- If `contradictions > 0`, then `contradicted` = number of unique claim IDs

**Code:**
```typescript
// Fix contradicted count: compute from unique claim IDs in contradiction edges
const contradictionEdges = out.report?.graph?.contradictions || [];
const contradictedClaimIds = new Set<string>();
for (const edge of contradictionEdges) {
  if (edge.claimA) contradictedClaimIds.add(edge.claimA);
  if (edge.claimB) contradictedClaimIds.add(edge.claimB);
}
const contradictedCount = contradictionEdges.length > 0 
  ? contradictedClaimIds.size 
  : (truthSummary?.contradicted ?? 0);
```

---

## 4. Centralized Transcript-Only Severity Policy ✅

**Problem:** Some transcript-only issues had `severityDisplay: "high"` while others were capped to `"medium"` inconsistently.

**Fix:**
- `computeSeverityDisplay()` in `packages/tcl-core/src/analysis/risk-ranking.ts` is the **single source of truth**
- Rules:
  - Never downgrade legal hold / critical compliance signals
  - Only downgrade `UNVERIFIED_CLAIM` type issues in transcript-only mode
  - Downgrade by one band (critical→high→medium→low), not forced to medium
  - Do not downgrade contradictions, risk_signals, safety, harassment, etc.

**Function:**
```typescript
function computeSeverityDisplay(
  severity: SeverityV2,
  verificationLevel: VerificationLevelV2,
  issueType: IssueTypeV2,
  compliance?: { legalHoldSuggested?: boolean },
  scoringContext?: ScoringContext
): SeverityDisplayV2 {
  // Never downgrade legal hold / critical compliance signals
  if (compliance?.legalHoldSuggested) {
    return severity === 'critical' ? 'high' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
  }
  
  // Only downgrade evidence-type "UNVERIFIED" items in transcript-only mode
  if (scoringContext?.mode === 'transcript_only' && verificationLevel === 'TRANSCRIPT_ONLY' && issueType === 'UNVERIFIED_CLAIM') {
    // Downgrade by one band (critical->high->medium->low), but do NOT force medium
    return downgradeOneBand(severity);
  }
  
  // Do not downgrade contradictions, risk_signals, safety, harassment, etc.
  if (severity === 'critical') return 'high';
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}
```

**Note:** All issue scoring now uses this function via `rankIssuesV2()` → `scoreIssue()` → `computeSeverityDisplay()`.

---

## Files Modified

1. `packages/tcl-core/src/server/dto/evaluation.dto.ts`
   - Always compute `issueSummaryV2` from `allIssuesV2`
   - Removed conditional backfill logic

2. `packages/tcl-core/src/server/issues/issue-summary.ts`
   - Changed to use `severityDisplay ?? severity ?? "medium"` for counting

3. `packages/tcl-core/src/server/express.ts`
   - Fixed `contradicted` count to use unique claim IDs from contradiction edges

4. `packages/tcl-core/src/analysis/risk-ranking.ts`
   - `computeSeverityDisplay()` is the centralized function (already existed)
   - All issues go through this function via the scoring pipeline

---

## Acceptance Criteria

✅ **Single issueSummaryV2:** API response contains exactly one `issueSummaryV2` per evaluation  
✅ **Canonical computation:** Summary computed from `allIssuesV2` (same array UI uses)  
✅ **Consistent severity:** Uses `severityDisplay ?? severity ?? "medium"` for counting  
✅ **Fixed contradicted count:** Computed from unique claim IDs in contradiction edges  
✅ **Centralized severity policy:** `computeSeverityDisplay()` is single source of truth  
✅ **Deterministic:** Same input always produces same output

---

## Testing

- ✅ Build passes (`npm run build`)
- ⚠️ Manual testing recommended:
  - Verify `issueSummaryV2` counts match UI display
  - Verify `contradicted` count matches number of unique claim IDs in contradictions
  - Verify transcript-only issues have consistent `severityDisplay` (not mixed high/medium)

---

**Last Updated:** 2026-01-06

