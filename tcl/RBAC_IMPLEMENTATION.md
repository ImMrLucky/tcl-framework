# RBAC Implementation Guide

## Overview

This document describes the Role-Based Access Control (RBAC) system implemented for ProtectQA, supporting multiple users per organization with different roles and permissions.

## Roles

| Role            | Can View | Can Review | Can Configure     | Can Export | Billing | Manage Members | Manage Integrations |
| --------------- | -------- | ---------- | ----------------- | ---------- | ------- | ------------- | ------------------- |
| **Owner**       | ✔️       | ✔️         | ✔️                | ✔️         | ✔️      | ✔️            | ✔️                  |
| **Admin**       | ✔️       | ✔️         | ✔️                | ✔️         | ❌      | ✔️            | ✔️                  |
| **QA Reviewer** | ✔️       | ✔️         | ❌                 | ❌          | ❌      | ❌            | ❌                  |
| **Compliance**  | ✔️       | ❌          | ❌                 | ✔️         | ❌      | ❌            | ❌                  |
| **Engineer**    | ✔️       | ❌          | ✔️ (integrations) | ❌          | ❌      | ❌            | ✔️                  |
| **Viewer**      | ✔️       | ❌          | ❌                 | ❌          | ❌      | ❌            | ❌                  |

## Database Schema

### Roles Supported
- `owner` - Full access
- `admin` - Full access except billing
- `qa_reviewer` - View and review only
- `compliance` - View and export only
- `engineer` - View and configure integrations
- `viewer` - View only

### Migration Files

1. **`007_rbac_roles.sql`**:
   - Updates `org_members.role` constraint to support new roles
   - Migrates existing `member` role to `viewer`
   - Creates permission helper functions (`has_permission`, `can_configure`, `can_review`, `can_export`, `can_manage_billing`, `can_manage_integrations`)

2. **`008_rbac_rls_policies.sql`**:
   - Updates all RLS policies to use new role-based permissions
   - Enforces permissions for:
     - Sources (Evidence Documents)
     - Validations
     - Conversations
     - Evaluations
     - Projects
     - API Keys
     - Org Members
     - Integrations

## Backend Implementation

### Permission Utilities (`packages/tcl-core/src/server/permissions.ts`)

```typescript
import { hasPermission, canView, canReview, canConfigure, canExport, canManageBilling, canManageMembers, canManageIntegrations } from './permissions';

// Check if role has permission
hasPermission('admin', 'configure'); // true
hasPermission('viewer', 'configure'); // false

// Convenience functions
canView('viewer'); // true
canReview('qa_reviewer'); // true
canConfigure('engineer'); // true
canExport('compliance'); // true
canManageBilling('owner'); // true
canManageMembers('admin'); // true
canManageIntegrations('engineer'); // true
```

### Supabase Functions (`packages/tcl-core/src/server/supabase.ts`)

```typescript
// Get user's role in an org
const role = await getUserRole(userId, orgId);

// Check if user has permission
const canConfigure = await checkUserPermission(userId, orgId, 'configure');
```

### Express Endpoints

All endpoints should check permissions before allowing operations:

```typescript
// Example: Creating an API key (requires manage_integrations permission)
const { hasPermission, role } = await checkPermission(userId, orgId, 'manage_integrations');
if (!hasPermission) {
  return res.status(403).json({ error: 'Insufficient permissions' });
}
```

## RLS Policies

All RLS policies are enforced at the database level:

- **View**: All roles can view data in their org
- **Review**: Owner, Admin, QA Reviewer can create/update evaluations
- **Configure**: Owner, Admin, Engineer can configure projects, integrations, API keys
- **Export**: Owner, Admin, Compliance can export data
- **Billing**: Only Owner can manage billing
- **Manage Members**: Owner, Admin can add/update/remove members
- **Manage Integrations**: Owner, Admin, Engineer can manage integrations

## Frontend Implementation

### Role Checking

```typescript
// Check user's role
const userRole = user.role; // 'owner', 'admin', 'qa_reviewer', etc.

// Show/hide features based on role
{canReview(userRole) && <ReviewButton />}
{canConfigure(userRole) && <SettingsButton />}
{canExport(userRole) && <ExportButton />}
{canManageBilling(userRole) && <BillingButton />}
```

### Permission Utilities (Frontend)

Create a similar `permissions.ts` file in the frontend:

```typescript
// packages/tcl-ui/src/app/permissions.ts
export function canView(role: string): boolean {
  return true; // All roles can view
}

export function canReview(role: string): boolean {
  return ['owner', 'admin', 'qa_reviewer'].includes(role);
}

export function canConfigure(role: string): boolean {
  return ['owner', 'admin', 'engineer'].includes(role);
}

export function canExport(role: string): boolean {
  return ['owner', 'admin', 'compliance'].includes(role);
}

export function canManageBilling(role: string): boolean {
  return role === 'owner';
}

export function canManageMembers(role: string): boolean {
  return ['owner', 'admin'].includes(role);
}

export function canManageIntegrations(role: string): boolean {
  return ['owner', 'admin', 'engineer'].includes(role);
}
```

## Migration Steps

1. **Run SQL migrations**:
   ```sql
   -- Run in Supabase SQL Editor
   \i supabase/sql/007_rbac_roles.sql
   \i supabase/sql/008_rbac_rls_policies.sql
   ```

2. **Update backend code**:
   - Import permission utilities
   - Add permission checks to endpoints
   - Update `getOrgContext` to include user role

3. **Update frontend code**:
   - Create permission utilities
   - Show/hide UI elements based on role
   - Add role display in user menu

4. **Test**:
   - Create users with different roles
   - Verify permissions are enforced
   - Test RLS policies at database level

## API Endpoints That Need Permission Checks

- `POST /orgs/:orgId/api-keys` - Requires `manage_integrations`
- `GET /orgs/:orgId/projects/:projectId/api-keys` - Requires `manage_integrations`
- `POST /orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke` - Requires `manage_integrations`
- `POST /orgs/:orgId/projects` - Requires `configure`
- `POST /conversations` - Requires `configure` (for integrations)
- `POST /validate` - Requires `review` (for creating evaluations)
- `GET /evaluations` - Requires `view`
- `GET /conversations` - Requires `view`
- `GET /conversations/:conversationId/evaluations` - Requires `view`

## Notes

- All existing `member` roles are automatically migrated to `viewer`
- RLS policies enforce permissions at the database level
- Backend should also check permissions for additional security
- Frontend should hide UI elements based on role for better UX
- API keys inherit permissions from the user who created them

