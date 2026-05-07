/**
 * Permission Service
 * Defines and enforces role-based permissions
 */
/**
 * Permission matrix: role -> permissions
 */
const PERMISSION_MATRIX = {
    VIEWER: [
        'view_issues',
        'view_evaluations',
        'view_cases',
        'view_evidence',
        'view_audit_packs',
        'view_members',
        'view_integrations',
        'view_settings',
        'view_snapshots',
    ],
    ANALYST: [
        'view_issues',
        'create_issues',
        'update_issues',
        'view_evaluations',
        'create_evaluations',
        'view_cases',
        'create_cases',
        'update_cases',
        'view_evidence',
        'create_evidence',
        'update_evidence',
        'view_audit_packs',
        'create_audit_packs',
        'export_data',
        'view_members',
        'view_integrations',
        'view_settings',
        'create_decisions',
        'update_decisions',
        'create_signoffs',
        'view_snapshots',
        'create_batches',
    ],
    MANAGER: [
        'view_issues',
        'create_issues',
        'update_issues',
        'view_evaluations',
        'create_evaluations',
        'update_evaluations',
        'view_cases',
        'create_cases',
        'update_cases',
        'view_evidence',
        'create_evidence',
        'update_evidence',
        'view_audit_packs',
        'create_audit_packs',
        'export_data',
        'view_members',
        'manage_members',
        'view_integrations',
        'view_settings',
        'manage_settings',
        'create_decisions',
        'update_decisions',
        'create_signoffs',
        'lock_issues',
        'unlock_issues',
        'view_snapshots',
        'create_batches',
        'manage_batches',
    ],
    ADMIN: [
        'view_issues',
        'create_issues',
        'update_issues',
        'delete_issues',
        'view_evaluations',
        'create_evaluations',
        'update_evaluations',
        'delete_evaluations',
        'view_cases',
        'create_cases',
        'update_cases',
        'delete_cases',
        'view_evidence',
        'create_evidence',
        'update_evidence',
        'delete_evidence',
        'view_audit_packs',
        'create_audit_packs',
        'export_data',
        'view_members',
        'manage_members',
        'view_integrations',
        'manage_integrations',
        'view_settings',
        'manage_settings',
        'create_decisions',
        'update_decisions',
        'create_signoffs',
        'lock_issues',
        'unlock_issues',
        'create_snapshots',
        'view_snapshots',
        'create_batches',
        'manage_batches',
    ],
    OWNER: [
        // Owner has all permissions
        'view_issues',
        'create_issues',
        'update_issues',
        'delete_issues',
        'view_evaluations',
        'create_evaluations',
        'update_evaluations',
        'delete_evaluations',
        'view_cases',
        'create_cases',
        'update_cases',
        'delete_cases',
        'view_evidence',
        'create_evidence',
        'update_evidence',
        'delete_evidence',
        'view_audit_packs',
        'create_audit_packs',
        'export_data',
        'view_members',
        'manage_members',
        'view_integrations',
        'manage_integrations',
        'view_settings',
        'manage_settings',
        'transfer_ownership',
        'create_decisions',
        'update_decisions',
        'create_signoffs',
        'lock_issues',
        'unlock_issues',
        'create_snapshots',
        'view_snapshots',
        'create_batches',
        'manage_batches',
    ],
};
/**
 * Check if a role has a specific permission
 */
export function hasPermission(role, permission) {
    const permissions = PERMISSION_MATRIX[role] || [];
    return permissions.includes(permission);
}
/**
 * Get all permissions for a role
 */
export function getPermissions(role) {
    return PERMISSION_MATRIX[role] || [];
}
/**
 * Check if role A has at least the permissions of role B
 */
export function hasRoleOrHigher(role, minimumRole) {
    const roleHierarchy = ['VIEWER', 'ANALYST', 'MANAGER', 'ADMIN', 'OWNER'];
    const roleIndex = roleHierarchy.indexOf(role);
    const minimumIndex = roleHierarchy.indexOf(minimumRole);
    return roleIndex >= minimumIndex;
}
