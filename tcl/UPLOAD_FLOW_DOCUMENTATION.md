# Upload Flow Documentation

Complete documentation of the file upload process from user selection to Supabase Storage.

## Overview

The upload process uses **direct client-side uploads to Supabase Storage** to bypass Netlify's 6MB payload limit and improve performance. Files are uploaded directly from the browser to Supabase Storage using the user's authenticated session token.

## Flow Diagram

```
User selects file
    ↓
Frontend: onSubmit() in ingestion.component.ts
    ↓
1. POST /api/ingest/jobs (Create job)
    ↓
2. For each file (audio/transcript):
    ↓
    a. POST /api/ingest/jobs/:jobId/upload-metadata (Get upload metadata)
    ↓
    b. Direct upload to Supabase Storage (project.storage.supabase.co)
    ↓
    c. Compute SHA-256 hash (browser)
    ↓
    d. POST /api/ingest/jobs/:jobId/finalize-upload (Create asset record)
    ↓
3. Job status polling starts
    ↓
4. Background worker processes job
```

## Detailed Step-by-Step Process

### Step 1: User Initiates Upload

**File:** `packages/tcl-ui/src/app/ingestion/ingestion.component.ts`

**Function:** `onSubmit()`

**What happens:**
1. User selects file(s) or enters transcript
2. Determines ingestion mode:
   - `TRANSCRIPT_ONLY` - Text input only
   - `AUDIO_ONLY` - Audio file only
   - `AUDIO_PLUS_TRANSCRIPT` - Both files
3. Creates `File` objects from user input

**Code:**
```typescript
// Step 1: Create ingestion job
const jobResponse = await firstValueFrom(
  this.auditService.createIngestionJob({ mode, options: { analyzeImmediately: true } })
);
```

---

### Step 2: Create Ingestion Job

**API Endpoint:** `POST /api/ingest/jobs`

**File:** `packages/tcl-core/src/server/ingest/jobs.ts`

**Function:** `registerIngestionJobRoutes()` → Create job handler

**Request Body:**
```json
{
  "mode": "AUDIO_ONLY" | "TRANSCRIPT_ONLY" | "AUDIO_PLUS_TRANSCRIPT",
  "options": {
    "analyzeImmediately": true
  }
}
```

**What happens:**
1. Validates user authentication and capabilities
2. Creates record in `ingestion_jobs` table:
   - `id` (UUID)
   - `org_id` (from user context)
   - `project_id` (from user context)
   - `mode` (AUDIO_ONLY, etc.)
   - `status` = 'UPLOADED'
   - `progress_json` = { stage: 'UPLOADED', pct: 0 }
3. Returns `{ jobId: string }`

**Database Tables:**
- `public.ingestion_jobs` - Job metadata and status

---

### Step 3: Get Upload Metadata

**API Endpoint:** `POST /api/ingest/jobs/:jobId/upload-metadata`

**File:** `packages/tcl-core/src/server/ingest/jobs.ts`

**Function:** Upload metadata handler

**Request Body:**
```json
{
  "kind": "audio" | "transcript",
  "filename": "example.wav"
}
```

**What happens:**
1. Validates user authentication
2. Verifies job exists and belongs to user's org
3. Generates:
   - `assetId` (UUID)
   - `bucket` (`protectqa-audio` or `protectqa-transcripts`)
   - `objectPath` (`org/{orgId}/conv/{jobId}/{kind}/{assetId}.{ext}`)
4. Returns metadata:
   ```json
   {
     "bucket": "protectqa-audio",
     "objectPath": "org/50205719-068c-4897-bbe2-6f704512d8d4/conv/.../audio/...wav",
     "assetId": "207f4760-5b37-4241-a7ae-a059d8e35cd2",
     "supabaseUrl": "https://uqwcmkyaskyduxuluqrm.supabase.co"
   }
   ```

**Frontend Service:**
- `packages/tcl-ui/src/app/audit.service.ts`
- `getUploadMetadata(jobId, kind, filename)`

---

### Step 4: Direct Upload to Supabase Storage

**File:** `packages/tcl-ui/src/app/ingestion/ingestion.component.ts`

**Function:** `uploadFileDirectly()` → `uploadFileDirectStorage()`

**What happens:**
1. Gets authenticated Supabase client from `AuthService`
2. Gets user's session token
3. Converts Supabase URL to direct storage hostname:
   - `https://project.supabase.co` → `https://project.storage.supabase.co`
