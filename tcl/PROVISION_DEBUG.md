# Provision Debugging Guide

## What Should Happen During Provision

1. **Step 1**: Ensure profile exists in `public.profiles`
2. **Step 2**: Check if user has existing org memberships
3. **Step 3**: If no org, create new organization (name = email, slug = email prefix + random)
4. **Step 4**: Add user to `org_members` as owner (this is where foreign key errors occur)
5. **Step 5**: Ensure default project exists via RPC `ensure_default_project`

## Common Issues

### Issue 1: Organization Name Has "org" Suffix
**Fixed**: Changed `orgName = ${email} org` to `orgName = ${email}`

### Issue 2: Duplicate Email Signups
**Cause**: Supabase Auth allows duplicate emails if:
- Email confirmation is disabled
- User signs up with unconfirmed account
- Multiple signups before first is confirmed

**Solution**: Check Supabase Dashboard → Authentication → Settings:
- Enable "Confirm email" if you want to prevent duplicates
- Or handle duplicates in the frontend by checking if user already exists

### Issue 3: Provision Failing
**Possible causes**:
1. **Step 4 fails** (org_members insert): Foreign key constraint not deferrable
   - **Solution**: Run `supabase/sql/005_fix_provision_issues.sql`
   
2. **Step 5 fails** (project creation): RPC function doesn't exist
   - **Solution**: Run `supabase/sql/003_enterprise_trial.sql` or `combined_migration.sql`

3. **User doesn't exist in auth.users**: Timing issue
   - **Solution**: Code now continues even if user verification fails

## Debugging Steps

1. **Check Railway logs** for detailed step-by-step output
2. **Check Supabase Dashboard**:
   - `auth.users` - verify user exists
   - `public.profiles` - verify profile exists
   - `public.organizations` - verify org exists
   - `public.org_members` - verify membership exists
   - `public.projects` - verify project exists

3. **Verify foreign keys are deferrable**:
   ```sql
   SELECT 
     conname as constraint_name,
     condeferrable as is_deferrable,
     condeferred as is_deferred
   FROM pg_constraint 
   WHERE conname IN ('profiles_id_fkey', 'org_members_user_id_fkey')
   ORDER BY conname;
   ```

4. **Check if RPC function exists**:
   ```sql
   SELECT proname, prosrc 
   FROM pg_proc 
   WHERE proname = 'ensure_default_project';
   ```

## Current Behavior

- **Organization name**: Now uses email directly (no "org" suffix)
- **Partial success**: Returns `orgId` even if Step 4 or 5 fails
- **Error handling**: Checks for existing orgs by email if `org_members` query fails
- **User verification**: Continues even if user not found in auth.users (with warning)

