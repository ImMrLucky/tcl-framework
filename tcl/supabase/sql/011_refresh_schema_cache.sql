-- Refresh PostgREST schema cache
-- Run this AFTER running 011_add_onboarding_flag.sql if you still see PGRST204 errors
-- This forces Supabase to reload the schema and recognize the new column

NOTIFY pgrst, 'reload schema';

-- Alternative: You can also refresh via Supabase Dashboard:
-- 1. Go to Settings > API
-- 2. Click "Reload schema cache" button
-- Or wait 1-2 minutes for auto-refresh

