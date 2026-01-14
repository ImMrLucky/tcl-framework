# Database and Storage Cleanup Scripts

This directory contains scripts to completely clean up your database and Supabase Storage buckets for testing purposes.

## ⚠️ WARNING

These scripts will **DELETE ALL DATA** including:
- All evaluations, conversations, and issues
- All ingestion jobs and assets
- All policies and scoring profiles
- All files in Supabase Storage buckets

**Only use these scripts in development/testing environments!**

## Quick Start

### Option 1: Complete Cleanup (Recommended)

Run the all-in-one script that cleans both database and storage:

```bash
cd tcl
chmod +x scripts/cleanup-all.sh
./scripts/cleanup-all.sh
```

This script will:
1. Clean all database tables (preserving users/orgs by default)
2. Clean all storage buckets

### Option 2: Manual Steps

#### Step 1: Clean Database

**Via Supabase SQL Editor:**
1. Open your Supabase Dashboard
2. Go to SQL Editor
3. Copy and paste the contents of `tcl/supabase/sql/999_cleanup_all_data.sql`
4. Run the script

**Via Supabase CLI:**
```bash
supabase db execute -f tcl/supabase/sql/999_cleanup_all_data.sql
```

#### Step 2: Clean Storage Buckets

**Via Supabase Dashboard:**
1. Go to Storage in your Supabase Dashboard
2. For each bucket (`protectqa-audio`, `protectqa-transcripts`, `protectqa-evidence`, `protectqa-exports`):
   - Click on the bucket
   - Select all files
   - Delete them

**Via Node.js Script:**
```bash
# Set environment variables
export SUPABASE_URL="your_supabase_url"
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"

# Run the script
node tcl/scripts/cleanup-storage.js
```

**Via Supabase CLI (if available):**
```bash
# Note: Supabase CLI doesn't have a direct "delete all" command
# You'll need to use the Dashboard or the Node.js script
```

## What Gets Deleted

### Database Tables (from `999_cleanup_all_data.sql`):
- ✅ `issue_actions_log`
- ✅ `issue_comments`
- ✅ `issue_workflow`
- ✅ `issue_policy_links`
- ✅ `policy_sources`
- ✅ `policies`
- ✅ `scoring_profiles`
- ✅ `ingestion_jobs`
- ✅ `assets`
- ✅ `conversation_artifacts`
- ✅ `evaluations`
- ✅ `conversations`
- ✅ `validations`
- ✅ `evidence_artifacts`
- ✅ `evidence_sources`
- ✅ `sources`
- ✅ `delivery_attempts`
- ✅ `realtime_sessions`
- ✅ `webhook_tokens`
- ✅ `webhook_endpoints`
- ✅ `idempotency_keys`
- ✅ `integration_connections`
- ✅ `integrations`
- ✅ `audit_log`
- ✅ `usage_daily`
- ✅ `project_envs`
- ✅ `projects`
- ✅ `api_keys`

### What Gets Preserved (by default):
- ✅ `auth.users` - User accounts
- ✅ `public.profiles` - User profile data
- ✅ `public.organizations` - Organization structure
- ✅ `public.org_members` - User-organization relationships

### Storage Buckets:
- ✅ `protectqa-audio` - All audio files
- ✅ `protectqa-transcripts` - All transcript files
- ✅ `protectqa-evidence` - All evidence files
- ✅ `protectqa-exports` - All export files

## Complete Reset (Delete Everything)

If you want to delete **everything** including users and organizations, edit `999_cleanup_all_data.sql` and uncomment the sections under "STEP 2: Optional - Clear user/organization data".

## Verification

After running the cleanup, verify in Supabase Dashboard:

```sql
-- Check table counts
SELECT COUNT(*) as evaluations FROM public.evaluations;
SELECT COUNT(*) as conversations FROM public.conversations;
SELECT COUNT(*) as assets FROM public.assets;
SELECT COUNT(*) as ingestion_jobs FROM public.ingestion_jobs;
SELECT COUNT(*) as issue_workflow FROM public.issue_workflow;
SELECT COUNT(*) as policies FROM public.policies;
```

All should return `0`.

## Troubleshooting

### "Foreign key constraint violation"
- Make sure you're running the SQL script in the correct order
- The script uses `BEGIN; ... COMMIT;` to ensure atomicity
- If you get errors, check that all dependent tables are deleted first

### Storage cleanup fails
- Make sure you have `SUPABASE_SERVICE_ROLE_KEY` set (not the anon key)
- Check that the bucket names match your Supabase project
- You may need to clean buckets manually via the Dashboard

### "Table does not exist" errors
- Some tables might not exist if migrations haven't been run
- The script uses `DELETE FROM` which will fail if the table doesn't exist
- You can wrap deletions in `IF EXISTS` checks if needed

## Next Steps

After cleanup:
1. ✅ Verify all data is deleted (see verification queries above)
2. ✅ Re-run any necessary migrations if schema changed
3. ✅ Test the application with fresh data
4. ✅ Create new test data as needed

