# Field Usage Map - ProtectQA / TCL

**Purpose:** Document which fields from API responses are actually used by the UI, to identify candidates for removal in slim mode or future cleanup.

**Date:** 2026-01-06

---

## IssueV2 Field Usage

### ✅ USED (Keep in all modes)

**Core Identity:**
- `issueId` - Used in templates, detail modals, routing
- `issueKey` - Used in audit tables, detail modals
- `runId` - Used in audit tables
- `conversationId` - Used for navigation, linking

**Display & Ranking:**
- `severity` - Used in badges, chips, sorting, filtering
- `severityDisplay` - Used in UI labels (transcript-only mode)
- `impact` - Used in issue detail modals, compliance dashboard
- `score` - Used in tooltips, sorting, display (0-100)
- `riskScore` - Used as fallback for score (0-1)
- `confidence` - Used in detail modals
- `type` - Used in badges, filtering
- `category` - Used in badges, filtering, compliance dashboard

**Content:**
- `what.issueSummary` - Primary display text in tables, modals
- `what.issueDetail` - Full detail in modals
- `what.primaryClaimId` - Used in traceability, graph views
- `what.claimText` - Used in detail modals, evidence display
- `what.relatedClaimIds` - Used in detail modals (optional)

**Verification:**
- `verification.level` - Used in badges, filtering, compliance dashboard
- `verification.reasonCodes` - Used in detail modals

**Speaker/Context:**
- `who.speaker` - Used in detail modals, filtering
- `who.turnIndex` - Used in detail modals, evidence display

**Evidence:**
- `evidence.refs[]` - Used in detail modals, evidence tab
  - `sourceType` - Used in badges
  - `sourceId` - Used in display
  - `quote` - Used in evidence display
  - `weight` - Used in evidence display (optional)
  - `turnIndex` - Used in evidence display (optional)
- `evidence.edges[]` - Used in detail modals, graph views
  - `kind` - Used in display
  - `claimA` - Used in display
  - `claimB` - Used in display (optional)
  - `weight` - Used in display

**Compliance:**
- `compliance.tags[]` - Used in chips, filtering
- `compliance.impactedPolicies[]` - Used in detail modals
  - `policyId` - Used in display
  - `section` - Used in display (optional)
- `compliance.legalHoldSuggested` - Used in badges, detail modals
- `compliance.disclaimers[]` - Used in detail modals

**Audit:**
- `audit.createdAt` - Used in audit tables, detail modals
- `audit.engineVersion` - Used in audit tables, detail modals
- `audit.scorerId` - Used in audit tables, detail modals
- `audit.configHash` - Used in audit tables, detail modals (optional)
- `audit.inputHash` - Used in audit tables, detail modals (optional)
- `audit.modelFingerprint` - Used in audit tables (optional)

**Workflow:**
- `status` - Used in tables, filtering, workflow UI
- `assigneeUserId` - Used in tables, workflow UI
- `workflowUpdatedAt` - Used in workflow UI (optional)
- `evaluationId` - Used for navigation, linking
- `evaluationCreatedAt` - Used in sorting, display

**Scoring (Enterprise):**
- `scoring.components` - Used in tooltips, detail modals
  - `impact01` - Used in score breakdown
  - `evidence01` - Used in score breakdown
  - `signal01` - Used in score breakdown
  - `category01` - Used in score breakdown
- `scoring.weights` - Used in score breakdown
- `scoring.reasons[]` - Used in score breakdown

**Flags:**
- `reviewRequired` - Used in badges, filtering

### ⚠️ DEBUG ONLY (Remove in slim mode)

**Internal/Intermediate:**
- None identified yet (all fields appear to be used for display or workflow)

### ❓ UNUSED (Candidate for removal)

**Potentially Unused:**
- `runId` - May only be used in audit tables (low usage)
- `audit.modelFingerprint` - May only be used in audit tables (low usage)

**Note:** These fields are marked as "potentially unused" but should be verified with actual usage analysis before removal.

---

## Evaluation Field Usage

### ✅ USED (Keep in all modes)

