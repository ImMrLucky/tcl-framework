# How to Login as Superuser / Test User

## Method 1: Auto-Grant via Environment Variables (Recommended for Dev/Staging)

The system has an automatic superuser grant mechanism that works in dev/staging environments.

### Step 1: Set Environment Variables

Add these to your backend environment (`.env` file or Railway/Netlify environment variables):

```bash
# Required: Comma-separated list of emails to auto-grant SUPERUSER
DEV_SUPERUSER_EMAILS="your-email@protectqa.com,admin@example.com"

# Optional: Comma-separated list of domains (all users from these domains get SUPERUSER)
DEV_SUPERUSER_DOMAINS="protectqa.com"

# Optional: Only needed if you want auto-grant in production (default: false)
# ALLOW_DEV_SUPERUSER_IN_PROD="true"
```

### Step 2: Sign Up or Login

1. Go to `/login` page
2. Sign up with an email in your `DEV_SUPERUSER_EMAILS` list (or from a domain in `DEV_SUPERUSER_DOMAINS`)
3. OR sign in if you already have an account
4. The system will automatically grant you SUPERUSER role during login/provision

### Step 3: Verify You're a Superuser

- Check the `/api/me` endpoint response - it should include `"isSuperuser": true`
- You should see admin controls in the UI (Active Org Switcher, Emulation Toggle)
- You should have access to `/admin` pages

---

## Method 2: Manual Database Update (For Existing Users)

If you already have an account and want to make it a superuser:

### Option A: Via Supabase SQL Editor

```sql
-- Update your profile to SUPERUSER
UPDATE public.profiles
SET role = 'SUPERUSER'
WHERE email = 'your-email@example.com';
```

### Option B: Via Supabase Dashboard

1. Go to Supabase Dashboard → Table Editor → `profiles` table
2. Find your user by email
3. Edit the `role` column and set it to `SUPERUSER`
4. Save

---

## Method 3: Use Internal Test Orgs (For Testing Different Plan Tiers)

The system includes seed scripts that create internal test organizations:

### Step 1: Run the Seed Script

```sql
-- Run this in Supabase SQL Editor
\i supabase/sql/022_seed_internal_test_orgs.sql
```

This creates three test orgs:
- **ProtectQA Internal Sandbox** (SANDBOX tier)
- **ProtectQA Internal Team** (TEAM tier)
- **ProtectQA Internal Enterprise** (ENTERPRISE tier)

### Step 2: Become a Superuser

Use Method 1 or Method 2 above to get SUPERUSER role.

### Step 3: Switch to Test Org

Once you're a superuser:
1. Login to the app
2. You'll see an "Active Org" switcher in the header (superuser-only)
3. Select one of the internal test orgs to test different plan tiers

---

## How to Test Superuser Features

Once you're logged in as a superuser:

### 1. Admin Controls (Header)
- **Active Org Switcher**: Switch between your organizations
- **Emulation Toggle**: Temporarily override plan tier for testing
- **Admin Instructions**: Link to admin guide

### 2. Admin Pages
- `/admin` - Admin dashboard
- `/admin/instructions` - Admin guide and documentation

### 3. Emulation Feature
- Allows you to test different plan tiers without changing the actual org plan
- Useful for testing feature gating and limits
- Only affects your session (doesn't persist to database)

---

## Troubleshooting

### "I set the env var but I'm not a superuser"

1. **Check environment**: Auto-grant only works in non-production by default
   - If in production, set `ALLOW_DEV_SUPERUSER_IN_PROD="true"`

2. **Check email match**: Make sure your email exactly matches (case-insensitive)
   ```bash
   # Check your backend logs for:
   🔐 AUTO-GRANTED SUPERUSER: your-email@example.com
   ```

3. **Check if profile exists**: The auto-grant happens during login/provision
   - Try logging out and logging back in
   - Or sign up fresh with the allowlisted email

4. **Check database**: Verify your role in the database
   ```sql
   SELECT id, email, role FROM public.profiles WHERE email = 'your-email@example.com';
   ```

### "I don't see admin controls"

1. **Verify superuser status**: Check `/api/me` response for `"isSuperuser": true`
2. **Check frontend**: Make sure you've refreshed the page after becoming superuser
3. **Check role in database**: 
   ```sql
   SELECT role FROM public.profiles WHERE id = 'your-user-id';
   ```

### "Internal test orgs don't exist"

Run the seed script:
```sql
\i supabase/sql/022_seed_internal_test_orgs.sql
```

Then verify:
```sql
SELECT name, slug, plan_tier, is_internal_test 
FROM public.organizations 
WHERE is_internal_test = true;
```

---

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never enable in production** unless absolutely necessary
   - Auto-grant is disabled in production by default
   - Requires explicit `ALLOW_DEV_SUPERUSER_IN_PROD="true"` to enable

2. **Use specific emails, not domains** when possible
   - Domain allowlists are convenient but less secure
   - Prefer individual email allowlists

3. **Audit logging**: All auto-grants are logged to `admin_audit_log` table
   ```sql
   SELECT * FROM public.admin_audit_log 
   WHERE action = 'AUTO_GRANT_SUPERUSER' 
   ORDER BY created_at DESC;
   ```

4. **No auto-demotion**: Once granted, SUPERUSER role is never automatically removed
   - You must manually change it back to `USER` if needed

---

## Quick Start (Local Development)

1. **Add to your `.env` file:**
   ```bash
   DEV_SUPERUSER_EMAILS="your-email@example.com"
   ```

2. **Restart your backend server**

3. **Sign up/login** with that email at `/login`

4. **You're now a superuser!** 🎉

Check the backend logs for:
```
🔐 AUTO-GRANTED SUPERUSER: your-email@example.com (email match)
```

