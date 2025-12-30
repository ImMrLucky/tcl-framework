# Supabase Migration Reminder

## Required Migration: Add onboarding_completed Column

The `onboarding_completed` column needs to be added to the `profiles` table.

### Migration File
`supabase/sql/011_add_onboarding_flag.sql`

### How to Run

1. Go to your Supabase Dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of `supabase/sql/011_add_onboarding_flag.sql`
4. Click "Run"

### What This Migration Does

- Adds `onboarding_completed` boolean column to `profiles` table
- Sets default value to `false`
- Creates an index for faster queries
- Updates existing profiles that have onboarding data to mark them as completed

### Error If Not Run

If you see this error:
```
{
  "code": "PGRST204",
  "message": "Could not find the 'onboarding_completed' column of 'profiles' in the schema cache"
}
```

It means this migration hasn't been run yet. Run it now!

