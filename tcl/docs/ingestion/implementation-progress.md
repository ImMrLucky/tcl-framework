# Batch Upload Implementation Progress

**Date:** 2025-01-15  
**Status:** In Progress

## Completed ✅

### A) Inventory/Audit
- ✅ Created audit document: `tcl/docs/ingestion/batch-upload-audit.md`
- ✅ Documented current implementation gaps and missing features

### B) Canonical Batch Ingestion Contract
- ✅ Created `tcl/packages/tcl-core/src/server/ingestion/canonical-transcript.ts`
  - Defines `CanonicalTranscript`, `CanonicalTurn`, `TranscriptSource` interfaces
  - Includes validation and normalization helpers
- ✅ Created `tcl/packages/tcl-ui/src/app/batch-ingestion/canonical-transcript.interface.ts`
  - Frontend TypeScript interfaces matching backend schema

### E) DB Schema
- ✅ Created migration: `tcl/supabase/sql/042_batch_imports.sql`
  - `ingest_imports` table for tracking batch uploads
  - `ingest_import_items` table for per-file results
  - RLS policies configured

### G) Configuration System
- ✅ Created `tcl/packages/tcl-core/src/server/ingestion/batch-config.ts`
  - Centralized configuration for file types, limits, parsing rules
  - Default configuration with accepted extensions, zip rules, CSV contracts, JSONL config
  - Helper functions for validation

### C) Batch Format Parsers (Partial)
- ✅ Created `tcl/packages/tcl-core/src/server/ingestion/parsers/jsonl-parser.ts`
  - Parses newline-delimited JSON files
  - Supports canonical and minimal schemas
  - Error tracking per line
- ✅ Created `tcl/packages/tcl-core/src/server/ingestion/parsers/csv-batch-parser.ts`
  - Parses turn-level and conversation-level CSV
  - Supports multiple CSV contracts
  - Groups by conversation_id
- ⚠️ Created `tcl/packages/tcl-core/src/server/ingestion/parsers/zip-parser.ts`
  - **NOTE:** Requires `yauzl` or `adm-zip` package to be added to dependencies
  - Logic implemented but needs dependency installation

## In Progress 🚧

### D) API Changes
- ⚠️ New endpoint `POST /api/ingest/batch` with multipart/form-data
  - Needs to be created (see next steps)
- ⚠️ Endpoints for fetching results:
  - `GET /api/ingest/batch/{import_id}`
  - `GET /api/ingest/batch/{import_id}/items`

### F) UI Changes
- ⚠️ Show accepted file types in UI
- ⚠️ Multi-select file input (already supported, needs UI indication)
- ⚠️ Client-side validation
- ⚠️ Batch Import Results screen
- ⚠️ "What's supported?" expandable panel

## Not Started ❌

### SPEC 2 — Scheduled Batch Ingestion
- All parts (A-E) not yet started

## Next Steps (Priority Order)

1. **Add ZIP parser dependency:**
   ```bash
   cd tcl/packages/tcl-core
   npm install yauzl @types/yauzl
   ```
   OR
   ```bash
   npm install adm-zip
   ```

2. **Create new batch upload API endpoint:**
   - `POST /api/ingest/batch` with multipart/form-data
   - Parse files based on extension (zip/jsonl/csv)
   - Create `ingest_imports` and `ingest_import_items` records
   - Return import_id and initial results

3. **Create result fetching endpoints:**
   - `GET /api/ingest/batch/{import_id}`
   - `GET /api/ingest/batch/{import_id}/items?cursor=...`

4. **Update UI:**
   - Add accepted file types display
   - Add file validation before upload
   - Create batch import results page
   - Add drilldown links to evaluations

5. **Run database migration:**
   ```sql
   -- Apply migration 042_batch_imports.sql
   ```

6. **Create configuration API endpoint:**
   - `GET /api/config/ingestion` to serve config to frontend

7. **Implement SPEC 2 (Scheduled Batch Ingestion):**
   - Create scheduling tables
   - Implement scheduler worker
   - Create UI for data sources and schedules

## Files Created

- `tcl/docs/ingestion/batch-upload-audit.md`
- `tcl/docs/ingestion/implementation-progress.md` (this file)
- `tcl/packages/tcl-core/src/server/ingestion/canonical-transcript.ts`
- `tcl/packages/tcl-ui/src/app/batch-ingestion/canonical-transcript.interface.ts`
- `tcl/supabase/sql/042_batch_imports.sql`
- `tcl/packages/tcl-core/src/server/ingestion/batch-config.ts`
- `tcl/packages/tcl-core/src/server/ingestion/parsers/jsonl-parser.ts`
- `tcl/packages/tcl-core/src/server/ingestion/parsers/csv-batch-parser.ts`
- `tcl/packages/tcl-core/src/server/ingestion/parsers/zip-parser.ts` (needs dependency)

## Dependencies Needed

- `yauzl` or `adm-zip` for ZIP file parsing
- (Optional) `@types/yauzl` if using yauzl

