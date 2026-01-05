# Quick Railway Deployment for TCL Core

## 3-Step Deployment

### 1. Push to GitHub
```bash
git add .
git commit -m "Ready for Railway deployment"
git push
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your repository
5. Railway will auto-detect Node.js

### 3. Configure

1. **Set Root Directory**:
   - Click on your service
   - Settings → Root Directory
   - Set to: `packages/tcl-core`

2. **Set Environment Variables**:
   - Click on your service → Variables
   - Add:
     - `PORT` = `8787` (optional, Railway auto-assigns)
     - `TCL_SPECTRAL_URL` = `http://your-spectral:8080` (if using)
     - `OPENAI_API_KEY` = `your-key` (if using)
     - **CRITICAL for Audio Transcription:**
       - `USE_WASM` = `1`
       - `ONNXRUNTIME_DISABLE_NATIVE` = `1`
       - `TRANSFORMERS_USE_WASM` = `1`
       - `USE_BROWSER` = `0`
       - `USE_WASM_ONLY` = `1`

3. **Get Your URL**:
   - Click on your service → Settings
   - Copy the **Public Domain** (e.g., `tcl-core-production.up.railway.app`)

### That's It! 🎉

Your TCL Core is now live at: `https://your-app.up.railway.app`

## Update Netlify

In your Netlify dashboard:
- Go to **Environment Variables**
- Set `NETLIFY_TCL_CORE_URL` = `https://your-app.up.railway.app`

## Testing

Test your deployment:
```bash
curl https://your-app.up.railway.app/validate
```

Should return an error (expected - needs POST with body), but confirms it's running!

## Troubleshooting

**Service won't start?**
- Check Railway logs
- Verify Root Directory is `packages/tcl-core`
- Ensure `package.json` has all dependencies

**Can't connect from Netlify?**
- Verify Railway service is running (green status)
- Check the public domain URL
- Ensure no firewall blocking

**Need help?** Check `DEPLOY.md` for detailed guide.

