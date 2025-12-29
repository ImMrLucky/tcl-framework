# Installation Guide - Server Deployment

## Prerequisites

- Node.js 18+ installed on server
- npm or yarn package manager
- Access to Supabase database (migrations run)

## Installation Steps

### 1. Navigate to Integration Service Directory

```bash
cd packages/tcl-integrations
```

### 2. Install Dependencies

```bash
npm install
```

Or if using yarn:

```bash
yarn install
```

### 3. Build TypeScript

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### 4. Set Environment Variables

**Option A: Use existing .env from tcl-core folder**

If you already have a `.env` file in `packages/tcl-core/` with Supabase config:

```bash
# Load Supabase vars from tcl-core .env
export $(cat ../tcl-core/.env | grep -E 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY' | xargs)

# Set TCL Core URL (points to TCL Core service on port 8787, NOT Spectral on 8080)
export TCL_CORE_URL="http://your-tcl-core-host:8787"
export PORT=8788
```

**Option B: Create new .env file**

```bash
# Copy Supabase config from tcl-core
cp ../tcl-core/.env .env

# Add TCL_CORE_URL (edit .env file)
# TCL_CORE_URL should point to TCL Core service (port 8787)
# NOT TCL_SPECTRAL_URL (port 8080)
echo "TCL_CORE_URL=http://your-tcl-core-host:8787" >> .env
echo "PORT=8788" >> .env
```

**Option C: Set directly**

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export TCL_CORE_URL="http://your-tcl-core-host:8787"  # TCL Core (port 8787), NOT Spectral
export PORT=8788
```

**Important:** 
- `TCL_CORE_URL` = TCL Core service (port 8787) - **This is what you need**
- `TCL_SPECTRAL_URL` = Spectral service (port 8080) - Used by TCL Core internally, not needed here

### 5. Run Database Migrations

Make sure you've run the SQL migrations in Supabase:

1. `supabase/sql/005_integrations_schema.sql`
2. `supabase/sql/006_integrations_rls.sql`

### 6. Start the Service

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Or use PM2 for process management:

```bash
npm install -g pm2
pm2 start dist/server/express.js --name tcl-integrations
pm2 save
pm2 startup
```

## Docker Deployment

If using Docker:

### 1. Build Docker Image

```bash
docker build -t tcl-integrations .
```

### 2. Run Container

```bash
docker run -d \
  --name tcl-integrations \
  -p 8788:8788 \
  -e SUPABASE_URL="https://your-project.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  -e TCL_CORE_URL="http://tcl-core:8787" \
  -e PORT=8788 \
  tcl-integrations
```

## Production Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] TypeScript compiled (`npm run build`)
- [ ] Environment variables set
- [ ] Database migrations run
- [ ] Service starts without errors
- [ ] Health check endpoint responds: `GET http://your-server:8788/health`
- [ ] Process manager configured (PM2, systemd, etc.)
- [ ] Logging configured
- [ ] Monitoring set up

## Troubleshooting

### Missing Dependencies

If you get "module not found" errors:

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Build Errors

```bash
# Check TypeScript version
npx tsc --version

# Should be 5.6.3 or compatible
# If not, update:
npm install typescript@^5.6.3 --save-dev
```

### Port Already in Use

```bash
# Check what's using port 8788
lsof -i :8788

# Kill process or change PORT in .env
export PORT=8789
```

### Database Connection Issues

- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
- Check Supabase project is active
- Verify migrations have been run
- Test connection: `curl https://your-project.supabase.co/rest/v1/`

## Quick Start Script

```bash
#!/bin/bash
# install.sh

echo "Installing dependencies..."
npm install

echo "Building TypeScript..."
npm run build

echo "Checking environment variables..."
if [ -z "$SUPABASE_URL" ]; then
  echo "ERROR: SUPABASE_URL not set"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY not set"
  exit 1
fi

echo "Installation complete!"
echo "Start service with: npm start"
```

Make it executable:
```bash
chmod +x install.sh
./install.sh
```

