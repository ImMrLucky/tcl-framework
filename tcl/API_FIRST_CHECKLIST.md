# API-First Development Checklist

This checklist ensures ProtectQA follows strict API-first principles.

## ✅ Completed

### Backend REST API
- [x] All business logic in backend (`packages/tcl-core/src/server/express.ts`)
- [x] REST endpoints defined and implemented
- [x] Request/response schemas documented (`API_SPEC.md`)
- [x] Error responses standardized
- [x] Auth requirements (API key) implemented
- [x] Tenant isolation enforced (org_id + project_id + env)
- [x] Usage tracking implemented
- [x] Audit logging implemented
- [x] TypeScript compilation passes

### Database Schema
- [x] Enterprise tables created (`supabase/sql/003_enterprise_trial.sql`)
- [x] RLS policies defined (`supabase/sql/004_enterprise_rls.sql`)
- [x] Helper functions for project provisioning

### API Endpoints
- [x] POST /validate
- [x] POST /validate/batch
- [x] POST /auth/provision
- [x] GET /orgs/:orgId/projects
- [x] GET /projects/:projectId/envs
- [x] GET /evaluations
- [x] POST /orgs/:orgId/projects/:projectId/api-keys
- [x] GET /orgs/:orgId/projects/:projectId/api-keys
- [x] POST /orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke
- [x] POST /conversations
- [x] GET /conversations
- [x] GET /conversations/:conversationId/evaluations

## ⏳ Pending

### Backend
- [ ] Usage limit enforcement (429 responses)
- [ ] User session JWT validation (currently API key only)
- [ ] Rate limiting middleware
- [ ] OpenAPI/Swagger documentation endpoint

### Testing
- [ ] Manual testing of all endpoints via curl/HTTP client
- [ ] Verify tenant isolation works
- [ ] Verify usage tracking works
- [ ] Verify audit logging works

### Frontend
- [ ] Audit frontend code for business logic
- [ ] Ensure all API calls go through REST endpoints
- [ ] Remove any client-side validation logic that should be in backend
- [ ] Update frontend to use new conversation/evaluation endpoints

## 🚫 Out of Scope (Until API is Stable)

- [ ] SDKs
- [ ] Client libraries
- [ ] Frontend-only features

## API-First Violations to Watch For

### ❌ Prohibited Patterns
- Business logic in frontend components
- Direct database access from frontend
- SDK-only endpoints
- Hidden behavior in client libraries
- Frontend-only validation

### ✅ Required Patterns
- All logic in backend REST endpoints
- Frontend calls REST API only
- SDKs are thin wrappers (future)
- All features accessible via REST API

## Next Steps

1. **Manual Testing**: Test all endpoints via curl/HTTP client
2. **Frontend Audit**: Review frontend code to ensure API-only calls
3. **Usage Limits**: Implement 429 responses for limit enforcement
4. **JWT Auth**: Add user session JWT validation
5. **Documentation**: Generate OpenAPI spec from code

