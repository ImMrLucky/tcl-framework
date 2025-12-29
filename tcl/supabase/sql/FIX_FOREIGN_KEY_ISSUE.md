# Fix Foreign Key Constraint Issue

## Problem
Getting errors like:
```
insert or update on table "profiles" violates foreign key constraint "profiles_id_fkey"
Key (id)=(...) is not present in table "users".
```

## Root Cause
When a user signs up, there's a timing issue where:
1. User is created in Supabase Auth
2. Backend tries to create profile immediately
3. But the user hasn't been fully committed to `auth.users` table yet

## Solution: Database Trigger

Run this SQL migration to automatically create profiles when users sign up:

### Step 1: Run the Migration

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **SQL Editor**
4. Run `supabase/sql/004_auto_profile_trigger.sql`

This creates a trigger that automatically creates a profile whenever a user is created in `auth.users`.

### Step 2: Verify It Works

After running the migration:

1. **Check the trigger exists:**
   ```sql
   SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
   ```

2. **Test by signing up a new user:**
   - The profile should be created automatically
   - No more foreign key errors

### Step 3: Update Existing Users (Optional)

If you have existing users without profiles, you can create them:

```sql
-- Create profiles for existing auth users who don't have one
INSERT INTO public.profiles (id, email)
SELECT id, email
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;
```

## How It Works

The trigger `on_auth_user_created` runs **after** a user is inserted into `auth.users`. This ensures:
- The user definitely exists in `auth.users` before we try to create the profile
- No timing issues
- Automatic profile creation for all new users

## Alternative: Deferrable Foreign Keys

If you prefer not to use triggers, you can make the foreign keys deferrable:

```sql
-- Drop existing constraint
ALTER TABLE public.profiles
DROP CONSTRAINT profiles_id_fkey;

-- Recreate as deferrable
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_id_fkey
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
DEFERRABLE INITIALLY DEFERRED;
```

However, **the trigger approach is recommended** because:
- It's automatic
- No code changes needed
- Works for all signup methods
- Standard Supabase pattern

## Troubleshooting

### Trigger not working?

1. **Check if trigger exists:**
   ```sql
   SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
   ```

2. **Check function exists:**
   ```sql
   SELECT * FROM pg_proc WHERE proname = 'handle_new_user';
   ```

3. **Test the function manually:**
   ```sql
   -- This should work if the function is correct
   SELECT public.handle_new_user();
   ```

### Still getting errors?

1. Make sure you ran `004_auto_profile_trigger.sql`
2. Check Supabase logs for trigger execution errors
3. Verify the user actually exists in `auth.users`:
   ```sql
   SELECT id, email FROM auth.users WHERE id = 'your-user-id';
   ```

