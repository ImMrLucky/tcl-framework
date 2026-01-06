# Database Migrations Required

## Overview

You need to run **3 new SQL migrations** to enable all the new features we've implemented:

1. **Issue Workflow** (Triage Queue)
2. **Policy Library** (Rulesets + Versioning)
3. **Scoring Profiles** (Admin Risk Scoring Settings)

## Migration Files

### 1. Issue Workflow (`013_issue_workflow.sql`)
**Purpose**: Enables issue triage workflow with status, assignment, comments, and activity log.

**Creates**:
- `issue_workflow` - Tracks issue status and assignment
  - Fields: `issue_id` (text, PK), `org_id`, `status` (OPEN/ACKNOWLEDGED/RESOLVED/FALSE_POSITIVE), `assignee_user_id`, timestamps
- `issue_comments` - Comments on issues
  - Fields: `id` (uuid, PK), `issue_id`, `org_id`, `actor_user_id`, `body`, `created_at`
- `issue_actions_log` - Audit log of all actions
  - Fields: `id` (uuid, PK), `issue_id`, `org_id`, `actor_user_id`, `action_type`, `payload_json`, `created_at`

**RLS**: All org members can view, all members can insert/update (for their own actions)

### 2. Policy Library (`014_policy_library.sql`)
**Purpose**: Enables policy management with versioning and linking to issues.

**Creates**:
- `policies` - Policy documents with versioning
  - Fields: `id` (uuid, PK), `org_id`, `name`, `description`, `status` (draft/active/archived), `version`, `content`, `metadata` (jsonb), timestamps
  - Unique constraint: `(org_id, name, version)`
- `policy_sources` - Links policies to evidence sources
  - Fields: `id` (uuid, PK), `policy_id`, `source_id` (references `sources` table), `section`, `relevance_score`
  - Unique constraint: `(policy_id, source_id)`
- `issue_policy_links` - Links issues to policies
  - Fields: `id` (uuid, PK), `issue_id`, `policy_id`, `link_type` (references/violates/complies), `section`
  - Unique constraint: `(issue_id, policy_id, link_type)`

**RLS**: All org members can view, admins/compliance/qa_reviewer can manage

**Note**: Requires `sources` table (created in `001_init.sql`)

### 3. Scoring Profiles (`015_scoring_profiles.sql`)
**Purpose**: Enables admin-configurable scoring profiles.

**Creates**:
- `scoring_profiles` - Scoring configuration profiles
  - Fields: `id` (uuid, PK), `org_id`, `name`, `description`, `is_active`, `risk_ranking_config` (jsonb), `issue_scoring_config` (jsonb), `config_hash`, `version`, timestamps
  - Unique constraint: `(org_id, name)`

**RLS**: All org members can view, only owners/admins can create/modify/delete

## How to Run Migrations

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**
4. For each migration file:
   - Open the file: `supabase/sql/013_issue_workflow.sql`
   - Copy the entire contents
   - Paste into the SQL Editor
   - Click **Run** (or press Cmd/Ctrl + Enter)
   - Verify no errors appear
5. Repeat for:
   - `supabase/sql/014_policy_library.sql`
   - `supabase/sql/015_scoring_profiles.sql`

### Option 2: Supabase CLI

If you have Supabase CLI installed and linked:

```bash
# Navigate to project root
cd /Users/kassihamilton/tcl-ai/tcl

# Run migrations (if using Supabase CLI migrations)
supabase db push

# OR manually run each file
supabase db execute -f supabase/sql/013_issue_workflow.sql
supabase db execute -f supabase/sql/014_policy_library.sql
supabase db execute -f supabase/sql/015_scoring_profiles.sql
```

### Option 3: psql (Direct Database Connection)

If you have direct database access:

```bash
# Get connection string from Supabase Dashboard → Settings → Database
# Connection string format: postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres

psql "your-connection-string" -f supabase/sql/013_issue_workflow.sql
psql "your-connection-string" -f supabase/sql/014_policy_library.sql
psql "your-connection-string" -f supabase/sql/015_scoring_profiles.sql
```

## Verification

After running all migrations, verify in Supabase Dashboard:

