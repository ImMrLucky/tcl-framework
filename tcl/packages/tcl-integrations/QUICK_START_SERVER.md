# Quick Start - Server Installation

## If you already have a .env file in tcl-core folder

Your existing `.env` file in `packages/tcl-core/` should have:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`)
- `TCL_SPECTRAL_URL` (for Spectral service on port 8080)

## Installation Steps

```bash
# 1. Navigate to integrations folder
cd packages/tcl-integrations

# 2. Install dependencies (includes dotenv for .env support)
npm install

# 3. Build TypeScript
npm run build

# 4. Set environment variables
# Option A: Reference existing tcl-core .env
export $(cat ../tcl-core/.env | grep -E 'SUPABASE_URL|SUPABASE_SERVICE' | xargs)

# Option B: Or create a symlink to reuse the same .env
ln -s ../tcl-core/.env .env

# 5. Set TCL_CORE_URL (this is NEW - points to TCL Core service)
# TCL_CORE_URL should point to your TCL Core service (port 8787)
# NOT TCL_SPECTRAL_URL (port 8080)
export TCL_CORE_URL="http://your-tcl-core-host:8787"
export PORT=8788

# 6. Start service
npm start
```

## Environment Variables Explained

| Variable | Purpose | Port | Used By |
|----------|---------|------|---------|
| `TCL_SPECTRAL_URL` | Spectral analysis service | 8080 | TCL Core (internally) |
| `TCL_CORE_URL` | TCL Core validation service | 8787 | Integration Service (to trigger evaluations) |
| `SUPABASE_URL` | Supabase database | - | Both services |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key | - | Both services |

## Using .env File

The service now supports `.env` files automatically (via dotenv):

```bash
# Create .env in tcl-integrations folder
cat > .env << EOF
# Copy from tcl-core .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key

# Add new variable for TCL Core
TCL_CORE_URL=http://your-tcl-core-host:8787
PORT=8788
EOF

# Then just start (dotenv loads automatically)
npm start
```

## Verify Installation

```bash
# Test health endpoint
curl http://localhost:8788/health
# Should return: {"status":"ok","service":"tcl-integrations"}

# Check environment variables loaded
node -e "console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'NOT SET')"
```

## Common Issues

**"Missing SUPABASE_URL"**
- Ensure .env file exists or environment variables are set
- Check dotenv is installed: `npm list dotenv`

**"Cannot connect to TCL Core"**
- Verify `TCL_CORE_URL` points to port 8787 (not 8080)
- Test TCL Core: `curl http://your-tcl-core-host:8787/health`

