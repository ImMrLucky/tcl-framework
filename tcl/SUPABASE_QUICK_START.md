# Quick Start: Finding Your Supabase Credentials

## Step-by-Step Guide

### 1. Go to Supabase Dashboard
- Visit https://supabase.com
- Sign in or create an account
- Create a new project (or select an existing one)

### 2. Navigate to API Settings
Once your project is loaded:
1. Click on **Settings** (⚙️ gear icon) in the left sidebar
2. Click on **API** in the settings menu

### 3. Find Your Credentials

You'll see a page with several sections. Here's what you need:

#### Project URL
- **Label:** "Project URL" or "URL"
- **Location:** Usually at the top of the API settings page
- **Format:** `https://xxxxxxxxxxxxx.supabase.co`
- **This is your `SUPABASE_URL`**

#### API Keys Section
Scroll down to see the API keys:

1. **anon public** key
   - **Label:** "anon public" or "anon" 
   - **Format:** Starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - **This is your `SUPABASE_ANON_KEY`**
   - ✅ Safe to use in frontend

2. **service_role secret** key
   - **Label:** "service_role secret" or "service_role"
   - **Format:** Starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - **This is your `SUPABASE_SERVICE_ROLE_KEY`**
   - ⚠️ **SECRET** - Only use in backend, never expose to frontend!
   - You may need to click "Reveal" to see the full key

### 4. Copy to Your .env File

Open `packages/tcl-core/.env` and paste:

```env
SUPABASE_URL=https://your-actual-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdXItcHJvamVjdC1pZCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjE2MjM5MDIyfQ.your-
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdXItcHJvamVjdC1pZCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE2MTYyMzkwMjJ9.your-service-role-key-here
```

### Visual Guide

The API settings page typically looks like this:

```
┌─────────────────────────────────────┐
│  Settings > API                     │
├─────────────────────────────────────┤
│                                     │
│  Project URL                        │
│  https://xxxxx.supabase.co          │  ← SUPABASE_URL
│                                     │
│  API Keys                           │
│                                     │
│  anon public                        │
│  eyJhbGciOiJIUzI1NiIsInR5cCI6...   │  ← SUPABASE_ANON_KEY
│  [Copy]                             │
│                                     │
│  service_role secret                │
│  [Reveal] [Copy]                    │  ← SUPABASE_SERVICE_ROLE_KEY
│                                     │
└─────────────────────────────────────┘
```

### Troubleshooting

**Can't find the API settings?**
- Make sure you're logged into Supabase
- Select your project from the project list
- Look for "Settings" in the left sidebar (gear icon)

**Can't see the service_role key?**
- Click the "Reveal" button next to "service_role secret"
- Some projects may require you to confirm before revealing

**Project URL looks different?**
- It should always start with `https://`
- It should end with `.supabase.co`
- If you see a different format, check that you're in the right project

### Next Steps

After adding your credentials to `.env`:
1. Run the SQL migrations (see `SUPABASE_SETUP.md`)
2. Restart your backend server
3. Test with: `POST /auth/provision`

