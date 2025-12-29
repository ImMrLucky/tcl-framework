# Supabase Migration Guide

## Current Status

You need to run **2 new SQL migrations** on your Supabase database to enable the enterprise trial features.

## Migration Files

1. **`supabase/sql/003_enterprise_trial.sql`** - Creates new tables and updates `api_keys`
2. **`supabase/sql/004_enterprise_rls.sql`** - Adds RLS policies for new tables

## How to Run Migrations

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project: https://supabase.com/dashboard/project/uqwcmkyaskyduxuluqrm
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy and paste the contents of `supabase/sql/003_enterprise_trial.sql`
5. Click **Run** (or press Cmd/Ctrl + Enter)
6. Verify no errors
7. Repeat for `supabase/sql/004_enterprise_rls.sql`

### Option 2: Supabase CLI

```bash
# If you have Supabase CLI installed
supabase db push
```

## What Gets Created

### New Tables
- `projects` - Logical grouping inside orgs
- `project_envs` - Sandbox/production environments
- `conversations` - Call transcripts
- `evaluations` - Validation results (replaces `validations` table)
- `usage_daily` - Daily usage tracking

### Updated Tables
- `api_keys` - Adds `project_id` and `env` columns

### Helper Functions
- `ensure_default_project()` - Auto-creates default project for new orgs
- `increment_usage()` - Increments usage counters

### RLS Policies
- Policies for all new tables enforcing tenant isolation

## Verification

After running migrations, verify in Supabase Dashboard:

1. **Table Editor** → Check that new tables exist:
   - `projects`
   - `project_envs`
   - `conversations`
   - `evaluations`
   - `usage_daily`

2. **SQL Editor** → Run this query to verify `api_keys` was updated:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'api_keys';
   ```
   Should show `project_id` and `env` columns.

3. **Authentication** → Test that existing users can still sign in

## Rollback (If Needed)

If you need to rollback, you can drop the new tables:

```sql
-- WARNING: This will delete all data in these tables
DROP TABLE IF EXISTS public.usage_daily CASCADE;
DROP TABLE IF EXISTS public.evaluations CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.project_envs CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;

-- Remove columns from api_keys
ALTER TABLE public.api_keys 
DROP COLUMN IF EXISTS project_id,
DROP COLUMN IF EXISTS env;

-- Drop functions
DROP FUNCTION IF EXISTS public.ensure_default_project(uuid, uuid);
DROP FUNCTION IF EXISTS public.increment_usage(uuid, uuid, text, date, text);
```

## Important Notes

1. **Existing Data**: The migrations are designed to be non-destructive:
   - Existing `api_keys` will get `project_id = NULL` and `env = 'sandbox'`
   - Existing `validations` table is NOT modified (still exists for backward compatibility)
   - New `evaluations` table is separate

2. **Default Projects**: When users are provisioned (via `/auth/provision`), a default project is automatically created.

3. **RLS Policies**: All new tables have RLS enabled, so users can only see their org's data.

## Next Steps After Migration

1. Test the `/auth/provision` endpoint to create a default project
2. Test creating an API key with project/env scoping
3. Test the `/validate` endpoint to verify usage tracking works
4. Check `usage_daily` table to see usage being tracked

