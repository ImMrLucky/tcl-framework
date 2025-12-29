/**
 * Permission checking utilities for RBAC
 * Maps roles to permissions based on the permission matrix
 */

export type Role = 'owner' | 'admin' | 'qa_reviewer' | 'compliance' | 'engineer' | 'viewer';

export type Permission = 'view' | 'review' | 'configure' | 'export' | 'billing' | 'manage_members' | 'manage_integrations';

/**
 * Permission matrix
 * Based on the role requirements:
 * - Owner: All permissions
 * - Admin: All except billing
 * - QA Reviewer: View + Review
 * - Compliance: View + Export
 * - Engineer: View + Configure (integrations)
 * - Viewer: View only
 */
const PERMISSION_MATRIX: Record<Role, Permission[]> = {
  owner: ['view', 'review', 'configure', 'export', 'billing', 'manage_members', 'manage_integrations'],
  admin: ['view', 'review', 'configure', 'export', 'manage_members', 'manage_integrations'],
  qa_reviewer: ['view', 'review'],
  compliance: ['view', 'export'],
  engineer: ['view', 'configure', 'manage_integrations'],
  viewer: ['view']
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = PERMISSION_MATRIX[role] || [];
  return permissions.includes(permission);
}

/**
 * Check if a role can view
 */
export function canView(role: Role): boolean {
  return hasPermission(role, 'view');
}

/**
 * Check if a role can review (QA operations)
 */
export function canReview(role: Role): boolean {
  return hasPermission(role, 'review');
}

/**
 * Check if a role can configure (settings, projects, etc.)
 */
export function canConfigure(role: Role): boolean {
  return hasPermission(role, 'configure');
}

/**
 * Check if a role can export data
 */
export function canExport(role: Role): boolean {
  return hasPermission(role, 'export');
}

/**
 * Check if a role can manage billing
 */
export function canManageBilling(role: Role): boolean {
  return hasPermission(role, 'billing');
}

/**
 * Check if a role can manage members
 */
export function canManageMembers(role: Role): boolean {
  return hasPermission(role, 'manage_members');
}

/**
 * Check if a role can manage integrations
 */
export function canManageIntegrations(role: Role): boolean {
  return hasPermission(role, 'manage_integrations');
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: Role): Permission[] {
  return PERMISSION_MATRIX[role] || [];
}

/**
 * Check if role is valid
 */
export function isValidRole(role: string): role is Role {
  return role in PERMISSION_MATRIX;
}

