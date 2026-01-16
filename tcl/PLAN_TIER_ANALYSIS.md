# Plan Tier Feature Separation Analysis

## Current State

### ✅ What EXISTS

1. **Two Feature Systems:**
   - **Capabilities** (`plans.json`): Core platform features (API access, webhooks, batch ingest, etc.)
   - **Entitlements** (`org_entitlements`): Enterprise features (decisions, cases, integrations, etc.)

2. **Plan Tiers Defined:**
   - `SANDBOX` (Free)
   - `TEAM` (Self-serve paid)
   - `ENTERPRISE` (Contact Us - Paid)

3. **Backend Enforcement:**
   - `PlanService`: Enforces usage limits (analyses/day, API calls, file sizes)
   - `EntitlementsService`: Enforces enterprise feature access
   - Both have middleware for route protection

4. **Frontend Services:**
   - `PlanService`: Checks capabilities
   - `EntitlementsService`: Checks entitlements
   - Both loaded from `/api/me` endpoint

### ❌ What's MISSING or INCONSISTENT

1. **No Unified Feature Matrix**
   - Features split between capabilities and entitlements
   - No single source of truth for "what does each tier get?"
   - Hard to see at a glance what SANDBOX vs TEAM vs ENTERPRISE includes

2. **Inconsistent Feature Gating**
   - Some components check `planService.hasCapability()`
   - Some components check `entitlementsService.hasFeature()`
   - Some check both, some check neither
   - Navigation menu doesn't consistently gate features

3. **Missing UI Gating**
   - Navigation items may show features not available on current tier
   - Buttons/actions may appear but fail when clicked
   - No clear "Upgrade Required" messaging in many places

4. **No Upgrade Prompts**
   - When limits are hit (429 errors), no upgrade CTA shown
   - When features are blocked, no upgrade path displayed
   - Missing contextual upgrade prompts

5. **Feature Visibility Issues**
   - Enterprise features (Cases, Integrations) may show in nav for all tiers
   - Batch ingestion may be visible but not accessible
   - No tier badges or indicators showing what's available

6. **Documentation Gap**
   - No clear comparison table of tier features
   - Pricing page may not match actual feature availability
   - Account page shows some comparison but incomplete

## Feature Mapping by Tier

### SANDBOX (Free)
**Capabilities:**
- ✅ ANALYZE_MANUAL_UPLOAD
- ✅ GRAPH_VIEW
- ✅ SPECTRAL_SUMMARY
- ✅ EXPORT_JSON
- ✅ EXPORT_CSV
- ✅ API_ACCESS_SANDBOX (test mode only)
- ✅ WEBHOOKS_TEST

**Entitlements:**
- ❌ All enterprise features disabled

**Limits:**
- 10 analyses/day
- 3 API calls/day
- 10 uploads/day
- 3 files per analysis
- 20 MB per file

### TEAM (Self-serve Paid)
**Capabilities:**
- ✅ All SANDBOX capabilities PLUS:
- ✅ API_ACCESS_PROD
- ✅ WEBHOOKS_PROD
- ✅ BATCH_INGEST
- ✅ USAGE_DASHBOARD

**Entitlements:**
- ✅ issueDecisions
- ✅ batchIngestion
- ❌ All other enterprise features disabled

**Limits:**
- 500 analyses/day
- 5,000 API calls/day
- 500 uploads/day
- 10 files per analysis
- 100 MB per file

### ENTERPRISE (Contact Us)
**Capabilities:**
- ✅ All TEAM capabilities PLUS:
- ✅ CLOUD_CONNECTORS
- ✅ TEMPLATE_CUSTOMIZATION

**Entitlements:**
- ✅ All enterprise features enabled:
  - enterpriseGovernance
  - approvalsWorkflow
  - auditPacksAdvanced
  - legalHold
  - issueDecisions
  - reviewerSignoff
  - cases
  - integrations
  - batchIngestion
  - connectorsS3
  - connectorsDropbox
  - connectorsGDrive

**Limits:**
- Unlimited (-1) for all metrics

## Recommendations

### 1. Create Unified Feature Matrix
Create a single source of truth that maps:
- Feature name
- Which tier(s) have access
- Whether it's a capability or entitlement
- Any limits or restrictions

### 2. Standardize Feature Checking
Create a unified `FeatureService` that:
- Checks both capabilities AND entitlements
- Provides single `hasFeature()` method
- Handles upgrade prompts automatically

### 3. Add UI Gating Everywhere
- Navigation menu: Hide features not available on current tier
- Action buttons: Show "Upgrade Required" instead of disabled buttons
- Feature pages: Show upgrade prompts with clear CTAs
- Limit warnings: Show when approaching limits

### 4. Add Upgrade Prompts
- When limits hit: Show upgrade modal with tier comparison
- When features blocked: Show inline upgrade prompts
- Contextual CTAs: "Upgrade to Team to unlock this feature"

### 5. Improve Feature Visibility
- Add tier badges to features
- Show "Available on [Tier]" labels
- Gray out unavailable features with upgrade hints
- Add feature comparison table in account page

### 6. Document Feature Matrix
- Update pricing page with accurate feature list
- Add feature comparison table
- Document limits clearly
- Show upgrade paths

