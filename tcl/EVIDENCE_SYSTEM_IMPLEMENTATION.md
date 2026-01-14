# Evidence System Implementation Status

## Overview

This document tracks the implementation of the Evidence/Policy System + Categories & "View By" Ordering (Lenses) feature for ProtectQA.

**Key Principle**: Industry/context only sets default lens + suggested templates, **never** the scoring math.

## Phase 1 Status: Database Schema ✅ + Type Definitions ✅

### Completed

1. **Database Migration** (`028_evidence_system_phase1.sql`)
   - ✅ `evidence_items` table with scopes (ORG, PROJECT, TEMPLATE, CONVERSATION)
   - ✅ Source types (POLICY, RULESET, KNOWLEDGE, ACCOUNT_FACTS, LEGAL, URL_LINK, SYSTEM_EXPORT)
   - ✅ Governance fields (status, version, effective dates, approvals)
   - ✅ Storage support (FILE and LINK with SHA-256)
   - ✅ Indexing status tracking
   - ✅ `evidence_chunks` table for retrieval
   - ✅ `evidence_approvals` audit table
   - ✅ Org-level business context fields (businessFunctionPrimary, industryPrimary, regions, defaultLens)
   - ✅ Project-level business context fields (businessFunctionOverride, industryOverride, defaultTemplateId, defaultLens)
   - ✅ Evaluations table updates (evidenceSet, evidenceDiagnostics, templateId, simulationMode)
   - ✅ Helper function `resolve_evidence_set()` for resolving evidence sets

2. **TypeScript Types**
   - ✅ `evidence.types.ts` - EvidenceItem, EvidenceChunk, EvidenceCitation, EvidenceSet types
   - ✅ Business context types (BusinessFunctionPrimary, IndustryPrimary, LensId)
   - ✅ Canonical categories type
   - ✅ Updated `IssueV2` in `types.ts` with:
     - `primaryCategory?: CanonicalCategory`
     - `transcriptSpans?: Array<{...}>`
     - `evidenceRefs?: EvidenceCitation[]`
     - Updated `verification.level` (DOC_SUPPORTED, SYSTEM_VERIFIED, TRANSCRIPT_PROVABLE, UNVERIFIED)
     - Updated `verification.provenance` structure
   - ✅ Updated `IssueV2` in `evaluation-v2.types.ts` (UI types)
   - ✅ Updated `IssueV2` in `evaluation-results.component.ts` (component types)

### Next Steps (Phase 1 Continuation)

3. **Evidence Model/Service** - Backend service for evidence CRUD operations
4. **Storage Integration** - File/link upload to Supabase Storage with SHA-256
5. **Evidence API Endpoints** - REST API for evidence management
6. **EvidenceSet Resolver** - Backend logic for resolving evidence sets
7. **Evaluation Integration** - Update evaluation creation to accept evidence
8. **UI Components** - Evidence attachment panel, evidence summary card
9. **Lens-Based Ordering** - Update All Findings table with categories and lens ordering

## Database Schema Summary

### evidence_items
- Core evidence storage with scopes, source types, governance
- Supports both file uploads and URL links
- Tracks indexing status and chunk counts
- Includes rule metadata for RULESET type

### evidence_chunks
- Indexed chunks for semantic retrieval
- Stores embeddings (as JSONB, can be upgraded to pgvector later)
- Inherits tags from parent evidence_item

### Organizations & Projects
- Business context fields for default lens selection
- Industry and business function tracking
- Region/jurisdiction support

### Evaluations
- Stores resolved EvidenceSet for each run
- Evidence diagnostics for audit trail
- Simulation mode flag (admin-only)

## Canonical Categories

The system uses these stable categories (industry-agnostic):

1. **compliance** - Regulations/standards (PCI, HIPAA, SOX)
2. **privacy_security** - PII/PHI/PCI handling, credentials, data leakage
3. **billing_financial** - Fees, refunds, payments, pricing
4. **promises_consistency** - Contradictions, commitments, "we will" statements
5. **policy_process** - Required steps, scripts, disclosures, QA rules
6. **customer_dispute** - Escalation, chargeback threats, disputes

