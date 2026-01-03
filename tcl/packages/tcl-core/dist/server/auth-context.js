import { supabaseAdmin, verifyApiKeyExtended } from "./supabase.js";
/**
 * Extract org/project/env from request (API key or user session JWT)
 */
export async function getOrgContext(req) {
    // Check for API key in Authorization header
    // Express lowercases header names, so check 'authorization' (lowercase)
    // Also check raw headers in case Express hasn't lowercased it yet
    const authHeader = req.headers.authorization ||
        req.headers.Authorization ||
        req.headers['authorization'] ||
        req.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
        return { error: 'No authorization header' };
    }
    if (!authHeader.startsWith('Bearer ')) {
        return { error: 'Invalid authorization format (expected Bearer token)' };
    }
    const token = authHeader.substring(7);
    if (!token || token.trim().length === 0) {
        return { error: 'Empty token' };
    }
    // First try API key verification
    const verified = await verifyApiKeyExtended(token);
    if (verified) {
        return {
            orgId: verified.orgId,
            projectId: verified.projectId,
            env: verified.env
        };
    }
    // If not an API key, try Supabase JWT verification
    if (!supabaseAdmin) {
        return { error: 'Supabase not configured on server' };
    }
    try {
        // Verify the JWT token with Supabase
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError) {
            return { error: `Token verification failed: ${userError.message}` };
        }
        if (!user) {
            return { error: 'Token valid but no user found' };
        }
        // Get user's org membership (use maybeSingle to handle no membership gracefully)
        const { data: membership, error: memberError } = await supabaseAdmin
            .from('org_members')
            .select('org_id, role')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();
        if (memberError) {
            return { error: `Error fetching org membership: ${memberError.message}` };
        }
        if (!membership) {
            // User exists but has no org membership - this is a provisioning issue
            return { error: 'User has no organization. Please contact support or re-register.' };
        }
        // Get default project for the org
        // If no default project, try to get any project for the org
        let project = null;
        const { data: defaultProject, error: defaultProjectError } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('org_id', membership.org_id)
            .eq('is_default', true)
            .maybeSingle();
        if (!defaultProjectError && defaultProject) {
            project = defaultProject;
        }
        else {
            // No default project - try to get any project for the org
            const { data: anyProject, error: anyProjectError } = await supabaseAdmin
                .from('projects')
                .select('id')
                .eq('org_id', membership.org_id)
                .limit(1)
                .maybeSingle();
            if (!anyProjectError && anyProject) {
                project = anyProject;
            }
        }
        // Get default environment
        let env = 'production';
        if (project) {
            const { data: projEnv, error: envError } = await supabaseAdmin
                .from('project_envs')
                .select('env')
                .eq('project_id', project.id)
                .eq('is_default', true)
                .maybeSingle();
            if (!envError && projEnv) {
                env = projEnv.env;
            }
        }
        return {
            orgId: membership.org_id,
            projectId: project?.id || '',
            env,
            userId: user.id,
            role: membership.role
        };
    }
    catch (e) {
        console.error("Error getting org context from JWT:", e);
        return { error: `Error verifying session: ${e?.message || 'Unknown error'}` };
    }
}
