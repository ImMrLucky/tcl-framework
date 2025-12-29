# TCL Integrations Service

Enterprise-grade integration layer for ProtectQA. Decoupled from TCL Core engine to enable flexible usage.

## Features

- **Artifact-based ingestion** - Multi-format conversation artifacts
- **Real-time ingestion** - Streaming chat/text support
- **Webhook security** - HMAC signature verification
- **Export connectors** - Slack, Teams, webhook exports
- **Retry infrastructure** - Exponential backoff for failed deliveries
- **Idempotency** - Prevents duplicate processing

## Architecture

```
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Integrations    │  ← Decoupled service
│ Service (8788)  │
└──────┬──────────┘
       │
       ├──► Supabase (DB)
       │
       └──► TCL Core (8787) ← Only for evaluation triggers
```

## Database Schema

Run migrations:
1. `supabase/sql/005_integrations_schema.sql`
2. `supabase/sql/006_integrations_rls.sql`

## API Endpoints

### Webhook Ingest v2
```
POST /webhooks/:path_token
Headers:
  X-ProtectQA-Timestamp: <timestamp>
  X-ProtectQA-Signature: sha256=<hex>
```

### Real-time Ingestion
```
POST /v1/realtime/sessions/start
POST /v1/realtime/sessions/:id/chunk
POST /v1/realtime/sessions/:id/finalize
```

### Integration Management
```
GET /integrations
POST /integrations
```

## Environment Variables

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
TCL_CORE_URL=http://localhost:8787
PORT=8788
FRONTEND_URL=https://app.protectqa.com
```

## Development

```bash
cd packages/tcl-integrations
npm install
npm run dev
```

## Connectors

### Implemented
- Webhook Export
- Slack Alerts

### Planned
- Teams Alerts
- S3 Drop Ingest
- Zendesk (beta)
- Salesforce (beta)
- Dropbox (beta)
- Amazon Connect (beta)

