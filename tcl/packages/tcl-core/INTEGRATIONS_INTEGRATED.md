# Integration Endpoints - Integrated into TCL Core

## Overview

The integration endpoints are now **integrated into the TCL Core Express server** instead of running as a separate service. This means:

✅ **One Railway service** - No need for separate deployment  
✅ **Same port (8787)** - All endpoints on one server  
✅ **Simpler setup** - One environment, one deployment  
✅ **Still modular** - Code is separated in `src/server/integrations/`  

## Architecture

```
┌─────────────────────────┐
│   TCL Core Express      │
│   Port: 8787            │
│                         │
│   /validate             │ ← Existing TCL endpoints
│   /validate/batch       │
│   /conversations        │
│   ...                   │
│                         │
│   /webhooks/:token      │ ← NEW: Integration endpoints
│   /v1/realtime/...      │
│   /integrations         │
└─────────────────────────┘
```

## New Endpoints

All integration endpoints are now available on the same TCL Core server:

- `POST /webhooks/:path_token` - Webhook ingest v2
- `POST /v1/realtime/sessions/start` - Start real-time session
- `POST /v1/realtime/sessions/:id/chunk` - Add chunk to session
- `POST /v1/realtime/sessions/:id/finalize` - Finalize session
- `GET /integrations` - List integrations
- `POST /integrations` - Create integration

## Installation

### 1. Install Dependencies

The integration dependencies are now in `tcl-core/package.json`:

```bash
cd packages/tcl-core
npm install
```

New dependencies added:
- `aws-sdk` - For S3 connectors (future)
- `form-data` - For file uploads
- `node-fetch` - For HTTP requests

### 2. Build

```bash
npm run build
```

### 3. Deploy

Just deploy your existing TCL Core service - the integration endpoints are included automatically!

## Database Migrations

You still need to run the integration schema migrations:

1. `supabase/sql/005_integrations_schema.sql`
2. `supabase/sql/006_integrations_rls.sql`

## Code Structure

Integration code is in `src/server/integrations/`:

```
src/server/integrations/
├── routes.ts           # Main route setup
├── types.ts            # TypeScript types
├── security/
│   └── hmac.ts         # HMAC signature verification
└── artifacts/
    └── processor.ts    # Artifact processing
```

The routes are **lazy-loaded** - if there's an error, the service still starts (integrations are optional).

## Environment Variables

No new environment variables needed! Uses the same Supabase config as TCL Core.

## Testing

```bash
# Health check (existing)
curl https://your-tcl-core.railway.app/health

# Integration endpoints (new)
curl https://your-tcl-core.railway.app/webhooks/YOUR_TOKEN
curl https://your-tcl-core.railway.app/integrations
```

## Benefits

1. **Simpler deployment** - One service instead of two
2. **Lower cost** - One Railway service instead of two
3. **Easier maintenance** - One codebase, one deployment
4. **Still modular** - Code is separated, can be extracted later if needed

## Migration from Separate Service

If you already set up a separate integrations service, you can:

1. **Keep it separate** - Both approaches work
2. **Migrate to integrated** - Just deploy the updated tcl-core
3. **Run both** - If you need them on different ports for some reason

The integrated approach is recommended for simplicity.

