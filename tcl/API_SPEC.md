# ProtectQA REST API Specification

**API-First Architecture**: All business logic lives in the backend. Frontend and SDKs are thin clients that call these endpoints.

**Base URL**: `https://api.protectqa.com` (or localhost for development)

**Authentication**: 
- API Key: `Authorization: Bearer pq_live_...`
- User Session: `Authorization: Bearer <supabase_jwt>` (future)

---

## Core Validation Endpoints

### POST /validate

Execute a single validation/evaluation.

**Request:**
```json
{
  "question": "What is your return policy?",
  "answer": "We accept returns within 30 days.",
  "options": {
    "cache": { "enabled": false },
    "sources": []
  }
}
```

**Response:**
```json
{
  "id": "eval_123",
  "scores": {
    "truth": 85,
    "consistency": 90,
    "coherence": 88,
    "overall": 87
  },
  "refusal": false,
  "scorerId": "transformers",
  "engineVersion": "0.2.0",
  "latency": 1234,
  "report": {
    "claims": [...],
    "contradictions": [...],
    "violations": [...]
  }
}
```

**Authorization**: API Key or User Session  
**Tenant Isolation**: Enforced via `org_id` from auth context  
**Usage Tracking**: Automatically tracked per project/env  
**Audit Logging**: `evaluation.create` event logged

---

### POST /validate/batch

Execute multiple validations in parallel.

**Request:**
```json
{
  "items": [
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ],
  "options": {}
}
```

**Response:**
```json
{
  "results": [...],
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 2,
    "averageScore": 85,
    "averageLatency": 1200
  }
}
```

---

## Enterprise Trial Endpoints

### POST /auth/provision

Bootstrap user after signup (creates org + default project).

**Request:**
```json
{
  "userId": "uuid",
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "orgId": "org_123",
  "projectId": "proj_456"
}
```

**Authorization**: User Session (Supabase JWT)  
**Audit**: `user.provision` event

---

### GET /orgs/:orgId/projects

List projects for an organization.

**Response:**
```json
{
  "projects": [
    {
      "id": "proj_123",
      "name": "Default Project",
      "slug": "default",
      "isDefault": true
    }
  ]
}
```

**Authorization**: User Session (must be org member)  
**RLS**: Enforced via Supabase policies

---

### GET /projects/:projectId/envs

List environments for a project.

**Response:**
```json
{
  "envs": [
    {
      "id": "env_123",
      "env": "sandbox",
      "limits": {
        "evaluations_per_month": 1000,
        "conversations_per_month": 500
      }
    }
  ]
}
```

**Authorization**: User Session (must have project access)

---

### GET /evaluations

List evaluations for an org/project.

**Query Parameters:**
- `projectId` (optional): Filter by project
- `env` (optional): Filter by environment
- `limit` (default: 50, max: 100)
- `offset` (default: 0)

