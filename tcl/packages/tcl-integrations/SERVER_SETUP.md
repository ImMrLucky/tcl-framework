# Server Setup Guide - TCL Integrations Service

## Environment Variables

The integration service needs these environment variables. You can either:

1. **Use your existing `.env` file from `tcl-core` folder** (if it has the Supabase config)
2. **Create a new `.env` file** in `packages/tcl-integrations/`
3. **Set environment variables directly** on your server

### Required Variables

```bash
# Supabase (same as tcl-core uses)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# TCL Core Service URL (NOT Spectral URL)
# This should point to your TCL Core service (port 8787)
TCL_CORE_URL=http://your-tcl-core-service:8787
# OR use TCL_API_URL as an alias
TCL_API_URL=http://your-tcl-core-service:8787

# Integration Service Port
PORT=8788

# Frontend URL (for webhook links)
FRONTEND_URL=https://app.protectqa.com
```

### Important: TCL_CORE_URL vs TCL_SPECTRAL_URL

- **TCL_SPECTRAL_URL** (port 8080) - Points to the Spectral analysis service (Python/FastAPI)
  - Used by TCL Core internally for spectral analysis
  - You don't need this for the integration service

- **TCL_CORE_URL** (port 8787) - Points to the TCL Core validation service (Node.js/Express)
  - This is what the integration service calls to trigger evaluations
  - **This is what you need to set**

## Installation on Server

### Option 1: Use Existing .env from tcl-core

If your `.env` file is in `packages/tcl-core/`, you can:

```bash
# Navigate to integrations folder
cd packages/tcl-integrations

# Install dependencies
npm install

# Build
npm run build

# Set environment variables (reference the tcl-core .env)
export $(cat ../tcl-core/.env | grep -E 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY' | xargs)
export TCL_CORE_URL="http://your-tcl-core-host:8787"
export PORT=8788

# Start service
npm start
```

### Option 2: Create New .env File

```bash
cd packages/tcl-integrations

# Copy your Supabase config from tcl-core
cp ../tcl-core/.env .env

# Add TCL_CORE_URL (edit .env file)
echo "TCL_CORE_URL=http://your-tcl-core-host:8787" >> .env
echo "PORT=8788" >> .env

# Install and build
npm install
npm run build

# Start (you'll need dotenv package to load .env)
npm install dotenv
# Then modify package.json start script to load .env
```

### Option 3: Set Environment Variables Directly

```bash
cd packages/tcl-integrations

# Install and build
npm install
npm run build

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-key"
export TCL_CORE_URL="http://your-tcl-core-host:8787"
export PORT=8788

# Start service
npm start
```

## Using dotenv (Recommended)

To automatically load `.env` files:

```bash
npm install dotenv
```

Then create `src/server/express.ts` with dotenv at the top:

```typescript
import 'dotenv/config'; // Add this at the very top
import express from 'express';
// ... rest of code
```

Or modify `package.json`:

```json
{
  "scripts": {
    "start": "node -r dotenv/config dist/server/express.js"
  }
}
```

## Verifying Setup

1. **Check environment variables are loaded:**
```bash
node -e "console.log(process.env.SUPABASE_URL)"
```

2. **Test health endpoint:**
```bash
curl http://localhost:8788/health
# Should return: {"status":"ok","service":"tcl-integrations"}
```

3. **Check TCL Core is accessible:**
```bash
curl http://your-tcl-core-host:8787/health
# Should return: {"status":"ok","service":"tcl-core"}
```

## Production Deployment

### Using PM2

```bash
# Install PM2 globally
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'tcl-integrations',
    script: 'dist/server/express.js',
    env: {
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://your-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'your-key',
      TCL_CORE_URL: 'http://your-tcl-core-host:8787',
      PORT: 8788
    }
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Using systemd

Create `/etc/systemd/system/tcl-integrations.service`:

```ini
[Unit]
Description=TCL Integrations Service
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/packages/tcl-integrations
Environment="SUPABASE_URL=https://your-project.supabase.co"
Environment="SUPABASE_SERVICE_ROLE_KEY=your-key"
Environment="TCL_CORE_URL=http://your-tcl-core-host:8787"
Environment="PORT=8788"
ExecStart=/usr/bin/node dist/server/express.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable tcl-integrations
sudo systemctl start tcl-integrations
```

## Troubleshooting

### "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"

- Check environment variables are set: `echo $SUPABASE_URL`
- If using .env file, ensure dotenv is installed and configured
- Verify .env file is in the correct location

### "Cannot connect to TCL Core"

- Verify TCL_CORE_URL points to port 8787 (not 8080)
- Check TCL Core service is running: `curl http://your-tcl-core-host:8787/health`
- Ensure network/firewall allows connection

### Port Already in Use

```bash
# Find what's using port 8788
lsof -i :8788

# Kill process or change PORT
export PORT=8789
```