### 1. Check Tables Exist

Go to **Table Editor** and verify these tables exist:
- ✅ `issue_workflow`
- ✅ `issue_comments`
- ✅ `issue_actions_log`
- ✅ `policies`
- ✅ `policy_sources`
- ✅ `issue_policy_links`
- ✅ `scoring_profiles`

### 2. Check RLS Policies

Go to **Authentication** → **Policies** and verify RLS policies exist for:
- `issue_workflow`
- `issue_comments`
- `issue_actions_log`
- `policies`
- `policy_sources`
- `issue_policy_links`
- `scoring_profiles`

### 3. Test Queries

Run these queries in SQL Editor to verify:

```sql
-- Check issue_workflow table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'issue_workflow';

-- Check policies table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'policies';

-- Check scoring_profiles table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'scoring_profiles';

-- Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('issue_workflow', 'policies', 'scoring_profiles');
```

All should return `rowsecurity = true`.

## Migration Order

Run migrations in this order (they are numbered sequentially):

1. ✅ `013_issue_workflow.sql` (first)
2. ✅ `014_policy_library.sql` (second)
3. ✅ `015_scoring_profiles.sql` (third)

## What Each Migration Does

### 013_issue_workflow.sql
- Creates tables for issue triage workflow
- Adds indexes for performance
- Sets up RLS policies (all org members can view, admins can modify)
- Creates triggers for `updated_at` timestamps

### 014_policy_library.sql
- Creates policy management tables
- Supports versioning (unique constraint on org_id + name + version)
- Links policies to evidence sources and issues
- RLS: All org members can view, admins/compliance can manage

### 015_scoring_profiles.sql
- Creates scoring profiles table
- Stores risk ranking and issue scoring configs as JSONB
- Computes and stores config hash for reproducibility
- RLS: All org members can view, only admins/owners can create/modify

## Troubleshooting

### Error: "relation already exists"
If you see this error, the table already exists. The migrations use `CREATE TABLE IF NOT EXISTS`, so this shouldn't happen, but if it does:
- Check if the table exists in Table Editor
- If it exists and has the correct structure, you can skip that migration
- If the structure is wrong, you may need to drop and recreate (⚠️ **WARNING**: This deletes data)

### Error: "function does not exist"
If you see errors about `set_updated_at()` function:
- Check if this function exists: `SELECT * FROM pg_proc WHERE proname = 'set_updated_at';`
- If it doesn't exist, it should be created in earlier migrations (check `004_auto_profile_trigger.sql` or similar)
- You may need to run earlier migrations first

### Error: "permission denied"
- Make sure you're using the service role key or have admin access
- Check that RLS policies are correctly set up
- Verify your user has the correct org role

## Rollback (If Needed)

If you need to rollback these migrations:

```sql
-- WARNING: This will delete all data in these tables

-- Drop scoring profiles
DROP TABLE IF EXISTS public.scoring_profiles CASCADE;

-- Drop policy library
DROP TABLE IF EXISTS public.issue_policy_links CASCADE;
DROP TABLE IF EXISTS public.policy_sources CASCADE;
DROP TABLE IF EXISTS public.policies CASCADE;

-- Drop issue workflow
DROP TABLE IF EXISTS public.issue_actions_log CASCADE;
DROP TABLE IF EXISTS public.issue_comments CASCADE;
DROP TABLE IF EXISTS public.issue_workflow CASCADE;
```

## Next Steps After Migration

1. ✅ Test creating an issue workflow entry via `/api/issues-v2`
2. ✅ Test uploading a policy via `/api/policies`
3. ✅ Test creating a scoring profile via `/api/admin/scoring-profiles`
4. ✅ Verify RLS policies work correctly (users can only see their org's data)

## Important Notes

- **Non-destructive**: All migrations use `IF NOT EXISTS` clauses, so they're safe to run multiple times
- **RLS Enabled**: All tables have Row Level Security enabled by default
- **Indexes**: All tables have appropriate indexes for performance
- **Foreign Keys**: All foreign keys have `ON DELETE CASCADE` or `ON DELETE SET NULL` as appropriate

