# Railway Supabase Setup - Quick Fix

## Problem
You're seeing: `{"error":"Supabase not configured"}` when trying to sign up.

This means your TCL Core service on Railway doesn't have Supabase environment variables set.

## Solution: Add Environment Variables to Railway

### Step 1: Get Your Supabase Credentials

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: `uqwcmkyaskyduxuluqrm`
3. Go to **Settings** → **API**
4. Copy these values:
   - **Project URL** → This is your `SUPABASE_URL`
     - Example: `https://uqwcmkyaskyduxuluqrm.supabase.co`
   - **service_role key** (under "Project API keys") → This is your `SUPABASE_SERVICE_ROLE_KEY`
     - ⚠️ **Important**: Use the `service_role` key, NOT the `anon` key
     - It starts with `eyJ...` and is much longer

### Step 2: Add to Railway

1. Go to [Railway Dashboard](https://railway.app)
2. Click on your **TCL Core** service
3. Click on the **Variables** tab
4. Click **+ New Variable**
5. Add these two variables:

   **Variable 1:**
   - **Name**: `SUPABASE_URL`
   - **Value**: `https://uqwcmkyaskyduxuluqrm.supabase.co`
   - Click **Add**

   **Variable 2:**
   - **Name**: `SUPABASE_SERVICE_ROLE_KEY`
   - **Value**: `[paste your service_role key here]`
   - Click **Add**

### Step 3: Redeploy

After adding the variables, Railway will automatically redeploy your service. Wait for the deployment to complete (usually 1-2 minutes).

### Step 4: Verify

1. Check Railway logs - you should see:
   ```
   ✅ TCL-Core listening on [port]
   ```
   (No more "Supabase not configured" warnings)

2. Try signing up again in your app
3. Check the browser console - you should see:
   ```
   User provisioned successfully
   ```

## Optional: Add SUPABASE_ANON_KEY (for future features)

You can also add `SUPABASE_ANON_KEY` if you want to use the anon client:
- **Name**: `SUPABASE_ANON_KEY`
- **Value**: The `anon` key from Supabase (different from service_role)

This is optional - the service will work with just `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Troubleshooting

### Still seeing "Supabase not configured"?

1. **Check variable names** - Must be exactly:
   - `SUPABASE_URL` (not `SUPABASE_URLS` or `SUPABASE_API_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY` (not `SUPABASE_KEY` or `SUPABASE_SECRET`)

2. **Check values** - Make sure:
   - `SUPABASE_URL` starts with `https://` and ends with `.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` is the long JWT token (starts with `eyJ`)

3. **Redeploy** - After adding variables, Railway should auto-redeploy. If not:
   - Go to **Deployments** tab
   - Click **Redeploy**

4. **Check logs** - In Railway, go to **Logs** tab and look for:
   - `⚠️ Supabase not configured` = variables missing
   - No warning = variables are set correctly

### Service won't start?

Check Railway logs for errors. Common issues:
- Invalid Supabase URL format
- Wrong service_role key (using anon key instead)
- Network issues connecting to Supabase

## Quick Reference

**Required Variables:**
```
SUPABASE_URL=https://uqwcmkyaskyduxuluqrm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Where to find:**
- Supabase Dashboard → Settings → API → Project URL
- Supabase Dashboard → Settings → API → service_role key

