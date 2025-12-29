# Check Provision Status - Debugging Guide

## Step 1: Check Railway Logs

Go to Railway Dashboard → TCL Core service → Logs and look for:

1. **Provision request received:**
   ```
   Provision request for user: [user-id] ([email])
   ```

2. **Step-by-step progress:**
   ```
   Step 1: Ensuring profile exists...
   Step 2: Checking existing org memberships...
   Step 3: Creating new organization...
   Step 4: Adding user as org owner...
   Step 5: Ensuring default project exists...
   ```

3. **Any FAILED messages:**
   ```
   Step X FAILED: [error message]
   ```

## Step 2: Check Database Migrations

### Verify Trigger Exists

Run this in Supabase SQL Editor:

```sql
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

**Expected**: Should return 1 row

**If empty**: Run `supabase/sql/004_auto_profile_trigger.sql`

### Verify Function Exists

```sql
SELECT * FROM pg_proc WHERE proname = 'handle_new_user';
```

**Expected**: Should return 1 row

### Verify Foreign Keys Are Deferrable

```sql
SELECT 
  conname, 
  condeferrable, 
  condeferred 
FROM pg_constraint 
WHERE conname IN ('profiles_id_fkey', 'org_members_user_id_fkey');
```

**Expected**: Both should have `condeferrable = true` and `condeferred = true`

**If not**: Run `supabase/sql/005_fix_provision_issues.sql`

## Step 3: Check User in Database

### Check if user exists in auth.users

```sql
SELECT id, email, created_at 
FROM auth.users 
WHERE id = 'your-user-id-here';
```

**Expected**: Should return 1 row with the user

**If empty**: The user wasn't created in Supabase Auth (check frontend signup)

### Check if profile exists

```sql
SELECT * FROM public.profiles WHERE id = 'your-user-id-here';
```

**Expected**: Should return 1 row

**If empty**: Profile wasn't created (check trigger or provision function)

### Check if org exists

```sql
SELECT o.*, om.role 
FROM public.organizations o
JOIN public.org_members om ON om.org_id = o.id
WHERE om.user_id = 'your-user-id-here';
```

**Expected**: Should return at least 1 row

## Step 4: Test Trigger Manually

Test if the trigger works by checking if it creates profiles for new users:

1. Create a test user in Supabase Auth Dashboard
2. Check if profile was created automatically:

```sql
SELECT * FROM public.profiles WHERE id = 'test-user-id';
```

**Expected**: Profile should exist automatically

**If not**: The trigger isn't working - check trigger setup

## Step 5: Common Issues & Fixes

### Issue: "Step 1 FAILED: Foreign key constraint"

**Fix**: 
1. Run `005_fix_provision_issues.sql` to make foreign keys deferrable
2. Verify trigger exists (Step 2 above)
3. Check if user exists in auth.users (Step 3 above)

### Issue: "Step 4 FAILED: Foreign key constraint"

**Fix**: Same as above - user might not be in auth.users yet

### Issue: "Step 5 FAILED: RPC call failed"

**Fix**: 
1. Check if `ensure_default_project` function exists:
   ```sql
   SELECT * FROM pg_proc WHERE proname = 'ensure_default_project';
   ```
2. If missing, run `003_enterprise_trial.sql`

### Issue: User exists but profile doesn't

**Fix**: 
1. Check trigger exists (Step 2)
2. Manually create profile:
   ```sql
   INSERT INTO public.profiles (id, email)
   SELECT id, email FROM auth.users WHERE id = 'user-id'
   ON CONFLICT (id) DO NOTHING;
   ```

## Step 6: Enable Detailed Logging

The provision function now has detailed logging. Check Railway logs for:
- Which step fails
- Error codes and messages
- Retry attempts

## Quick Fix Script

Run this in Supabase SQL Editor to fix common issues:

```sql
-- 1. Create trigger if missing
-- (Copy contents of 004_auto_profile_trigger.sql)

-- 2. Make foreign keys deferrable
-- (Copy contents of 005_fix_provision_issues.sql)

-- 3. Create profiles for existing users
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT id, email, created_at, now()
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;
```

## Still Not Working?

1. **Share Railway logs** - Copy the specific error messages
2. **Share Supabase query results** - Run the checks above and share results
3. **Check Supabase logs** - Go to Dashboard → Logs → Postgres Logs

