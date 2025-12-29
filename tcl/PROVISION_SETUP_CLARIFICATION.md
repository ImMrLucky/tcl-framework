# Provision Setup Clarification

## One-Time vs Per-User Setup

### ❌ NOT Required Each Time
The SQL migration `005_fix_provision_issues.sql` is a **ONE-TIME database setup**. You only need to run it:
- Once when first setting up the database
- If you reset/recreate your database
- If the trigger or foreign keys got deleted somehow

### ✅ What Happens Automatically
Once the database is set up (or even without it), the **code handles everything**:
- `ensureProfile()` creates profiles automatically
- Retries handle timing issues
- No manual SQL needed for each user

## What the Migration Does (One-Time Setup)

1. **Creates a trigger** that auto-creates profiles when users sign up (backup safety net)
2. **Makes foreign keys deferrable** (helps with timing issues)
3. **Creates profiles for existing users** (one-time cleanup)

## Do You Need to Run It?

### Check if Already Set Up:
```sql
-- Check if trigger exists:
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';

-- Check if foreign keys are deferrable:
SELECT conname, condeferrable, condeferred
FROM pg_constraint 
WHERE conname IN ('profiles_id_fkey', 'org_members_user_id_fkey');
```

### If Already Set Up:
✅ **You're done!** No need to run it again.

### If NOT Set Up:
The code will still work, but:
- Profile creation might fail more often due to timing issues
- You'll need more retries
- The trigger won't be there as a backup

**Recommendation**: Run it once to make provisioning more reliable.

## How It Works Now

### With Migration (Recommended):
1. User signs up → Trigger creates profile automatically (backup)
2. Code calls `ensureProfile()` → Creates/verifies profile (primary)
3. If trigger already created it, upsert just updates it
4. Foreign keys are deferrable, so timing issues are less likely

### Without Migration (Still Works):
1. User signs up → No trigger, no auto-profile
2. Code calls `ensureProfile()` → Creates profile with retries
3. More retries needed if timing is tight
4. Still works, just less reliable

## Bottom Line

- **Migration = One-time setup** (like creating tables)
- **Code = Handles every signup automatically**
- You don't need to run SQL for each user
- But running the migration once makes it more reliable

