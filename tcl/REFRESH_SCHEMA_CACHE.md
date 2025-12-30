# How to Refresh Supabase Schema Cache

The `onboarding_completed` column exists in your database, but Supabase's PostgREST API cache hasn't refreshed yet. Here's how to force a refresh:

## Method 1: SQL Command (Recommended)

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Run this command:

```sql
NOTIFY pgrst, 'reload schema';
```

4. Wait a few seconds, then try your "Skip for now" button again

## Method 2: Re-run the Migration

The migration file `011_add_onboarding_flag.sql` now includes the schema refresh command. You can re-run it:

1. Go to **SQL Editor** in Supabase Dashboard
2. Copy and paste the entire contents of `supabase/sql/011_add_onboarding_flag.sql`
3. Click "Run"

This is safe to run multiple times - it uses `IF NOT EXISTS` so it won't create duplicates.

## Method 3: Wait for Auto-Refresh

Supabase automatically refreshes the schema cache every 1-2 minutes, but this can be slow. The SQL command above is much faster.

## Verify It Worked

After running the refresh, you can verify the column exists by running:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name = 'onboarding_completed';
```

You should see a row with `onboarding_completed` and `boolean` as the data type.

