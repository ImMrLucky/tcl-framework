# Railway Deployment - TCL Integrations Service

## Overview

You need a **separate Railway service** for the integrations service because:
- It's a different Express server (port 8788)
- Separate codebase (`packages/tcl-integrations/`)
- Runs independently from TCL Core

## Setup Steps

### 1. Create New Railway Service

1. Go to your Railway project dashboard
2. Click **"+ New"** → **"GitHub Repo"** (or **"Empty Service"**)
3. Select your repository
4. Railway will auto-detect the service

### 2. Configure Build Settings

**Option A: Root-level deployment (if repo root is tcl/)**

In Railway dashboard → Settings → Build:
- **Root Directory**: `packages/tcl-integrations`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`

**Option B: Using railway.json (recommended)**

The `railway.json` file is already configured. Railway will use it automatically.

### 3. Set Environment Variables

In Railway dashboard → Variables, add:

```bash
# Supabase (same as tcl-core uses)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# TCL Core URL - Point to your existing tcl-core Railway service
# Get this from your tcl-core Railway service URL
TCL_CORE_URL=https://your-tcl-core-service.railway.app
# OR if you have a custom domain:
# TCL_CORE_URL=https://tcl-core.yourdomain.com

# Service Port (Railway sets this automatically, but good to have)
PORT=8788

# Frontend URL (for webhook links)
FRONTEND_URL=https://app.protectqa.com
```

### 4. Get TCL Core URL

To find your TCL Core Railway URL:

1. Go to your **tcl-core** Railway service
2. Click on the service
3. Go to **Settings** → **Networking**
4. Copy the **Public Domain** (e.g., `tcl-core-production.up.railway.app`)
5. Use this as `TCL_CORE_URL`: `https://tcl-core-production.up.railway.app`

**Important:** Don't include `/validate` or any path - just the base URL.

### 5. Deploy

Railway will automatically:
1. Detect the service
2. Install dependencies
3. Build TypeScript
4. Start the service

## Service Communication

```
┌─────────────────────┐
│  Railway Service 1 │
│   TCL Core         │
│   Port: 8787       │
│   URL: https://... │
└──────────┬─────────┘
           │
           │ HTTP POST /validate
           │
┌──────────▼─────────┐
│  Railway Service 2 │
│   Integrations     │
│   Port: 8788       │
│   URL: https://... │
└────────────────────┘
```

## Verify Deployment

1. **Check Integrations Service Health:**
```bash
curl https://your-integrations-service.railway.app/health
# Should return: {"status":"ok","service":"tcl-integrations"}
```

2. **Check TCL Core is Reachable:**
```bash
curl https://your-tcl-core-service.railway.app/health
# Should return: {"status":"ok","service":"tcl-core"}
```

3. **Test Integration:**
```bash
# Test webhook endpoint (if you have a webhook token)
curl -X POST https://your-integrations-service.railway.app/webhooks/YOUR_TOKEN \
  -H "Content-Type: application/json" \
  -H "X-ProtectQA-Timestamp: $(date +%s)000" \
  -H "X-ProtectQA-Signature: sha256=..." \
  -d '{"external_id":"test","channel":"chat","artifacts":[...]}'
```

## Railway-Specific Considerations

### Port Configuration

Railway automatically sets the `PORT` environment variable. The service will use:
```typescript
const PORT = process.env.PORT || 8788;
```

So Railway's `PORT` will be used automatically.

### Networking

- Both services can communicate via their Railway public domains
- No special networking setup needed
- Railway handles HTTPS automatically

### Environment Variables

You can:
1. **Set per-service** (recommended) - Each service has its own variables
2. **Use Railway's shared variables** - If you want to share Supabase config

### Cost

- Each Railway service is billed separately
- Check Railway pricing for multiple services
- Consider using Railway's free tier for development

## Troubleshooting

### "Cannot connect to TCL Core"

1. Verify `TCL_CORE_URL` is set correctly:
   ```bash
   # In Railway, check Variables tab
   # Should be: https://your-tcl-core-service.railway.app
   # NOT: http://localhost:8787 (won't work on Railway)
   ```

2. Test TCL Core is accessible:
   ```bash
   curl https://your-tcl-core-service.railway.app/health
   ```

3. Check Railway service is running (not paused)

### "Missing SUPABASE_URL"

1. Go to Railway → Variables
2. Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
3. Redeploy after adding variables

### Build Fails

1. Check Railway logs for errors
2. Verify `package.json` exists in `packages/tcl-integrations/`
3. Ensure Node.js 18+ is available (Railway auto-detects)

## Alternative: Monorepo Setup

If you want both services in one Railway project:

1. Create **two services** in the same Railway project
2. Each service points to different root directories:
   - Service 1: `packages/tcl-core`
   - Service 2: `packages/tcl-integrations`
3. Set environment variables per service

This keeps them in one project but they're still separate deployments.

## Quick Setup Checklist

- [ ] Create new Railway service
- [ ] Set root directory to `packages/tcl-integrations`
- [ ] Add environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TCL_CORE_URL)
- [ ] Get TCL Core Railway URL and set as TCL_CORE_URL
- [ ] Deploy
- [ ] Verify health endpoint works
- [ ] Test webhook endpoint (if applicable)

