# Quick Vercel Deployment

## 3-Step Deployment

### 1. Push to Git
```bash
git add .
git commit -m "Ready for Vercel deployment"
git push
```

### 2. Deploy on Vercel

**Option A: Web Interface (Easiest)**
1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New Project"
3. Import your Git repository
4. Configure:
   - **Framework**: Angular (auto-detected)
   - **Root Directory**: `packages/tcl-ui` (if monorepo)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist/tcl-ui/browser` (auto-detected)
5. Click "Deploy"

**Option B: CLI**
```bash
cd packages/tcl-ui
npm install -g vercel
vercel login
vercel
```

### 3. Set Environment Variable

In Vercel dashboard:
- Go to **Project Settings** → **Environment Variables**
- Add:
  - **Key**: `VERCEL_TCL_CORE_URL`
  - **Value**: Your TCL Core URL (e.g., `https://tcl-core.railway.app`)
- Click "Save"

**Redeploy** after adding the environment variable (Vercel will prompt you).

## That's It! 🎉

Your app will be live at `https://your-project.vercel.app`

## What Happens

- ✅ Angular app builds automatically
- ✅ `/api/*` requests proxy to your TCL Core service
- ✅ SPA routing works (all routes serve `index.html`)
- ✅ CORS handled automatically

## Testing

1. Visit your Vercel URL
2. Enter a question and answer
3. Click "Validate"
4. Check browser console if issues

## Troubleshooting

**Build fails?**
- Check Vercel build logs
- Ensure `package.json` has all dependencies
- Try building locally: `npm run build`

**API not working?**
- Verify `VERCEL_TCL_CORE_URL` is set
- Check Vercel Function logs
- Test: `https://your-app.vercel.app/api/proxy/validate`

**Need help?** Check `VERCEL_DEPLOY.md` for detailed guide.