## View By Lenses

Lenses change ordering/grouping only, not findings:

- `regulatory_exposure` - Compliance-focused ordering
- `financial_exposure` - Billing/financial risk ordering
- `customer_dispute_risk` - Customer escalation ordering
- `promise_commitment_risk` - Promise/commitment ordering
- `privacy_security_risk` - Privacy/security ordering
- `operational_process_risk` - Process/policy ordering
- `neutral_engine_order` - Default riskScore ordering

## IssueV2 Schema Updates

### New Fields Added:
- `primaryCategory?: CanonicalCategory` - Canonical category (compliance, privacy_security, etc.)
- `transcriptSpans?: Array<{...}>` - Transcript spans for traceability
- `evidence.evidenceRefs?: EvidenceCitation[]` - New evidence citation structure
- `verification.provenance` - Enhanced with transcriptAnchors and evidenceDocRefs

### Updated Fields:
- `verification.level` - Now includes DOC_SUPPORTED, SYSTEM_VERIFIED, TRANSCRIPT_PROVABLE, UNVERIFIED
- `evidence.refs` - Marked as optional (legacy, for backward compatibility)
- `compliance.tags` - Enhanced to support new taxonomy tags

## Implementation Phases

### Phase 1 (Current)
- ✅ Database schema
- ✅ Type definitions
- 🔄 Evidence model/service
- 🔄 Storage integration
- 🔄 API endpoints
- 🔄 EvidenceSet resolver
- 🔄 Evaluation integration
- 🔄 UI components (attachment panel, summary card)
- 🔄 Lens-based ordering

### Phase 2 (Future)
- Ruleset structured detectors (mustSay/mustNotSay/disclosures)
- Evidence-aware support/contradiction edges
- Verification labels (DOC_SUPPORTED, SYSTEM_VERIFIED)
- Template evidence attachment

### Phase 3 (Future)
- Approval workflow UI
- Link snapshotting and change detection
- System export verifications (ledger/CRM) → SYSTEM_VERIFIED

## Key Constraints

1. **No hard-coded industry weights** - Industry only affects default lens, not scoring
2. **DRAFT docs don't affect production** - Unless Simulation Mode is enabled
3. **EvidenceSet must be emitted** - Every evaluation run must include resolved evidence set
4. **Traceability required** - Every IssueV2 must include transcript spans and evidence refs
5. **No transcript-only inflation** - Keep existing riskScore math, only adjust verification labels

## Files Created/Modified

### New Files
- `tcl/supabase/sql/028_evidence_system_phase1.sql` - Database migration
- `tcl/packages/tcl-core/src/types/evidence.types.ts` - Evidence system types
- `tcl/EVIDENCE_SYSTEM_IMPLEMENTATION.md` - This file

### Modified Files
- `tcl/packages/tcl-core/src/types.ts` - Updated IssueV2 with new fields
- `tcl/packages/tcl-ui/src/app/evaluation-v2.types.ts` - Updated IssueV2 UI types
- `tcl/packages/tcl-ui/src/app/evaluation-results/evaluation-results.component.ts` - Updated local IssueV2 interface

### Files to Modify (Next Steps)
- Create evidence service/API endpoints
- Update evaluation creation flow
- Update UI components

## Running the Migration

```bash
# Via Supabase CLI
supabase db execute -f tcl/supabase/sql/028_evidence_system_phase1.sql

# Or via Supabase Dashboard SQL Editor
# Copy/paste the contents of 028_evidence_system_phase1.sql
```

## Testing Checklist

- [x] Migration SQL syntax validated
- [x] Type definitions updated
- [ ] Migration runs successfully
- [ ] Evidence items can be created (FILE and LINK)
- [ ] EvidenceSet resolver function works correctly
- [ ] Org/project business context fields are accessible
- [ ] Evaluations table accepts evidenceSet JSONB
- [ ] IssueV2 types compile without errors
