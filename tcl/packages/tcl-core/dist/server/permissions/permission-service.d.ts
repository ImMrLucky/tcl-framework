/**
 * Permission Service
 * Defines and enforces role-based permissions
 */
export type OrgRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';
export type Permission = 'view_issues' | 'create_issues' | 'update_issues' | 'delete_issues' | 'view_evaluations' | 'create_evaluations' | 'update_evaluations' | 'delete_evaluations' | 'view_cases' | 'create_cases' | 'update_cases' | 'delete_cases' | 'view_evidence' | 'create_evidence' | 'update_evidence' | 'delete_evidence' | 'view_audit_packs' | 'create_audit_packs' | 'export_data' | 'view_members' | 'manage_members' | 'view_integrations' | 'manage_integrations' | 'view_settings' | 'manage_settings' | 'transfer_ownership' | 'create_decisions' | 'update_decisions' | 'create_signoffs' | 'lock_issues' | 'unlock_issues' | 'create_snapshots' | 'view_snapshots' | 'create_batches' | 'manage_batches';
/**
 * Check if a role has a specific permission
 */
export declare function hasPermission(role: OrgRole, permission: Permission): boolean;
/**
 * Get all permissions for a role
 */
export declare function getPermissions(role: OrgRole): Permission[];
/**
 * Check if role A has at least the permissions of role B
 */
export declare function hasRoleOrHigher(role: OrgRole, minimumRole: OrgRole): boolean;
