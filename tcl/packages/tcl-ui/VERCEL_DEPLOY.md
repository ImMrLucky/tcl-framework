# Deploying TCL UI to Vercel

This guide will help you deploy the Angular UI to Vercel.

## Quick Deploy Steps

### 1. Install Vercel CLI (Optional)

```bash
npm install -g vercel
```

Or use the web interface - no CLI needed!

### 2. Deploy via Web Interface (Easiest)

1. **Push your code to Git** (GitHub, GitLab, or Bitbucket)
2. **Go to [Vercel](https://vercel.com)** and sign in
3. **Click "Add New Project"**
4. **Import your Git repository**
5. **Configure the project**:
   - Framework Preset: **Angular**
   - Root Directory: `packages/tcl-ui` (if deploying from monorepo root)
   - Build Command: `npm run build` (auto-detected)
   - Output Directory: `dist/tcl-ui/browser` (auto-detected)
6. **Add Environment Variable**:
   - Key: `VERCEL_TCL_CORE_URL` or `TCL_CORE_URL`
   - Value: Your TCL Core service URL (e.g., `https://tcl-core.railway.app`)
7. **Click "Deploy"**

### 3. Deploy via CLI

```bash
cd packages/tcl-ui

# Login to Vercel
vercel login

# Deploy (first time will ask questions)
vercel

# Set environment variable
vercel env add VERCEL_TCL_CORE_URL

# Deploy to production
vercel --prod
```

## Configuration

### vercel.json

The `vercel.json` file is already configured with:
- Build settings
- API proxy rewrites (`/api/*` → `/api/proxy/*`)
- SPA routing fallback
- CORS headers

### API Proxy Function

The `api/proxy.ts` file handles proxying requests to your TCL Core service. It:
- Forwards all `/api/*` requests to your TCL Core service
- Handles CORS
- Uses the `VERCEL_TCL_CORE_URL` environment variable

## Environment Variables

Set these in Vercel dashboard → Project Settings → Environment Variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `VERCEL_TCL_CORE_URL` | URL of your TCL Core service | Yes |
| `TCL_CORE_URL` | Alternative name (also supported) | No |

**Example**: `https://tcl-core.railway.app`

## Monorepo Setup

If your project is a monorepo (like this one), you have two options:

### Option 1: Deploy from UI directory

1. In Vercel, set **Root Directory** to `packages/tcl-ui`
2. Vercel will automatically detect it's an Angular app

### Option 2: Use Vercel's monorepo support

1. Keep root directory as `.`
2. Set **Root Directory** to `packages/tcl-ui` in project settings
3. Vercel will handle the monorepo structure

## How It Works

1. **Build**: Vercel runs `npm run build` in `packages/tcl-ui`
2. **Deploy**: Serves files from `dist/tcl-ui/browser`
3. **API Proxy**: Requests to `/api/*` are handled by `api/proxy.ts`
4. **SPA Routing**: All routes serve `index.html` for client-side routing

## Testing After Deployment

1. Visit your Vercel URL (e.g., `https://your-app.vercel.app`)
2. Enter a question and answer in the UI
3. Check browser console for errors
4. Check Vercel Function logs if API calls fail

## Troubleshooting

### Build Fails

- Check that all dependencies are in `package.json`
- Verify build works locally: `npm run build`
- Check Vercel build logs for specific errors

### API Not Working

- Verify `VERCEL_TCL_CORE_URL` is set correctly
- Check Vercel Function logs in dashboard
- Ensure your TCL Core service is publicly accessible
- Test the proxy function directly: `https://your-app.vercel.app/api/proxy/validate`

### 404 Errors

- The SPA redirect should handle this
- Verify `vercel.json` has the catch-all rewrite rule
- Check that `index.html` is in the output directory

### CORS Errors

- The proxy function handles CORS automatically
- Check that the proxy function is being called (check Network tab)
- Verify environment variable is set

## Continuous Deployment

Once connected to Git:
- Every push to `main` = production deploy
- Every push to other branches = preview deploy
- Vercel automatically rebuilds on each push

## Custom Domain

1. Go to Project Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions
4. Vercel provides free SSL certificates

## Performance

Vercel automatically:
- Serves your app from a global CDN
- Optimizes images (if you add any)
- Provides analytics
- Handles serverless functions efficiently

## Cost

Vercel's free tier includes:
- Unlimited personal projects
- 100GB bandwidth/month
- 100 serverless function invocations/day
- Perfect for demos and small projects

For production with high traffic, see [Vercel pricing](https://vercel.com/pricing).

