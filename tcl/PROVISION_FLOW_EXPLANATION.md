# Provision Flow - When Profile Should Be Created

## Expected Flow

When a user signs up, here's what should happen **in order**:

### Step 1: Profile Creation (FIRST!)
```
User signs up → Frontend calls /auth/provision
→ Backend: ensureProfile(userId, email)
→ Creates profile in public.profiles table
→ ✅ Profile should exist NOW
```

### Step 2: Check Existing Orgs
```
Check if user already has org memberships
```

### Step 3: Create Organization
```
Create organization in public.organizations
→ ✅ Organization created
```

### Step 4: Add User to Org
```
Add user to public.org_members as 'owner'
→ ✅ User added to org_members
```

### Step 5: Create Default Project
```
Create default project in public.projects
Create default project_env in public.project_envs
→ ✅ Project and project_env created
```

## What You're Seeing

You see:
- ✅ `organizations` - Step 3 succeeded
- ✅ `projects` - Step 5 succeeded  
- ✅ `project_envs` - Step 5 succeeded
- ❌ `profiles` - **Step 1 FAILED or was skipped**

## This Means...

**Step 1 (profile creation) failed**, but the code continued anyway and created the org/project. This is exactly the bug we're trying to fix!

## Why Profile Should Be First

The profile is the **foundation** - everything else depends on it:
- `org_members.user_id` references `auth.users.id` (which should have a profile)
- User metadata (company role, industry, etc.) is stored in profiles
- Frontend loads user info from profiles

## What to Check

### 1. Check Backend Logs (Railway/TCL Core)
Look for:
```
Step 1: Ensuring profile exists...
✅ Profile ensured: id=..., email=...
```
OR
```
Step 1 FAILED: Could not ensure profile exists
```

### 2. Check if Profile Exists
```sql
SELECT * FROM public.profiles WHERE id = 'YOUR_USER_ID';
```

### 3. Check if User Exists in auth.users
```sql
SELECT id, email FROM auth.users WHERE id = 'YOUR_USER_ID';
```

## If Profile Doesn't Exist

The new code should:
1. Retry up to 5 times
2. Verify profile exists after creation
3. Log detailed errors if it fails

But if it's still not creating the profile, check:
- Backend logs for Step 1 errors
- Whether user exists in `auth.users`
- Whether foreign key constraints are blocking it

## Expected Result After Fix

After the code changes, you should see:
1. ✅ Profile created in Step 1
2. ✅ Organization created in Step 3
3. ✅ User added to org_members in Step 4
4. ✅ Project created in Step 5

All 4 should exist, with profile being created FIRST.

