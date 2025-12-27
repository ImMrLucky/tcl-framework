# Quick Netlify Deployment Guide

## 3-Step Deployment

### 1. Connect Your Repository

1. Go to [Netlify](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect your Git provider (GitHub/GitLab/Bitbucket)
4. Select your repository
5. Netlify will auto-detect the `netlify.toml` configuration

### 2. Set Environment Variable

In Netlify dashboard:
- Go to **Site settings** → **Environment variables**
- Click "Add a variable"
- Key: `NETLIFY_TCL_CORE_URL`
- Value: Your TCL Core service URL (e.g., `https://tcl-core.herokuapp.com`)
- Click "Save"

### 3. Deploy!

Netlify will automatically:
- Install dependencies (`npm install`)
- Build the app (`npm run build`)
- Deploy to CDN

Your site will be live at `https://your-site-name.netlify.app`

## What Happens

1. **Build**: Angular app compiles to `dist/tcl-ui/browser`
2. **Proxy**: All `/api/*` requests are forwarded to your TCL Core service via Netlify Function
3. **SPA Routing**: All routes serve `index.html` for client-side routing

## Testing

After deployment:
1. Visit your Netlify URL
2. Try entering a question and answer
3. Check browser console for any errors
4. Check Netlify Functions logs if API calls fail

## Troubleshooting

**API not working?**
- Verify `NETLIFY_TCL_CORE_URL` is set correctly
- Check Netlify Functions logs in dashboard
- Ensure your TCL Core service is publicly accessible

**Build fails?**
- Check build logs in Netlify dashboard
- Ensure all dependencies are in `package.json`
- Try building locally: `npm run build`

**404 errors?**
- The SPA redirect should handle this
- Check that `netlify.toml` redirects are in place

