/**
 * Admin/Superuser Middleware
 * Provides guards and helpers for admin functionality
 */
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
/**
 * Middleware to require superuser access
 * Returns 403 if user is not a superuser
 */
export function requireSuperuser(req, res, next) {
    getAdminContext(req)
        .then((adminContext) => {
        if (!adminContext || !adminContext.isSuperuser) {
            res.status(403).json({
                error: 'SUPERUSER_REQUIRED',
                message: 'This endpoint requires superuser access',
            });
            return;
        }
        req.adminContext = adminContext;
        next();
    })
        .catch((error) => {
        console.error('Error checking superuser status:', error);
        res.status(500).json({ error: 'Failed to verify admin access' });
    });
}
/**
 * Get admin context for the current user
 */
export async function getAdminContext(req) {
    const context = await getOrgContext(req);
    if (!context || !context.userId) {
        return null;
    }
    if (!supabaseAdmin) {
        return null;
    }
    const { data: user, error } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', context.userId)
        .single();
    if (error || !user) {
        return null;
    }
    const role = (user.role || 'USER');
    return {
        userId: user.id,
        role,
        isSuperuser: role === 'SUPERUSER',
    };
}
/**
 * Assert that an organization is an internal test org
 * Throws error if not internal or if attempting in production without explicit allow
 */
export async function assertInternalTestOrg(orgId) {
    if (!supabaseAdmin) {
        throw new Error('Database not configured');
    }
    const { data: org, error } = await supabaseAdmin
        .from('organizations')
        .select('id, name, is_internal_test')
        .eq('id', orgId)
        .single();
    if (error || !org) {
        throw new Error(`Organization not found: ${orgId}`);
    }
    if (!org.is_internal_test) {
        throw new Error(`Organization ${org.name} (${orgId}) is not an internal test org. Admin plan changes are only allowed for internal test orgs.`);
    }
    // Check production environment restriction
    const isProduction = process.env.NODE_ENV === 'production';
    const allowInProd = process.env.ALLOW_INTERNAL_ADMIN_IN_PROD === 'true';
    if (isProduction && !allowInProd) {
        throw new Error('Internal admin operations are not allowed in production environment. Set ALLOW_INTERNAL_ADMIN_IN_PROD=true to override.');
    }
}
/**
 * Log an admin action to the audit log
 */
export async function logAdminAction(actorUserId, action, targetOrgId = null, metadata = null) {
    if (!supabaseAdmin) {
        console.warn('Cannot log admin action: Supabase not configured');
        return;
    }
    try {
        await supabaseAdmin.rpc('log_admin_action', {
            p_actor_user_id: actorUserId,
            p_action: action,
            p_target_org_id: targetOrgId,
            p_metadata_json: metadata,
        });
    }
    catch (error) {
        console.error('Failed to log admin action:', error);
        // Don't throw - audit logging failure shouldn't break the operation
    }
}
