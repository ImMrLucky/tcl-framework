# Provision User Troubleshooting

## Problem
Getting `{"error":"Failed to provision user"}` when signing up.

## Solution: Check Railway Logs

The provision function now has detailed logging. Check your Railway logs to see which step is failing:

1. Go to [Railway Dashboard](https://railway.app)
2. Click on your **TCL Core** service
3. Click on the **Logs** tab
4. Look for lines starting with "Step 1:", "Step 2:", etc.

## Common Issues

### Step 1: Profile Creation Fails

**Error**: `Step 1 FAILED: Failed to ensure profile`

**Cause**: `profiles` table doesn't exist or has wrong schema

**Fix**: Run the database migrations:
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **SQL Editor**
4. Run `supabase/sql/001_init.sql` (creates `profiles` table)

### Step 2: Checking Memberships Fails

**Error**: `Step 2 FAILED: Failed to check memberships`

**Cause**: `org_members` table doesn't exist

**Fix**: Run `supabase/sql/001_init.sql` (creates `org_members` table)

### Step 3: Creating Organization Fails

**Error**: `Step 3 FAILED: Failed to create org`

**Possible causes**:
- `organizations` table doesn't exist → Run `001_init.sql`
- Slug already exists (unlikely for new users)
- Missing required columns

**Fix**: Check the error message in logs for specific details

### Step 4: Adding User as Owner Fails

**Error**: `Step 4 FAILED: Failed to add user as owner`

**Possible causes**:
- Foreign key constraint (org doesn't exist)
- Duplicate entry (user already owner)
- Missing `role` column

**Fix**: Check the error message in logs

### Step 5: Creating Project Fails

**Error**: `Step 5 FAILED: RPC call failed`

**Most Common Issue**: The `ensure_default_project` function doesn't exist

**Fix**: Run the database migration:
1. Go to Supabase Dashboard → SQL Editor
2. Run `supabase/sql/003_enterprise_trial.sql`
   - This creates the `ensure_default_project` function
   - Also creates `projects` and `project_envs` tables

**Alternative**: If the function exists but fails, check:
- `projects` table exists
- `project_envs` table exists
- Function has correct parameters

## Quick Fix Checklist

1. ✅ **Supabase environment variables set in Railway**
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. ✅ **Database migrations run**
   - `001_init.sql` - Creates profiles, organizations, org_members
   - `002_rls.sql` - Enables Row Level Security
   - `003_enterprise_trial.sql` - Creates projects, project_envs, and `ensure_default_project` function

3. ✅ **Check Railway logs** for specific error messages

## Verify Migrations

To check if migrations were run:

1. Go to Supabase Dashboard → Table Editor
2. Check if these tables exist:
   - `profiles`
   - `organizations`
   - `org_members`
   - `projects`
   - `project_envs`

3. Check if function exists:
   - Go to Supabase Dashboard → Database → Functions
   - Look for `ensure_default_project`

## Test Provision Manually

You can test the provision function directly:

```sql
-- In Supabase SQL Editor
SELECT ensure_default_project(
  'your-org-id-here'::uuid,
  'your-user-id-here'::uuid
);
```

If this fails, the function has an issue. Check the error message.

## Still Not Working?

1. **Check Railway logs** - Look for the specific "Step X FAILED" message
2. **Check Supabase logs** - Go to Supabase Dashboard → Logs → Postgres Logs
3. **Verify tables exist** - Use Table Editor to confirm all tables are present
4. **Verify function exists** - Check Database → Functions

Share the specific error from Railway logs for more help!

