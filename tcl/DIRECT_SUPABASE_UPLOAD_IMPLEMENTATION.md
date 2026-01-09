# Direct Supabase Upload Implementation

## Overview

Implemented Option 2: Direct Supabase Storage uploads to bypass Netlify's 6MB limit for large audio files.

## Architecture

### New Flow (Direct Upload)
```
Browser → Request upload metadata → TCL Core
Browser → Upload directly to Supabase Storage (bypasses Netlify)
Browser → Finalize upload → TCL Core (creates asset record, updates job)
```

### Fallback Flow (If RLS blocks)
```
Browser → Upload via Netlify Proxy → TCL Core → Supabase Storage
(Only for files < 6MB or when RLS policies aren't configured)
```

## Backend Changes

### New Endpoints

1. **`POST /api/ingest/jobs/:jobId/upload-metadata`**
   - Returns: `{ bucket, objectPath, assetId, supabaseUrl }`
   - Generates unique object path: `org/{orgId}/conv/{conversationId}/{kind}/{assetId}.{ext}`
   - Frontend uses this to upload directly to Supabase

2. **`POST /api/ingest/jobs/:jobId/finalize-upload`**
   - Called after successful Supabase upload
   - Creates asset record in database
   - Updates job with `audio_asset_id` or `transcript_asset_id`
   - Updates job status and enqueues processing when all files are uploaded

### Database Migration

**`024_assets_supabase_storage.sql`** - Adds:
- `bucket`, `object_path`, `size_bytes`, `kind` columns to `assets` table
- `audio_asset_id`, `transcript_asset_id` columns to `ingestion_jobs` table

## Frontend Changes

### New Methods in `AuditService`

1. **`getUploadMetadata()`** - Gets upload path and bucket info
2. **`finalizeUpload()`** - Notifies backend after upload completes

### Updated `IngestionComponent`

- **`uploadFileDirectly()`** - New method that:
  1. Gets upload metadata from backend
  2. Uploads file directly to Supabase Storage using authenticated client
  3. Computes SHA-256 hash
  4. Finalizes upload with backend

- **`computeFileHash()`** - Computes SHA-256 in browser using Web Crypto API

## Storage Policies Required

For direct uploads to work, you need to configure Storage RLS policies in Supabase Dashboard:

**Location**: Storage → [Bucket Name] → Policies → New Policy

**Policy for INSERT (Upload)**:
- Policy Type: INSERT
- Target Roles: `authenticated`
- USING Expression:
```sql
bucket_id = 'protectqa-audio' -- or 'protectqa-transcripts'
AND (storage.foldername(name))[1] = 'org'
AND (storage.foldername(name))[2] IN (
  SELECT org_id::text FROM public.org_members WHERE user_id = auth.uid()
)
```

**Policy for SELECT (Read)**:
- Policy Type: SELECT
- Target Roles: `authenticated`
- USING Expression: (same as above)

**Note**: If policies aren't configured, the frontend will automatically fall back to the proxy method (which has the 6MB limit).

## How It Works

1. **User uploads file** → Frontend calls `getUploadMetadata()`
2. **Backend generates path** → Returns `bucket`, `objectPath`, `assetId`
3. **Frontend uploads directly** → Uses Supabase client to upload to Storage
4. **Frontend computes hash** → SHA-256 of file content
5. **Frontend finalizes** → Calls `finalizeUpload()` with metadata
6. **Backend creates record** → Inserts into `assets` table, updates job
7. **Job processing starts** → When all files uploaded, job status updated and enqueued

## Benefits

✅ **No Netlify 6MB limit** - Files upload directly to Supabase  
✅ **No RAM buffering** - Files stream from browser to Supabase  
✅ **Automatic fallback** - If RLS blocks, falls back to proxy  
✅ **Production-ready** - Proper error handling and logging  

## Testing

1. **Test direct upload** (when RLS policies are configured):
   - Upload a large .wav file (> 6MB)
   - Should upload directly to Supabase, bypassing Netlify

2. **Test fallback** (when RLS policies aren't configured):
   - Upload a file
   - Should fall back to proxy method
   - Will fail if file > 6MB (Netlify limit)

3. **Verify in Supabase**:
   - Check Storage buckets for uploaded files
   - Check `assets` table for records
   - Check `ingestion_jobs` table for `audio_asset_id`/`transcript_asset_id`

## Next Steps

1. **Configure Storage RLS policies** in Supabase Dashboard (see `025_storage_upload_policies.sql`)
2. **Test with large files** (> 6MB) to verify direct upload works
3. **Monitor logs** to see which path is being used (direct vs proxy)