4. Uploads file directly using `fetch()`:
   ```typescript
   const uploadUrl = `${storageUrl}/storage/v1/object/${bucket}/${encodedPath}`;
   await fetch(uploadUrl, {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${session.access_token}`,
       'Content-Type': file.type,
       'Content-Length': file.size.toString(),
       'x-upsert': 'false',
     },
     body: file, // File object (streamed by browser)
   });
   ```

**Security:**
- Uses user's authenticated session token (Bearer token)
- RLS policies apply (enforced by Supabase)
- Only authenticated users can upload
- Files are stored in org-specific folders

**Storage Location:**
- Bucket: `protectqa-audio` or `protectqa-transcripts`
- Path: `org/{orgId}/conv/{jobId}/{kind}/{assetId}.{ext}`

**RLS Policies:**
- File: `supabase/sql/026_storage_rls_policies.sql`
- Ensures users can only upload to their org's folders
- Uses `public.check_org_access()` function to verify org membership

**Timeout:**
- 10-minute timeout to prevent hanging uploads
- Uses `AbortController` for cancellation

---

### Step 5: Compute SHA-256 Hash

**File:** `packages/tcl-ui/src/app/ingestion/ingestion.component.ts`

**Function:** `computeFileHash(file: File)`

**What happens:**
1. Reads file as `ArrayBuffer`
2. Computes SHA-256 hash using browser's `crypto.subtle.digest()`
3. Returns hex string (64 characters)

**Code:**
```typescript
const arrayBuffer = await file.arrayBuffer();
const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
const hashArray = Array.from(new Uint8Array(hashBuffer));
const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
```

**Purpose:**
- File integrity verification
- Deduplication (if needed in future)
- Stored in `assets.content_hash` column

---

### Step 6: Finalize Upload

**API Endpoint:** `POST /api/ingest/jobs/:jobId/finalize-upload`

**File:** `packages/tcl-core/src/server/ingest/jobs.ts`

**Function:** Finalize upload handler

**Request Body:**
```json
{
  "assetId": "207f4760-5b37-4241-a7ae-a059d8e35cd2",
  "bucket": "protectqa-audio",
  "objectPath": "org/.../audio/...wav",
  "filename": "example.wav",
  "sizeBytes": 12345678,
  "sha256": "abc123...",
  "kind": "audio"
}
```

**What happens:**
1. Validates user authentication
2. Verifies job exists and belongs to user's org
3. Verifies file exists in Supabase Storage
4. Creates asset record in `public.assets` table:
   ```sql
   INSERT INTO public.assets (
     org_id,
     job_id,
     uploader_user_id,
     type,              -- 'AUDIO' or 'TRANSCRIPT_UPLOADED'
     kind,              -- 'audio' or 'transcript'
     bucket,
     object_path,
     storage_url,       -- Legacy: bucket/path
     content_hash,      -- SHA-256
     size_bytes,
     mime_type,
     metadata_json
   ) VALUES (...)
   ```
5. Updates `ingestion_jobs` table:
   - Sets `audio_asset_id` or `transcript_asset_id`
6. Checks if all required files are uploaded:
   - `TRANSCRIPT_ONLY` → needs transcript
   - `AUDIO_ONLY` → needs audio
   - `AUDIO_PLUS_TRANSCRIPT` → needs both
7. If all files uploaded:
   - Updates job status:
     - `TRANSCRIPT_ONLY` → `ANALYZING`
     - `AUDIO_ONLY` → `TRANSCRIBING`
     - `AUDIO_PLUS_TRANSCRIPT` → `VERIFYING`
   - Enqueues job for background processing

**Database Tables:**
- `public.assets` - Asset metadata and storage pointers
- `public.ingestion_jobs` - Job status and asset references

**Frontend Service:**
- `packages/tcl-ui/src/app/audit.service.ts`
- `finalizeUpload(jobId, assetId, bucket, objectPath, filename, sizeBytes, sha256, kind)`

---

### Step 7: Job Status Polling

**File:** `packages/tcl-ui/src/app/ingestion/ingestion.component.ts`

**Function:** `startJobPolling()` → `pollJobStatus()`

**What happens:**
1. Polls `/api/ingest/jobs/:jobId/status` every 2 seconds
2. Updates UI with:
   - Job status (`UPLOADED`, `TRANSCRIBING`, `ANALYZING`, `COMPLETE`, `FAILED`)
   - Progress percentage
   - Current stage
3. On `COMPLETE`:
   - Stops polling
   - Navigates to evaluation results page
4. On `FAILED`:
   - Stops polling
   - Shows error message

---

### Step 8: Background Worker Processing

**File:** `packages/tcl-core/src/server/ingest/worker.ts`

**What happens:**
1. Worker picks up job from queue
2. Downloads file from Supabase Storage:
   - Uses `downloadFileFromSupabase(bucket, objectPath)`
   - Reads file content into memory (for processing)
3. Processes job based on mode:
   - `AUDIO_ONLY` → Transcribes audio
   - `TRANSCRIPT_ONLY` → Analyzes transcript
   - `AUDIO_PLUS_TRANSCRIPT` → Verifies transcript against audio
4. Updates job status and progress
5. Creates analysis run and evaluation records

**Storage Functions:**
- `packages/tcl-core/src/server/ingest/storage-supabase.ts`
- `downloadFileFromSupabase(bucket, objectPath)` - Downloads file content
- `createSignedUrl(bucket, objectPath, expiresIn)` - Generates temporary download URLs

---

## File Structure

### Frontend Files

1. **`packages/tcl-ui/src/app/ingestion/ingestion.component.ts`**
   - `onSubmit()` - Main upload orchestration
   - `uploadFileDirectly()` - Upload coordination
   - `uploadFileDirectStorage()` - Direct Supabase Storage upload
   - `computeFileHash()` - SHA-256 computation
   - `startJobPolling()` - Status polling

2. **`packages/tcl-ui/src/app/audit.service.ts`**
   - `createIngestionJob()` - Create job API call
   - `getUploadMetadata()` - Get upload metadata API call
   - `finalizeUpload()` - Finalize upload API call
   - `getJobStatus()` - Get job status API call

3. **`packages/tcl-ui/src/app/auth.service.ts`**
   - Provides authenticated Supabase client
   - Manages user session tokens

### Backend Files

1. **`packages/tcl-core/src/server/ingest/jobs.ts`**
   - `POST /api/ingest/jobs` - Create job
   - `POST /api/ingest/jobs/:jobId/upload-metadata` - Get upload metadata
   - `POST /api/ingest/jobs/:jobId/finalize-upload` - Finalize upload
   - `GET /api/ingest/jobs/:jobId/status` - Get job status
   - `POST /api/ingest/jobs/:jobId/upload` - Fallback proxy upload (for RLS failures)

2. **`packages/tcl-core/src/server/ingest/storage-supabase.ts`**
   - `uploadFileToSupabase()` - Server-side upload (for proxy fallback)
   - `downloadFileFromSupabase()` - Download file from storage
   - `createSignedUrl()` - Generate signed URLs
   - `storeUploadedAsset()` - Server-side asset storage (legacy)

3. **`packages/tcl-core/src/server/ingest/worker.ts`**
   - Background job processing
   - Downloads files from storage
   - Processes audio/transcripts

### Database Migrations

1. **`supabase/sql/024_assets_supabase_storage.sql`**
   - Creates `public.assets` table
   - Adds `audio_asset_id` and `transcript_asset_id` to `ingestion_jobs`

2. **`supabase/sql/026_storage_rls_policies.sql`**
   - Creates RLS policies for Supabase Storage buckets
   - `public.check_org_access()` helper function
   - Policies for `INSERT`, `SELECT`, `UPDATE` on storage objects

---

## API Endpoints Summary

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/ingest/jobs` | POST | Create ingestion job | Required |
| `/api/ingest/jobs/:jobId/upload-metadata` | POST | Get upload metadata | Required |
| `/api/ingest/jobs/:jobId/finalize-upload` | POST | Create asset record | Required |
| `/api/ingest/jobs/:jobId/status` | GET | Get job status | Required |
| `/api/ingest/jobs/:jobId/upload` | POST | Fallback proxy upload | Required |
| `https://project.storage.supabase.co/storage/v1/object/:bucket/:path` | POST | Direct storage upload | Bearer token |

