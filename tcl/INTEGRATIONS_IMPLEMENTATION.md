# Integration Layer Implementation

## Overview

A decoupled integration service that handles ingestion, exports, and connectors without tight coupling to TCL Core. This allows the TCL engine to be used independently while providing enterprise-grade integration capabilities.

## Architecture

```
┌─────────────┐
│   Angular   │  Frontend
│     UI      │
└──────┬──────┘
       │ REST API
       ▼
┌─────────────────┐
│  Integrations   │  Port 8788
│    Service      │  (Separate from TCL Core)
└──────┬──────────┘
       │
       ├──► Supabase (PostgreSQL)
       │    - conversations
       │    - conversation_artifacts
       │    - integrations
       │    - evidence_sources
       │    - delivery_attempts
       │
       └──► TCL Core (Port 8787)
            - Only called for evaluation triggers
            - No tight coupling
```

## Database Schema

### New Tables

1. **conversation_artifacts** - Multi-format artifacts (transcript, chat, audio, attachments)
2. **evidence_sources** - Document sources for claim verification
3. **evidence_artifacts** - Parsed evidence documents
4. **integrations** - Integration configurations
5. **webhook_tokens** - Secure webhook path tokens
6. **realtime_sessions** - Real-time ingestion sessions
7. **delivery_attempts** - Export retry tracking
8. **idempotency_keys** - Prevents duplicate processing

### Migrations

Run in order:
1. `supabase/sql/005_integrations_schema.sql` - Creates all tables
2. `supabase/sql/006_integrations_rls.sql` - Row Level Security policies

## API Endpoints

### Webhook Ingest v2
```
POST /webhooks/:path_token
Headers:
  X-ProtectQA-Timestamp: <unix_timestamp_ms>
  X-ProtectQA-Signature: sha256=<hex>

Body:
{
  "external_id": "unique-id",
  "channel": "call|chat|email|other",
  "title": "optional",
  "artifacts": [
    {
      "type": "transcript_text",
      "text": "Agent: ... Customer: ..."
    },
    {
      "type": "chat_messages",
      "messages": [...]
    },
    {
      "type": "audio_recording",
      "storage_ref": {"provider": "s3", "bucket": "...", "key": "..."}
    }
  ],
  "meta": {...},
  "auto_start_evaluation": true
}
```

### Real-time Ingestion

**Start Session:**
```
POST /v1/realtime/sessions/start
{
  "channel": "chat",
  "meta": {"agent_id": "A1"}
}
```

**Add Chunk:**
```
POST /v1/realtime/sessions/:id/chunk
{
  "type": "chat_messages",
  "messages": [{"ts": "ISO", "author": "agent", "text": "..."}]
}
```

**Finalize:**
```
POST /v1/realtime/sessions/:id/finalize
{
  "auto_start_evaluation": true
}
```

### Integration Management

```
GET /integrations - List all integrations
POST /integrations - Create new integration
```

## Security

### HMAC Signature Verification

All webhook requests must include:
- `X-ProtectQA-Timestamp`: Unix timestamp in milliseconds
- `X-ProtectQA-Signature`: `sha256=<hex>`

**Algorithm:**
```
HMAC_SHA256(secret, timestamp + "." + raw_body)
```

**Validation:**
- Signature must match
- Timestamp must be within 5 minutes
- Reject if either fails

## Connector Framework

### Base Classes

- `BaseConnector` - Abstract base class
- `IngestConnector` - For bringing data in
- `ExportConnector` - For sending data out

### Implemented Connectors

1. **Webhook Export** - Generic webhook delivery with retries
2. **Slack Alerts** - Incoming webhook with rich formatting

### Planned Connectors

- Teams Alerts
- S3 Drop Ingest
- Zendesk (beta)
- Salesforce (beta)
- Dropbox (beta)
- Amazon Connect (beta)

## Artifact Processing

### Supported Types

- `transcript_text` - Plain text transcript
- `chat_messages` - Structured chat messages
- `email_thread` - Email conversation
- `audio_recording` - Reference to audio file
- `attachment` - File attachments
- `evidence_doc` - Evidence documents

### Normalization

- Chat messages → normalized transcript format
- Multiple artifacts → conversation.raw_text from best available
- Idempotency via `provider + external_id` hash

## Retry Infrastructure

### Delivery Attempts

All exports create `delivery_attempts` records:
- Exponential backoff: `2^attempt_number` seconds
- Max attempts: 10
- Status: `pending` → `retrying` → `success`/`failed`

### Worker Pattern

```typescript
// Poll for retries
SELECT * FROM delivery_attempts
WHERE status = 'retrying'
AND next_retry_at <= NOW()
LIMIT 100;
```

## Integration with TCL Core

**Decoupled Design:**
- Integrations service calls TCL Core API for evaluations
- No shared code or tight coupling
- TCL Core can be used independently
- Integration service can be scaled separately

**Evaluation Trigger:**
```typescript
POST ${TCL_CORE_URL}/validate
{
  "question": conversation.raw_text,
  "answer": "",
  "sources": [],
  "options": {}
}
```

## Frontend Integration

### Pages Needed

1. `/app/integrations` - List and manage integrations
2. `/app/integrations/new` - Add integration wizard
3. `/app/integrations/deliveries` - View delivery attempts

### Components

- Integration list component
- Integration form component
- Delivery attempts table
- Connector configuration forms

## Implementation Status

✅ **Completed:**
- Database schema and migrations
- Integration service structure
- Webhook ingest v2 with HMAC
- Real-time ingestion endpoints
- Connector framework
- Webhook export connector
- Slack alert connector
- Artifact processing
- Idempotency tracking

🚧 **In Progress:**
- Teams alert connector

⏳ **Pending:**
- S3 Drop ingest
- Evidence document parsing
- Frontend UI
- Zendesk/Salesforce/Dropbox connectors
- Amazon Connect preset

## Environment Variables

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx

# Services
TCL_CORE_URL=http://localhost:8787
PORT=8788

# Frontend
FRONTEND_URL=https://app.protectqa.com
```

## Development

```bash
# Install dependencies
cd packages/tcl-integrations
npm install

# Run development server
npm run dev

# Build
npm run build

# Start production
npm start
```

## Testing

### Webhook Ingest Test

```bash
curl -X POST http://localhost:8788/webhooks/YOUR_PATH_TOKEN \
  -H "Content-Type: application/json" \
  -H "X-ProtectQA-Timestamp: $(date +%s)000" \
  -H "X-ProtectQA-Signature: sha256=..." \
  -d '{
    "external_id": "test-123",
    "channel": "chat",
    "artifacts": [{
      "type": "transcript_text",
      "text": "Agent: Hello\nCustomer: Hi"
    }]
  }'
```

## Next Steps

1. Complete Teams alert connector
2. Implement S3 Drop ingest
3. Add evidence document parsing (TXT/JSON/CSV/XLSX)
4. Build frontend integration management UI
5. Add beta connectors (Zendesk, Salesforce, Dropbox)
6. Implement Amazon Connect preset
7. Add retry worker for delivery attempts
8. Add monitoring and observability

