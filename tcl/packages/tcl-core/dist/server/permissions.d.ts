/**
 * Permission checking utilities for RBAC
 * Maps roles to permissions based on the permission matrix
 */
export type Role = 'owner' | 'admin' | 'qa_reviewer' | 'compliance' | 'engineer' | 'viewer';
export type Permission = 'view' | 'review' | 'configure' | 'export' | 'billing' | 'manage_members' | 'manage_integrations';
/**
 * Check if a role has a specific permission
 */
export declare function hasPermission(role: Role, permission: Permission): boolean;
/**
 * Check if a role can view
 */
export declare function canView(role: Role): boolean;
/**
 * Check if a role can review (QA operations)
 */
export declare function canReview(role: Role): boolean;
/**
 * Check if a role can configure (settings, projects, etc.)
 */
export declare function canConfigure(role: Role): boolean;
/**
 * Check if a role can export data
 */
export declare function canExport(role: Role): boolean;
/**
 * Check if a role can manage billing
 */
export declare function canManageBilling(role: Role): boolean;
/**
 * Check if a role can manage members
 */
export declare function canManageMembers(role: Role): boolean;
/**
 * Check if a role can manage integrations
 */
export declare function canManageIntegrations(role: Role): boolean;
/**
 * Get all permissions for a role
 */
export declare function getPermissions(role: Role): Permission[];
/**
 * Check if role is valid
 */
export declare function isValidRole(role: string): role is Role;
