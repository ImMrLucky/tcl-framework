# Evidence System Migration - Quick Start

## Error You're Seeing

```
Could not find the 'evidence_diagnostics' column of 'evaluations' in the schema cache
```

This means the database migration for the evidence system hasn't been run yet.

## Prerequisites

The `028_evidence_system_phase1.sql` migration depends on these tables existing:
- ✅ `organizations` (from `001_init.sql` or `003_enterprise_trial.sql`)
- ✅ `projects` (from `003_enterprise_trial.sql`)
- ✅ `conversations` (from `003_enterprise_trial.sql`)
- ✅ `evaluations` (from `003_enterprise_trial.sql`)
- ✅ `auth.users` (standard Supabase)

**If you've been using the app, these should already exist.** The migration uses `IF NOT EXISTS` clauses, so it's safe to run even if some things already exist.

**Optional dependency:**
- `templates` table - The migration references this but it's optional (commented as "if it exists")

## Solution: Run the Migration

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard: https://supabase.com/dashboard
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**
4. Open the file: `tcl/supabase/sql/028_evidence_system_phase1.sql`
5. Copy the **entire contents** of the file
6. Paste into the SQL Editor
7. Click **Run** (or press Cmd/Ctrl + Enter)
8. Wait for it to complete (should take a few seconds)
9. **Refresh the schema cache** (see below)

### Option 2: Supabase CLI

```bash
cd tcl
supabase db execute -f supabase/sql/028_evidence_system_phase1.sql
```

## Important: Refresh Schema Cache

After running the migration, you **must** refresh Supabase's schema cache:

### Option A: Via Supabase Dashboard
1. Go to **Settings** → **API**
2. Scroll down to **Schema Cache**
3. Click **Refresh Schema Cache** or **Clear Cache**

### Option B: Via SQL (if available)
```sql
-- This may not work depending on your Supabase plan
NOTIFY pgrst, 'reload schema';
```

### Option C: Wait a few minutes
The cache usually refreshes automatically within 1-5 minutes.

## What This Migration Adds

The migration adds these columns to the `evaluations` table:
- `evidence_set` (jsonb) - Stores resolved evidence IDs
- `evidence_diagnostics` (jsonb) - Stores indexing failures and diagnostics
- `template_id` (uuid) - Links to template if used
- `simulation_mode` (boolean) - Admin flag for DRAFT evidence

It also creates:
- `evidence_items` table - Core evidence storage
- `evidence_chunks` table - Indexed chunks for retrieval
- `evidence_approvals` table - Audit trail
- `resolve_evidence_set()` function - Helper to resolve evidence sets

## Verification

After running the migration, verify it worked:

```sql
-- Check that columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'evaluations' 
AND column_name IN ('evidence_set', 'evidence_diagnostics', 'template_id', 'simulation_mode');

-- Should return 4 rows
```

## Troubleshooting

### Error: "relation already exists"
- Some tables might already exist - that's okay, the migration uses `IF NOT EXISTS`
- Continue running the migration

### Error: "column already exists"
- The column might already exist - that's okay, the migration uses `IF NOT EXISTS`
- Continue running the migration

### Still getting schema cache errors after migration
1. Wait 2-3 minutes for auto-refresh
2. Try manually refreshing in Supabase Dashboard
3. Restart your application server
4. Check that the columns actually exist using the verification query above

