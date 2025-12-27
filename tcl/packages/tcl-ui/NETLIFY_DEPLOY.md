# Deploying TCL UI to Netlify

This guide will help you deploy the Angular UI to Netlify.

## Quick Deploy Steps

1. **Push your code to Git** (GitHub, GitLab, or Bitbucket)
2. **Connect to Netlify**: Go to [Netlify](https://app.netlify.com) → "Add new site" → "Import an existing project"
3. **Set Environment Variable**: In Netlify dashboard → Site settings → Environment variables:
   - Key: `NETLIFY_TCL_CORE_URL`
   - Value: `https://your-tcl-core-service.com` (your TCL Core service URL)
4. **Deploy**: Netlify will automatically build and deploy!

## Prerequisites

1. A Netlify account (free tier works)
2. The TCL Core service running somewhere accessible (Heroku, Railway, Render, etc.)
3. Git repository (GitHub, GitLab, or Bitbucket)

## Option 1: Deploy with External TCL Core Service

If your TCL Core service is running on a separate server (e.g., Heroku, Railway, or your own server):

### Step 1: Build Configuration

The `netlify.toml` file is already configured. Make sure your build settings are:

- **Build command**: `npm run build`
- **Publish directory**: `dist/tcl-ui/browser`

### Step 2: Environment Variables

In your Netlify dashboard, go to **Site settings** → **Environment variables** and add:

```
NETLIFY_TCL_CORE_URL=https://your-tcl-core-service.com
```

This tells the proxy function where to forward API requests.

### Step 3: Deploy

1. Connect your Git repository to Netlify
2. Netlify will automatically detect the `netlify.toml` file
3. Deploy!

## Option 2: Deploy with Netlify Functions (Proxy)

The included proxy function will forward requests to your TCL Core service.

### Setup

1. The `netlify/functions/proxy.js` file is already created
2. Set `NETLIFY_TCL_CORE_URL` environment variable in Netlify dashboard
3. Deploy - Netlify will automatically use the function

## Option 3: Manual Deployment

If you want to deploy manually:

```bash
cd packages/tcl-ui

# Build the app
npm run build

# Deploy using Netlify CLI
npm install -g netlify-cli
netlify deploy --prod --dir=dist/tcl-ui/browser
```

## Configuration Details

### netlify.toml

- Builds the Angular app
- Publishes from `dist/tcl-ui/browser`
- Redirects `/api/*` to the proxy function
- Handles SPA routing with fallback to `index.html`

### Proxy Function

The proxy function (`netlify/functions/proxy.js`) forwards all `/api/*` requests to your TCL Core service. This allows the UI to communicate with the backend without CORS issues.

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `NETLIFY_TCL_CORE_URL` | URL of your TCL Core service (e.g., `https://tcl-core.herokuapp.com`) | Yes |

## Troubleshooting

### CORS Errors

If you see CORS errors, make sure:
1. The proxy function is working (check Netlify Functions logs)
2. `NETLIFY_TCL_CORE_URL` is set correctly
3. Your TCL Core service allows requests from your Netlify domain

### 404 on Routes

The `netlify.toml` includes a catch-all redirect to `index.html` for SPA routing. If you still see 404s:
- Check that the redirect is in place
- Verify the publish directory is correct

### Build Failures

- Make sure all dependencies are in `package.json`
- Check that Angular build completes locally: `npm run build`
- Review Netlify build logs for specific errors

### API Not Working

1. Check Netlify Functions logs in the dashboard
2. Verify `NETLIFY_TCL_CORE_URL` is set
3. Test the proxy function directly: `https://your-site.netlify.app/.netlify/functions/proxy/validate`
4. Ensure your TCL Core service is accessible from the internet

## Alternative: Direct API URL

If you prefer not to use the proxy, you can set the API URL directly in the UI:

1. Add a script tag in `index.html`:
```html
<script>
  window.__TCL_API_URL = 'https://your-tcl-core-service.com';
</script>
```

2. Or use Netlify's environment variable injection (requires build-time configuration)

## Continuous Deployment

Once connected to Git:
- Every push to `main` branch = production deploy
- Every push to other branches = preview deploy
- Netlify will automatically rebuild on each push

## Performance Tips

1. Enable Netlify's CDN caching
2. Use Netlify's image optimization if you add images
3. Enable Brotli compression in Netlify settings
4. Consider using Netlify Edge Functions for faster API proxying

