# Batch Upload Implementation Audit

**Date:** 2025-01-15  
**Purpose:** Inventory existing batch upload implementation to inform improvements per SPEC 1

## Current Implementation Summary

### Frontend (UI)

**Component:** `tcl/packages/tcl-ui/src/app/batch-ingestion/batch-ingestion.component.ts`

**File Input:**
- Location: `batch-ingestion.component.html` line 130-135
- Accept attribute: `.mp3,.wav,.m4a,.txt,.json`
- Multiple file selection: **YES** (`multiple` attribute present)
- Current behavior:
  - User selects files via file input
  - Files stored in `selectedFiles: File[]` array
  - Each file mapped to batch item with `title`, `mode: 'AUDIO_PLUS_TRANSCRIPT'`, and `sourceRef`

**Upload Service:**
- Service: `BatchIngestionService` (`batch-ingestion.service.ts`)
- Endpoint used: `POST /api/ingest/batch/create`
- Request body:
  ```typescript
  {
    sourceType: 'UPLOAD',
    items: Array<{
      title: string,
      mode: 'AUDIO_PLUS_TRANSCRIPT',
      sourceRef: { name, size, type }
    }>,
    config?: { projectId, env, templateId, representativeId }
  }
  ```

**UI Features:**
- Shows selected files list with names and sizes
- Allows removing files before upload
- Creates batch and navigates to batch detail page
- No client-side validation of file types beyond `accept` attribute
- No indication of supported formats or file size limits

### Backend

**Endpoint:** `POST /api/ingest/batch/create`  
**Location:** `tcl/packages/tcl-core/src/server/batch-ingestion/routes.ts`

**Current Behavior:**
1. Validates `sourceType` and `items` array
2. Creates `ingestion_batches` record with status `CREATED`
3. Creates `ingestion_batch_items` records with status `PENDING`
4. Returns batch ID

**Missing:**
- ❌ No MIME type validation
- ❌ No file size limits
- ❌ No file content parsing (files not uploaded to server yet)
- ❌ No format-specific parsing logic
- ❌ Files are not actually uploaded - only metadata is stored

**Processing Pipeline:**
- Worker: `tcl/packages/tcl-core/src/server/batch-ingestion/worker.ts`
- Current flow:
  1. Batch created with `CREATED` status
  2. User must manually start batch (`POST /api/ingest/batch/:id/start`)
  3. Worker processes items by creating individual `ingestion_jobs`
  4. For connector sources (S3/Dropbox/GDrive), files are downloaded from connector
  5. For `UPLOAD` source type, **files are not actually uploaded** - this is a gap

**Database Schema:**
- Tables: `ingestion_batches`, `ingestion_batch_items` (see `039_batch_ingestion.sql`)
- Current schema supports:
  - Batch metadata (org, project, status, config)
  - Item-level tracking (status, mode, source_ref, job_id, errors)
  - Progress tracking via `progress_json`
- Missing:
  - No `ingest_imports` table (per SPEC 1)
  - No `ingest_import_items` table (per SPEC 1)
  - No per-file import results tracking
  - No conversation_id linking until job completes

## What Types Are Currently Accepted

**Frontend:**
- `.mp3` (audio)
- `.wav` (audio)
- `.m4a` (audio)
- `.txt` (text/transcript)
- `.json` (JSON transcript)

**Backend:**
- No server-side validation of file types
- No explicit rejection of unsupported types

## What Formats Are Parsed

**Current Parsing:**
- Individual files are processed by the regular ingestion pipeline
- Normalizers exist in `tcl/packages/tcl-core/src/server/ingestion/normalizers/`:
  - `csv-turns.ts` - CSV turn-level parsing
  - `json-turns.ts` - JSON transcript parsing
  - `txt-speaker-prefixed.ts` - Speaker-prefixed text parsing
  - `vtt-srt.ts` - Subtitle file parsing

**Missing:**
- ❌ No `.zip` archive parsing
- ❌ No `.jsonl` (newline-delimited JSON) parsing
- ❌ No batch-level CSV parsing (only single-file CSV)
- ❌ No automatic pairing of audio + transcript files
- ❌ No metadata file parsing (CSV/JSON metadata files)

## What Happens After Upload

**Current Flow:**
1. User selects files in UI
2. Frontend creates batch with file metadata (no actual upload)
3. User navigates to batch detail page
4. User manually starts batch
5. Worker processes items:
   - For connector sources: downloads files and creates ingestion jobs
   - For `UPLOAD` source: **This path is incomplete** - files are not uploaded
6. Individual ingestion jobs process each file
7. Results tracked in `ingestion_batch_items` table

**Gaps:**
- Files are never actually uploaded to server for `UPLOAD` source type
- No per-file import results visible to user
- No drilldown from batch item to evaluation
- No clear error reporting per file

## What Is Missing

### Critical Gaps:
1. **File Upload:** No actual file upload endpoint for batch uploads
2. **Format Support:** Missing `.zip`, `.jsonl`, batch CSV parsing
3. **Validation:** No server-side file type or size validation
4. **Parsing:** No batch format parsers (zip, jsonl, csv)
5. **Results:** No `ingest_imports`/`ingest_import_items` tables for import tracking
6. **UI Clarity:** No indication of supported formats, file size limits, or CSV contracts
7. **Error Handling:** No per-file error tracking in import results
8. **Drilldown:** No links from batch items to evaluations

### Nice-to-Have:
- File size limits UI indication
- Progress indication during upload
- Preview of file contents before processing
- Bulk operations on failed items

## Recommendations

1. **Immediate:** Create file upload endpoint (`POST /api/ingest/batch` with multipart/form-data)
2. **High Priority:** Implement `.zip`, `.jsonl`, and CSV batch parsers
3. **High Priority:** Create `ingest_imports` and `ingest_import_items` tables
4. **Medium Priority:** Add UI for accepted file types and validation
5. **Medium Priority:** Add per-file import results and drilldown
6. **Low Priority:** Add file size limits and better error messages