---

## Database Schema

### `public.ingestion_jobs`
```sql
CREATE TABLE public.ingestion_jobs (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  project_id UUID,
  mode TEXT NOT NULL,  -- 'AUDIO_ONLY', 'TRANSCRIPT_ONLY', 'AUDIO_PLUS_TRANSCRIPT'
  status TEXT NOT NULL,  -- 'UPLOADED', 'TRANSCRIBING', 'ANALYZING', 'COMPLETE', 'FAILED'
  audio_asset_id UUID REFERENCES public.assets(id),
  transcript_asset_id UUID REFERENCES public.assets(id),
  progress_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `public.assets`
```sql
CREATE TABLE public.assets (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  project_id UUID,
  job_id UUID,
  uploader_user_id UUID,
  type TEXT NOT NULL,  -- 'AUDIO', 'TRANSCRIPT_UPLOADED', etc.
  kind TEXT NOT NULL,  -- 'audio', 'transcript', 'evidence', 'export'
  bucket TEXT NOT NULL,
  object_path TEXT NOT NULL,
  storage_url TEXT,  -- Legacy: bucket/path
  content_hash TEXT,  -- SHA-256
  size_bytes BIGINT,
  mime_type TEXT,
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bucket, object_path)
);
```

---

## Security Features

1. **Authentication:**
   - All API endpoints require authenticated user
   - Uses JWT Bearer tokens from Supabase Auth

2. **Authorization:**
   - Users can only access jobs in their organization
   - RLS policies enforce org-level access control

3. **Storage Security:**
   - Files stored in private Supabase Storage buckets
   - RLS policies on storage objects
   - Files organized by org ID in path structure
   - Only authenticated users can upload/download

4. **File Integrity:**
   - SHA-256 hash computed and stored
   - Can be used for verification

---

## Error Handling

### Frontend Errors

1. **Upload timeout:**
   - 10-minute timeout for large files
   - Falls back to proxy method if direct upload fails

2. **RLS policy violation:**
   - Detects 403 errors
   - Automatically falls back to proxy upload method

3. **Network errors:**
   - Logged to console
   - User sees error message in UI

### Backend Errors

1. **Database errors:**
   - Returns specific error codes (e.g., `DATABASE_ERROR`, `DATABASE_MIGRATION_REQUIRED`)
   - Includes error details in response

2. **Storage errors:**
   - Returns specific error codes (e.g., `STORAGE_UPLOAD_FAILED`, `STORAGE_AUTH_FAILED`)
   - Includes bucket and path in error message

3. **Validation errors:**
   - Returns 400 with specific field errors
   - Includes helpful error messages

---

## Performance Optimizations

1. **Direct Storage Hostname:**
   - Uses `project.storage.supabase.co` instead of `project.supabase.co`
   - Bypasses API gateway overhead
   - Faster uploads for all file sizes

2. **Streaming Uploads:**
   - Browser streams file directly to Supabase
   - No intermediate buffering
   - Supports large files (tested up to 500MB)

3. **Parallel Uploads:**
   - Audio and transcript uploads can happen in parallel
   - Each file has independent upload flow

4. **Efficient Hashing:**
   - SHA-256 computed in browser using Web Crypto API
   - No server-side hash computation needed

---

## Fallback Mechanism

If direct Supabase Storage upload fails (e.g., RLS policy issues), the system automatically falls back to:

1. **Proxy Upload Method:**
   - File uploaded via `/api/ingest/jobs/:jobId/upload`
   - Backend receives file via multipart/form-data
   - Backend uploads to Supabase Storage using service role key
   - Same final result, but slower (goes through Netlify/backend)

**Limitation:**
- Netlify has 6MB payload limit
- Large files will fail with proxy method
- Direct upload is preferred for all files

---

## Testing Checklist

- [ ] Small file upload (< 6MB)
- [ ] Large file upload (> 6MB)
- [ ] Audio-only mode
- [ ] Transcript-only mode
- [ ] Audio + transcript mode
- [ ] Upload timeout handling
- [ ] RLS policy enforcement
- [ ] Error handling and fallback
- [ ] Job status polling
- [ ] Background worker processing

---

## Troubleshooting

### Upload hangs at "Uploading to Supabase Storage..."

**Possible causes:**
1. Network connectivity issues
2. RLS policies blocking upload
3. File too large (timeout)

**Solutions:**
1. Check browser console for errors
2. Check Network tab for pending requests
3. Verify RLS policies are applied
4. Check Supabase Storage dashboard for file

### 403 "new row violates row-level security policy"

**Cause:** RLS policies not configured or incorrect

**Solution:**
1. Run migration `026_storage_rls_policies.sql`
2. Verify `public.check_org_access()` function exists
3. Check user is member of org in `org_members` table

### File not appearing in Supabase Storage

**Possible causes:**
1. Upload failed silently
2. Wrong bucket/path
3. RLS policy blocking

**Solutions:**
1. Check browser console logs
2. Check Network tab for upload request status
3. Verify bucket exists in Supabase dashboard
4. Check RLS policies allow uploads

---

## Future Improvements

1. **Resumable Uploads:**
   - Implement TUS protocol for very large files
   - Allow resume after network interruption

2. **Progress Tracking:**
   - Show upload progress percentage
   - Display upload speed

3. **Chunked Uploads:**
   - Split large files into chunks
   - Upload chunks in parallel
   - Reassemble on server

4. **Compression:**
   - Compress files before upload
   - Reduce upload time and storage costs

