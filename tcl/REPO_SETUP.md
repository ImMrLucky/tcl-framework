# Repository Setup Guide

## Option 1: Single Monorepo (Recommended) ✅

**Keep everything in one repository** - this is the easiest and most common approach.

### Structure
```
tcl/
├── packages/
│   ├── tcl-core/      ← Deploy to Railway
│   ├── tcl-ui/        ← Deploy to Netlify
│   └── tcl-spectral/  ← Deploy separately (if needed)
└── README.md
```

### How to Deploy

#### Netlify (TCL UI)
1. Connect your repo to Netlify
2. In Netlify project settings:
   - **Root Directory**: `packages/tcl-ui`
   - Build command: `npm run build` (auto-detected)
   - Output directory: `dist/tcl-ui/browser` (auto-detected)

#### Railway (TCL Core)
1. Connect your repo to Railway
2. In Railway service settings:
   - **Root Directory**: `packages/tcl-core`
   - Start command: `npm run dev` (or `npm start` for production)

### Benefits
- ✅ Single source of truth
- ✅ Easier to manage versions
- ✅ Share types/code between packages (if needed)
- ✅ One Git repository to maintain

## Option 2: Separate Repositories

If you prefer separate repos:

### Setup
1. **Create `tcl-core` repo**:
   ```bash
   # Copy tcl-core to new repo
   cp -r packages/tcl-core /path/to/tcl-core-repo
   cd /path/to/tcl-core-repo
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-tcl-core-repo-url>
   git push -u origin main
   ```

2. **Create `tcl-ui` repo**:
   ```bash
   # Copy tcl-ui to new repo
   cp -r packages/tcl-ui /path/to/tcl-ui-repo
   cd /path/to/tcl-ui-repo
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-tcl-ui-repo-url>
   git push -u origin main
   ```

### Deploy
- **Netlify**: Connect `tcl-ui` repo (no root directory needed)
- **Railway**: Connect `tcl-core` repo (no root directory needed)

### When to Use
- Different teams own each service
- Different deployment schedules
- Want complete separation

## Recommended: Monorepo Setup

**Keep it as one repo!** Here's the exact setup:

### Current Structure (Perfect!)
```
tcl/
├── packages/
│   ├── tcl-core/
│   │   ├── package.json
│   │   ├── src/
│   │   └── railway.json
│   ├── tcl-ui/
│   │   ├── package.json
│   │   ├── src/
│   │   └── netlify.toml
│   └── tcl-spectral/
└── README.md
```

### Deployment Steps

#### 1. Netlify Setup
- Repository: `your-org/tcl` (the monorepo)
- Root Directory: `packages/tcl-ui`
- Build Command: `npm run build` (runs in packages/tcl-ui)
- Output Directory: `dist/tcl-ui/browser`

#### 2. Railway Setup
- Repository: `your-org/tcl` (same monorepo)
- Root Directory: `packages/tcl-core`
- Start Command: `npm run dev` or `npm start`

### Environment Variables

#### Netlify
- `NETLIFY_TCL_CORE_URL` = `https://your-railway-app.up.railway.app`

#### Railway
- `TCL_SPECTRAL_URL` = `http://your-spectral:8080` (if using)
- `OPENAI_API_KEY` = `your-key` (if using)

## Git Workflow

With monorepo, you can:

```bash
# Make changes to both UI and Core
git add packages/tcl-ui packages/tcl-core
git commit -m "Update UI and Core"
git push

# Both Netlify and Railway will auto-deploy!
```

## Troubleshooting

### Netlify can't find files
- Verify Root Directory is set to `packages/tcl-ui`
- Check that `netlify.toml` is in `packages/tcl-ui/`

### Railway can't find files
- Verify Root Directory is set to `packages/tcl-core`
- Check that `package.json` exists in `packages/tcl-core/`

### Build fails
- Ensure each package has its own `node_modules` (they do)
- Check that dependencies are in each package's `package.json`

## Summary

**✅ Recommended: Keep one monorepo**

Just set the **Root Directory** in each service:
- Netlify → `packages/tcl-ui`
- Railway → `packages/tcl-core`

That's it! No need to split repos.

