# Provisioning Issue - Status & Fixes

## Issues Identified

1. **Foreign Key Constraint Errors**: `org_members` insert was failing because user wasn't in `auth.users` yet
2. **Organization Name**: Had "org" suffix appended (e.g., "email@example.com org")
3. **Provision Failing**: Even when org/profile were created, provision endpoint returned error
4. **Duplicate Signups**: Allowed multiple signups with same email

## Fixes Applied

### 1. Code Fixes (✅ Completed)

**File: `packages/tcl-core/src/server/supabase.ts`**
- ✅ Removed "org" suffix from organization name (line 182: `const orgName = email;`)
- ✅ Added retry logic with exponential backoff for user verification (10 retries, up to 2 seconds)
- ✅ Added 500ms wait after user verification to ensure user is committed
- ✅ Step 4 (org_members) no longer returns `null` on error - continues to Step 5
- ✅ Step 4 checks if user is already a member before failing
- ✅ Step 5 returns `orgId` even if project creation fails
- ✅ Error handling returns partial success if org exists

**File: `packages/tcl-core/src/server/express.ts`**
- ✅ `/auth/provision` endpoint checks for existing orgs if provision fails
- ✅ Returns partial success with `orgId` if org exists (even if member not added)
- ✅ Checks both `org_members` and `organizations` table for existing orgs

### 2. Database Fixes (⚠️ Requires Migration)

**File: `supabase/sql/005_fix_provision_issues.sql`**
- ✅ Creates trigger to auto-create profile when user signs up
- ✅ Makes `profiles_id_fkey` deferrable (checks constraint at end of transaction)
- ✅ Makes `org_members_user_id_fkey` deferrable (checks constraint at end of transaction)
- ✅ Creates profiles for existing users who don't have one

**Status**: ⚠️ **MUST BE RUN IN SUPABASE** - This is the root cause fix

### 3. Verification Script

**File: `supabase/sql/006_verify_and_fix_foreign_keys.sql`**
- Script to verify foreign keys are deferrable
- Automatically fixes them if not

## Current Behavior

### If Foreign Keys Are Deferrable (After Running Migration):
1. User signs up → Profile auto-created by trigger
2. Provision called → Creates org, adds member, creates project
3. ✅ Should work smoothly

### If Foreign Keys Are NOT Deferrable (Current State):
1. User signs up → Profile may or may not be created
2. Provision called → May fail at Step 4 (org_members insert)
3. ⚠️ **BUT**: Code now continues and returns `orgId` anyway
4. User can still use the app, but may not be in `org_members` table

## What You Need To Do

### Critical: Run Database Migration

```sql
-- In Supabase SQL Editor, run:
\i supabase/sql/005_fix_provision_issues.sql
```

Or copy/paste the contents of `supabase/sql/005_fix_provision_issues.sql` into Supabase SQL Editor.

### Verify Foreign Keys Are Deferrable

```sql
-- Run this to check:
SELECT 
  conname as constraint_name,
  condeferrable as is_deferrable,
  condeferred as is_deferred
FROM pg_constraint 
WHERE conname IN ('profiles_id_fkey', 'org_members_user_id_fkey')
ORDER BY conname;
```

**Expected Result**: Both should show `is_deferrable = true` and `is_deferred = true`

## Remaining Issues

### 1. Duplicate Email Signups
**Status**: ⚠️ Not fixed in code
**Solution**: 
- Enable "Confirm email" in Supabase Dashboard → Authentication → Settings
- OR handle duplicates in frontend by checking if user exists before signup

### 2. User Not in org_members
**Status**: ⚠️ Partial fix - code continues but doesn't guarantee member is added
**Solution**: 
- Run `005_fix_provision_issues.sql` to make foreign keys deferrable
- This will allow Step 4 to succeed reliably

## Testing

After running the migration, test:
1. Sign up with a new email
2. Check Supabase:
   - `auth.users` - user exists ✅
   - `public.profiles` - profile exists ✅
   - `public.organizations` - org exists ✅
   - `public.org_members` - member exists ✅
   - `public.projects` - project exists ✅

## Summary

✅ **Code fixes**: Complete - provision now handles partial failures gracefully
⚠️ **Database migration**: **MUST BE RUN** - This is the root cause fix
✅ **Error handling**: Improved - returns partial success when possible
⚠️ **Duplicate signups**: Not fixed - requires Supabase config or frontend handling

**Next Step**: Run `supabase/sql/005_fix_provision_issues.sql` in Supabase SQL Editor

