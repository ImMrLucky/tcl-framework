/**
 * Permission Middleware
 * Enforces role-based permissions on API endpoints
 */
import { getOrgContext } from '../auth-context.js';
import { supabaseAdmin } from '../supabase.js';
import { hasPermission } from './permission-service.js';
/**
 * Require a specific permission
 */
export function requirePermission(permission) {
    return async (req, res, next) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            // Get user's role in the org
            const role = await getUserRole(context.orgId, context.userId);
            if (!role) {
                return res.status(403).json({ error: 'User is not a member of this organization' });
            }
            // Check permission
            if (!hasPermission(role, permission)) {
                return res.status(403).json({
                    error: `Permission denied: ${permission} requires role ${getMinimumRoleForPermission(permission)} or higher`
                });
            }
            // Add role to context for downstream use
            req.userRole = role;
            next();
        }
        catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    };
}
/**
 * Require one of multiple permissions (OR logic)
 */
export function requireAnyPermission(...permissions) {
    return async (req, res, next) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const role = await getUserRole(context.orgId, context.userId);
            if (!role) {
                return res.status(403).json({ error: 'User is not a member of this organization' });
            }
            // Check if user has any of the required permissions
            const hasAny = permissions.some(permission => hasPermission(role, permission));
            if (!hasAny) {
                return res.status(403).json({
                    error: `Permission denied: requires one of: ${permissions.join(', ')}`
                });
            }
            req.userRole = role;
            next();
        }
        catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    };
}
/**
 * Require all of multiple permissions (AND logic)
 */
export function requireAllPermissions(...permissions) {
    return async (req, res, next) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const role = await getUserRole(context.orgId, context.userId);
            if (!role) {
                return res.status(403).json({ error: 'User is not a member of this organization' });
            }
            // Check if user has all required permissions
            const hasAll = permissions.every(permission => hasPermission(role, permission));
            if (!hasAll) {
                return res.status(403).json({
                    error: `Permission denied: requires all of: ${permissions.join(', ')}`
                });
            }
            req.userRole = role;
            next();
        }
        catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    };
}
/**
 * Get user's role in an organization
 */
async function getUserRole(orgId, userId) {
    if (!supabaseAdmin) {
        return null;
    }
    const { data: member, error } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
    if (error || !member) {
        return null;
    }
    return member.role || null;
}
/**
 * Get minimum role required for a permission
 */
function getMinimumRoleForPermission(permission) {
    const roleHierarchy = ['VIEWER', 'ANALYST', 'MANAGER', 'ADMIN', 'OWNER'];
    for (const role of roleHierarchy) {
        if (hasPermission(role, permission)) {
            return role;
        }
    }
    return 'OWNER'; // Fallback
}
