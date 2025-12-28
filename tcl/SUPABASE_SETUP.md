# Supabase Setup Guide

This guide walks through setting up Supabase for ProtectQA enterprise features.

## Prerequisites

1. Create a Supabase project at https://supabase.com
   - Sign up/login at https://supabase.com
   - Click "New Project"
   - Choose organization, name your project, set a database password
   - Wait for project to initialize (2-3 minutes)

2. Get your project credentials:
   - Go to your project dashboard
   - Click on **Settings** (gear icon in left sidebar)
   - Click on **API** in the settings menu
   - You'll see:
     - **Project URL** → This is your `SUPABASE_URL` (e.g., `https://xxxxx.supabase.co`)
     - **anon public** key → This is your `SUPABASE_ANON_KEY` (safe for frontend)
     - **service_role secret** key → This is your `SUPABASE_SERVICE_ROLE_KEY` (backend only - never expose to frontend)
   
   > **Important:** The service_role key has admin privileges and bypasses Row Level Security. Never commit it or expose it to the frontend!

## Step 1: Run SQL Migrations

1. Open Supabase Dashboard → SQL Editor
2. Run `supabase/sql/001_init.sql` to create tables
3. Run `supabase/sql/002_rls.sql` to enable Row Level Security

## Step 2: Configure Backend

1. Copy the example file:
   ```bash
   cd packages/tcl-core
   cp .env.example .env
   ```

2. Edit `.env` with your actual Supabase credentials:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   SUPABASE_ANON_KEY=your-anon-key
   ```
   
   **Where to find these values:**
   - In Supabase Dashboard → **Settings** (⚙️ gear icon) → **API**
   - `SUPABASE_URL` = "Project URL" (starts with `https://`, ends with `.supabase.co`)
   - `SUPABASE_ANON_KEY` = "anon public" key (starts with `eyJ...`)
   - `SUPABASE_SERVICE_ROLE_KEY` = "service_role secret" key (starts with `eyJ...`, click "Reveal" to see it)
   
   > **Note:** The `.env` file is gitignored and should never be committed. Only `.env.example` is tracked in git.
   > 
   > **See `SUPABASE_QUICK_START.md` for detailed step-by-step instructions with screenshots guidance.**

## Step 3: Configure Frontend

Add to `packages/tcl-ui/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Step 4: Configure Auth in Supabase

1. Go to Authentication → Providers
2. Enable Email provider
3. Configure URL Configuration:
   - Site URL: `http://localhost:3000` (dev)
   - Redirect URLs: `http://localhost:3000/**`

## Step 5: Test

1. Start backend: `cd packages/tcl-core && npm run dev`
2. Test provision endpoint:
   ```bash
   curl -X POST http://localhost:8787/auth/provision \
     -H "Content-Type: application/json" \
     -d '{"userId": "test-user-id", "email": "test@example.com"}'
   ```

## API Endpoints

### Auth
- `POST /auth/provision` - Provision user (create profile + default org)
- `GET /me/orgs` - Get user's organizations

### API Keys
- `POST /orgs/:orgId/api-keys` - Create API key (admin only)
- `GET /orgs/:orgId/api-keys` - List API keys (admin only)

### Validations
- `POST /validate` - Validate (stores result if org_id available)
- `GET /validations` - List validations for org

## Using API Keys

Include in request header:
```
Authorization: Bearer pq_live_xxxxx
```

The backend will:
1. Hash the key
2. Lookup in `api_keys` table
3. Extract `org_id` and `scopes`
4. Store validation with `org_id`

## Security Notes

- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` to frontend
- API keys are hashed with SHA-256 before storage
- Row Level Security (RLS) prevents cross-org access
- Backend uses service_role to bypass RLS (intended for admin operations)

