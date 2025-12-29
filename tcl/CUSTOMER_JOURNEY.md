# Customer Journey Implementation

This document describes the realistic customer journey and how the system supports each stage.

## Journey Stages

### 1. Champion Signs Up
**What happens:**
- User signs up via `/login` page
- `POST /auth/provision` is called automatically
- System creates:
  - Profile in `public.profiles`
  - Organization in `public.organizations` (name = email)
  - Default project in `public.projects`
  - User added to `org_members` with role `owner`

**Endpoints:**
- `POST /auth/provision` - Automatic provisioning
- `GET /me/orgs` - Get user's organizations

**Status:** ✅ Implemented

---

### 2. They Test with Real Data
**What happens:**
- User uploads a transcript (via UI or API)
- User runs an evaluation
- Results are stored in `public.evaluations`

**Endpoints:**
- `POST /conversations` - Upload transcript
- `POST /validate` - Run evaluation
- `GET /conversations/:conversationId/evaluations` - View results

**Permissions:**
- **View**: All roles can view
- **Review** (create evaluations): Owner, Admin, QA Reviewer
- **Configure** (upload conversations): Owner, Admin, Engineer

**Status:** ✅ Implemented

---

### 3. They Invite Others
**What happens:**
- Owner/Admin invites team members via UI
- System creates users (if needed) and adds them to `org_members`
- Invited users receive email to set password
- Users can be assigned different roles:
  - **QA Reviewer** - Can review evaluations
  - **Compliance** - Can export data
  - **Engineer** - Can configure integrations

**Endpoints:**
- `GET /orgs/:orgId/members` - List all members
- `POST /orgs/:orgId/members/invite` - Invite new member
- `PATCH /orgs/:orgId/members/:memberUserId` - Update member role
- `DELETE /orgs/:orgId/members/:memberUserId` - Remove member

**Permissions:**
- **Manage Members**: Owner, Admin only

**Status:** ✅ Implemented

---

### 4. They Integrate
**What happens:**
- Engineer configures integrations:
  - Webhook ingest/export
  - S3 Drop
  - Slack/Teams alerts
- Integrations are stored in `public.integrations`
- API keys are created for programmatic access

**Endpoints:**
- `POST /orgs/:orgId/projects/:projectId/api-keys` - Create API key
- `GET /orgs/:orgId/projects/:projectId/api-keys` - List API keys
- `POST /orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke` - Revoke API key
- `POST /webhooks/:path_token` - Webhook ingest
- `POST /v1/realtime/sessions/start` - Real-time ingestion
- Integration management endpoints (see Integration Layer spec)

**Permissions:**
- **Manage Integrations**: Owner, Admin, Engineer

**Status:** ✅ Implemented

---

### 5. They Expand Usage
**What happens:**
- More conversations are ingested
- More evaluations are run
- More reviewers are added
- More exports are generated
- Usage is tracked in `public.usage_daily`

**Endpoints:**
- All existing endpoints scale automatically
- `GET /evaluations` - List all evaluations
- `GET /conversations` - List all conversations
- Export endpoints (to be implemented)

**Permissions:**
- **View**: All roles
- **Review**: Owner, Admin, QA Reviewer
- **Export**: Owner, Admin, Compliance

**Status:** ✅ Implemented (usage tracking), ⚠️ Export endpoints pending

---

### 6. They Upgrade
**What happens:**
- Organization upgrades plan (trial → team → enterprise)
- SSO is configured (future)
- Data retention policies are applied (future)
- Audit exports are generated (future)

**Endpoints:**
- `PATCH /orgs/:orgId` - Update organization (plan, settings)
- `GET /orgs/:orgId/audit-log` - Export audit log (future)
- SSO configuration endpoints (future)

**Permissions:**
- **Billing**: Owner only
- **Configure**: Owner, Admin

**Status:** ⚠️ Partially implemented (audit logs exist, SSO pending)

---

## API Endpoints Summary

### Authentication & Provisioning
- `POST /auth/provision` - Provision new user (creates org, project, owner role)
- `GET /me/orgs` - Get user's organizations

### Member Management
- `GET /orgs/:orgId/members` - List members
- `POST /orgs/:orgId/members/invite` - Invite member
- `PATCH /orgs/:orgId/members/:memberUserId` - Update member role
- `DELETE /orgs/:orgId/members/:memberUserId` - Remove member

### Projects & API Keys
- `GET /orgs/:orgId/projects` - List projects
- `GET /projects/:projectId/envs` - List environments
- `POST /orgs/:orgId/projects/:projectId/api-keys` - Create API key
- `GET /orgs/:orgId/projects/:projectId/api-keys` - List API keys
- `POST /orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke` - Revoke API key

### Conversations & Evaluations
- `POST /conversations` - Create conversation
- `GET /conversations` - List conversations
- `GET /conversations/:conversationId/evaluations` - List evaluations for conversation
- `POST /validate` - Run evaluation
- `GET /evaluations` - List evaluations

### Integrations
- `POST /webhooks/:path_token` - Webhook ingest
- `POST /v1/realtime/sessions/start` - Start real-time session
- `POST /v1/realtime/sessions/:id/chunk` - Send chunk
- `POST /v1/realtime/sessions/:id/finalize` - Finalize session

## Frontend Implementation Checklist

### Stage 1: Sign Up
- [x] Login/Signup page
- [x] Onboarding flow
- [x] Dashboard redirect

### Stage 2: Testing
- [x] Upload transcript UI
- [x] Run evaluation UI
- [x] View results UI

### Stage 3: Invite Team
- [ ] Member management page (`/orgs/:orgId/members`)
- [ ] Invite member form
- [ ] Member list with roles
- [ ] Update role dropdown
- [ ] Remove member button

### Stage 4: Integrate
- [ ] Integrations page (`/app/integrations`)
- [ ] API key management UI
- [ ] Webhook configuration
- [ ] S3 Drop configuration
- [ ] Slack/Teams alert configuration

### Stage 5: Expand Usage
- [x] Conversations list
- [x] Evaluations list
- [ ] Export functionality
- [ ] Usage dashboard

### Stage 6: Upgrade
- [ ] Organization settings page
- [ ] Plan upgrade UI
- [ ] SSO configuration (future)
- [ ] Audit log export (future)

## Next Steps

1. **Implement member management UI** - Allow owners/admins to invite and manage team members
2. **Add export functionality** - Allow compliance users to export data
3. **Create integrations management UI** - Allow engineers to configure integrations
4. **Add usage dashboard** - Show usage metrics to all users
5. **Implement SSO** - For enterprise customers
6. **Add audit log exports** - For compliance and security

