# Profile Provisioning Issue

## Problem
User was provisioned successfully:
- ✅ Added to `organizations` table
- ✅ Added to `projects` table  
- ✅ Added to `project_envs` table
- ❌ **NOT added to `profiles` table**

## Expected Flow

### Step 1: User Signs Up
1. Supabase Auth creates user in `auth.users`
2. **Trigger should fire**: `on_auth_user_created` → creates profile in `public.profiles`
3. Frontend calls `/auth/provision`

### Step 2: Provisioning (Backend)
1. **Step 1**: `ensureProfile(userId, email)` is called
   - Should create/update profile in `public.profiles`
   - Uses `upsert` so it should work even if trigger didn't fire
2. **Step 2**: Check existing org memberships
3. **Step 3**: Create org (if needed)
4. **Step 4**: Add user to `org_members`
5. **Step 5**: Create default project

## Why Profile Might Be Missing

### Possibility 1: Trigger Not Running
- The trigger `on_auth_user_created` might not be set up
- Check: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';`

### Possibility 2: `ensureProfile` Failed Silently
- `ensureProfile` might have failed but didn't throw an error
- Check backend logs for "Step 1: Ensuring profile exists..." messages
- Check for any errors in Step 1

### Possibility 3: Foreign Key Constraint
- If foreign keys are NOT deferrable, `ensureProfile` might fail
- But it should log an error

## How to Fix

### Option 1: Run the Trigger Migration
```sql
-- Run this in Supabase SQL Editor:
\i supabase/sql/004_auto_profile_trigger.sql
-- OR
\i supabase/sql/005_fix_provision_issues.sql
```

### Option 2: Manually Create Profile
```sql
-- For the specific user:
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT 
  id, 
  email,
  created_at,
  now()
FROM auth.users
WHERE id = 'USER_ID_HERE'
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    updated_at = now();
```

### Option 3: Create Profiles for All Missing Users
```sql
-- Create profiles for all auth users who don't have one:
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT 
  id, 
  email,
  created_at,
  now()
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;
```

## How Profiles Are Associated

The `profiles` table is linked to:
- **`auth.users`**: `profiles.id` → `auth.users.id` (foreign key)
- **`org_members`**: `org_members.user_id` → `profiles.id` (indirectly via `auth.users.id`)
- **`organizations`**: No direct link, but via `org_members`

### Data Flow:
```
auth.users (id)
    ↓
profiles (id = auth.users.id)
    ↓
org_members (user_id = profiles.id)
    ↓
organizations (id = org_members.org_id)
    ↓
projects (org_id = organizations.id)
    ↓
project_envs (project_id = projects.id)
```

## Verification Queries

### Check if Profile Exists:
```sql
SELECT p.*, u.email as auth_email
FROM public.profiles p
RIGHT JOIN auth.users u ON p.id = u.id
WHERE u.id = 'USER_ID_HERE';
```

### Check Full User Data:
```sql
SELECT 
  u.id as user_id,
  u.email,
  p.id as profile_id,
  p.email as profile_email,
  om.org_id,
  om.role,
  o.name as org_name,
  pr.id as project_id,
  pr.name as project_name
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
LEFT JOIN public.org_members om ON u.id = om.user_id
LEFT JOIN public.organizations o ON om.org_id = o.id
LEFT JOIN public.projects pr ON o.id = pr.org_id
WHERE u.id = 'USER_ID_HERE';
```

## Next Steps

1. **Check backend logs** for Step 1 errors
2. **Verify trigger exists**: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';`
3. **Run migration** if trigger doesn't exist: `005_fix_provision_issues.sql`
4. **Manually create profile** for this user if needed
5. **Test with new signup** to verify trigger works

