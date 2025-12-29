/**
 * Permission checking utilities for RBAC
 * Maps roles to permissions based on the permission matrix
 */
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
const PERMISSION_MATRIX = {
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
export function hasPermission(role, permission) {
    const permissions = PERMISSION_MATRIX[role] || [];
    return permissions.includes(permission);
}
/**
 * Check if a role can view
 */
export function canView(role) {
    return hasPermission(role, 'view');
}
/**
 * Check if a role can review (QA operations)
 */
export function canReview(role) {
    return hasPermission(role, 'review');
}
/**
 * Check if a role can configure (settings, projects, etc.)
 */
export function canConfigure(role) {
    return hasPermission(role, 'configure');
}
/**
 * Check if a role can export data
 */
export function canExport(role) {
    return hasPermission(role, 'export');
}
/**
 * Check if a role can manage billing
 */
export function canManageBilling(role) {
    return hasPermission(role, 'billing');
}
/**
 * Check if a role can manage members
 */
export function canManageMembers(role) {
    return hasPermission(role, 'manage_members');
}
/**
 * Check if a role can manage integrations
 */
export function canManageIntegrations(role) {
    return hasPermission(role, 'manage_integrations');
}
/**
 * Get all permissions for a role
 */
export function getPermissions(role) {
    return PERMISSION_MATRIX[role] || [];
}
/**
 * Check if role is valid
 */
export function isValidRole(role) {
    return role in PERMISSION_MATRIX;
}