**Core Identity:**
- `id` - Used in routing, API calls
- `org_id` - Used for authorization (backend)
- `project_id` - Used for filtering
- `env` - Used for filtering, display
- `conversation_id` - Used for navigation, linking
- `created_at` - Used in tables, sorting

**Scores:**
- `scores.spectral.*` - Used in evaluation results display
- `scores.counts.*` - Used in evaluation summary

**Metadata:**
- `engine_version` - Used in audit displays
- `latency_ms` - Used in performance metrics
- `refusal` - Used in evaluation results
- `scorer_id` - Used in audit displays

**Report (Full mode only):**
- `report.summary` - Used in executive summary
- `report.issues[]` - Used in legacy issue display
- `report.topIssuesV2[]` - Used in issue tables
- `report.allIssuesV2[]` - Used in issue tables
- `report.claims[]` - Used in claims view, graph
- `report.graph.contradictions[]` - Used in graph view
- `report.graph.supports[]` - Used in graph view
- `report.spectral.*` - Used in spectral analysis view
- `report.run.*` - Used in audit/reproducibility

### ⚠️ DEBUG ONLY (Remove in slim mode)

**Internal/Intermediate:**
- `report.spectral.truthVector` - Large array, only used in debug views
- `report.spectral.truthStates` - Large array, only used in debug views
- `report.spectral.nodeBlameNorm` - Large array, only used in debug views
- `report.graph.debug.*` - Debug information, not used in UI

### ❓ UNUSED (Candidate for removal)

**Potentially Unused:**
- None identified yet

---

## Pattern Aggregation Field Usage

### ✅ USED (Keep in all modes)

**Pattern Identity:**
- `patternKey` - Used for grouping, API calls
- `title` - Used in table display
- `summary` - Used in table display
- `category` - Used in filtering, display
- `type` - Used in filtering, display

**Aggregates:**
- `occurrences` - Used in table display, sorting
- `uniqueAgents` - Used in table display
- `uniqueCustomers` - Used in table display
- `avgRiskScore` - Used in table display, sorting
- `maxRiskScore` - Used in table display
- `priorityScore` - Used in table display, sorting

**Verification Mix:**
- `verificationCounts.EXTERNAL_VERIFIED` - Used in display
- `verificationCounts.TRANSCRIPT_ONLY` - Used in display
- `verificationCounts.NONE` - Used in display

**Trend:**
- `trend.direction` - Used in table display (up/down/flat icons)
- `trend.pctChange` - Used in table display
- `firstSeenAt` - Used in table display
- `lastSeenAt` - Used in table display, sorting

**Workflow:**
- `status` - Used in filtering, workflow UI
- `assignee` - Used in filtering, workflow UI

**Severity:**
- `severity` - Used in filtering, display
- `severityDisplay` - Used in filtering, display
- `impact` - Used in display

---

## Recommendations

### For Slim Mode (`?mode=slim`)

**Evaluation DTO:**
- Exclude `report` field entirely (UI can fetch via `/api/evaluations/:id/issues`)
- Keep all other fields (they're all used)

**Issue DTO:**
- Keep all fields (they're all used for display or workflow)
- Consider excluding `evidence.edges` if not needed for basic display

**Pattern DTO:**
- Keep all fields (they're all used)

### For Future Cleanup

1. **Verify low-usage fields:**
   - `runId` - Check if actually needed
   - `audit.modelFingerprint` - Check if actually needed

2. **Consider nested field optimization:**
   - `evidence.edges` - Only include if graph view is needed
   - `what.relatedClaimIds` - Only include if traceability view is needed

3. **Add field-level slim mode:**
   - Allow excluding specific nested fields (e.g., `?exclude=evidence.edges`)

---

## Usage Analysis Method

1. **Grep searches** for field access patterns in:
   - Angular templates (`*.html`)
   - TypeScript components (`*.ts`)
   - Services (`*.service.ts`)

2. **Template analysis** for:
   - Direct property access (`issue.field`)
   - Nested property access (`issue.what.summary`)
   - Array iteration (`*ngFor="let item of issue.array"`)

3. **Service analysis** for:
   - Type definitions
   - API response handling
   - Data transformation

---

**Last Updated:** 2026-01-06

