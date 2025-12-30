# Debugging Profile Creation

## What to Check

### 1. Check if RPC Function Exists

Run this in Supabase SQL Editor:

```sql
SELECT 
  proname as function_name,
  prosrc as function_body
FROM pg_proc 
WHERE proname = 'ensure_user_profile';
```

**Expected**: Should return 1 row with the function definition

**If empty**: The function doesn't exist - you need to run `supabase/sql/009_ensure_profile_function.sql`

### 2. Check Backend Logs

Look for these log messages in Railway/TCL Core:

```
ensureProfile: Starting for user ...
ensureProfile: Calling RPC ensure_user_profile with userId=..., email=...
```

**If you see**: `"RPC function not available (function does not exist)"`
- **Solution**: Run `supabase/sql/009_ensure_profile_function.sql`

**If you see**: `"RPC returned: true"` but profile doesn't exist
- **Problem**: RPC function returned true but didn't create profile
- **Solution**: Check RPC function logic

**If you see**: `"ensureProfileFallback: Starting fallback"`
- **Problem**: RPC function doesn't exist or failed
- **Solution**: Run the SQL migration

### 3. Test RPC Function Manually

Run this in Supabase SQL Editor (replace USER_ID with actual user ID):

```sql
SELECT public.ensure_user_profile('USER_ID_HERE', 'test@example.com');
```

**Expected**: Returns `true`

**If error**: Check the error message - might be permission issue or user doesn't exist

### 4. Check Profile Table

```sql
SELECT * FROM public.profiles WHERE id = 'USER_ID_HERE';
```

**If empty**: Profile wasn't created
**If exists**: Profile was created successfully

### 5. Check if User Exists in auth.users

```sql
SELECT id, email FROM auth.users WHERE id = 'USER_ID_HERE';
```

**If empty**: User doesn't exist - this is the root cause
**If exists**: User exists, profile should be creatable

## Common Issues

### Issue 1: RPC Function Doesn't Exist
**Symptom**: Logs show "RPC function not available"
**Fix**: Run `supabase/sql/009_ensure_profile_function.sql`

### Issue 2: RPC Function Returns True But Profile Not Created
**Symptom**: RPC returns true but profile doesn't exist
**Possible causes**:
- Transaction rollback
- RLS policy blocking insert
- Permission issue

**Fix**: Check RLS policies on `profiles` table

### Issue 3: User Not Fully Committed
**Symptom**: Foreign key constraint errors
**Fix**: The RPC function should handle this, but if it doesn't, the trigger should create it

## Next Steps

1. **Check logs** - Look for the new detailed log messages
2. **Check if RPC exists** - Run the SQL query above
3. **Run migration if needed** - `supabase/sql/009_ensure_profile_function.sql`
4. **Test manually** - Try calling the RPC function directly