**Response:**
```json
{
  "evaluations": [
    {
      "id": "eval_123",
      "org_id": "org_123",
      "project_id": "proj_456",
      "env": "sandbox",
      "scores": {...},
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Authorization**: API Key or User Session  
**Tenant Isolation**: Enforced via `org_id` from auth context

---

## API Key Management

### POST /orgs/:orgId/projects/:projectId/api-keys

Create a new API key for a project/environment.

**Request:**
```json
{
  "name": "Production Key",
  "env": "sandbox"
}
```

**Response:**
```json
{
  "id": "key_123",
  "name": "Production Key",
  "prefix": "pq_live_ab",
  "env": "sandbox",
  "key": "pq_live_abc123...",  // Only returned once
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Authorization**: User Session (must be org admin/owner)  
**Audit**: `apikey.create` event

---

### GET /orgs/:orgId/projects/:projectId/api-keys

List API keys for a project.

**Response:**
```json
{
  "keys": [
    {
      "id": "key_123",
      "name": "Production Key",
      "prefix": "pq_live_ab",
      "env": "sandbox",
      "scopes": ["validate:write", "validate:read"],
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "revoked_at": null
    }
  ]
}
```

**Authorization**: User Session (must be org admin/owner)

---

### POST /orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke

Revoke an API key.

**Response:**
```json
{
  "success": true
}
```

**Authorization**: User Session (must be org admin/owner)  
**Audit**: `apikey.revoke` event

---

## Conversation Management

### POST /conversations

Ingest a conversation (call transcript, chat log, etc.).

**Request:**
```json
{
  "title": "Customer Support Call #12345",
  "content": "Customer: Hi, I have a question...\nAgent: Sure, how can I help?",
  "externalId": "call_12345",
  "metadata": {
    "agent_id": "agent_456",
    "customer_id": "cust_789",
    "call_date": "2024-01-01T10:00:00Z"
  }
}
```

**Response:**
```json
{
  "conversation": {
    "id": "conv_123",
    "org_id": "org_123",
    "project_id": "proj_456",
    "env": "sandbox",
    "title": "Customer Support Call #12345",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

**Authorization**: API Key or User Session  
**Usage Tracking**: Automatically tracked  
**Audit**: `conversation.create` event

---

### GET /conversations

List conversations for an org/project.

**Query Parameters:**
- `projectId` (optional): Filter by project
- `env` (optional): Filter by environment
- `limit` (default: 50, max: 100)
- `offset` (default: 0)

**Response:**
```json
{
  "conversations": [
    {
      "id": "conv_123",
      "org_id": "org_123",
      "project_id": "proj_456",
      "env": "sandbox",
      "external_id": "call_12345",
      "title": "Customer Support Call #12345",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Authorization**: API Key or User Session

---

### GET /conversations/:conversationId/evaluations

List all evaluations for a specific conversation.

**Query Parameters:**
- `limit` (default: 50, max: 100)
- `offset` (default: 0)

**Response:**
```json
{
  "evaluations": [
    {
      "id": "eval_123",
      "conversation_id": "conv_123",
      "scores": {...},
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Authorization**: API Key or User Session

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"  // optional
}
```

**Status Codes:**
- `400`: Bad Request (invalid input)
- `401`: Unauthorized (missing/invalid auth)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `429`: Rate Limited (usage limits exceeded)
- `500`: Internal Server Error
- `503`: Service Unavailable (Supabase not configured)

---

## Usage Limits

Usage is tracked per `org_id` + `project_id` + `env` + `date`.

**Limit Enforcement** (future):
- Check `usage_daily` table before processing
- Return `429` if limits exceeded
- Include `Retry-After` header

**Current Behavior**: Usage is tracked but limits are not enforced (trial phase).

---

## Tenant Isolation

All endpoints enforce tenant isolation via:

1. **API Key**: Resolves to `org_id` + `project_id` + `env`
2. **User Session**: Resolves to `org_id` via `org_members` table
3. **RLS Policies**: Supabase Row Level Security enforces access at DB level

**No cross-tenant data access is possible.**

---

## Audit Logging

All significant actions are logged to `audit_log`:

- `evaluation.create`
- `apikey.create`
- `apikey.revoke`
- `user.provision`
- `project.create`
- `conversation.create`

Audit logs include:
- `org_id`
- `actor_user_id` or `actor_api_key_id`
- `action`
- `target_type` and `target_id`
- `meta` (JSON)

---

## Implementation Status

✅ **Implemented:**
- POST /validate
- POST /validate/batch
- POST /auth/provision
- GET /orgs/:orgId/projects
- GET /projects/:projectId/envs
- GET /evaluations
- POST /orgs/:orgId/projects/:projectId/api-keys
- GET /orgs/:orgId/projects/:projectId/api-keys
- POST /orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke
- POST /conversations
- GET /conversations
- GET /conversations/:conversationId/evaluations

⏳ **Pending:**
- Usage limit enforcement (429 responses)
- User session JWT validation (currently API key only)
- Rate limiting middleware
- API documentation endpoint (OpenAPI/Swagger)

🚫 **Out of Scope (until API is stable):**
- SDKs
- Client libraries
- Frontend-only features

