import { supabaseAdmin, verifyApiKeyExtended } from "./supabase.js";
/**
 * Extract org/project/env from request (API key or user session JWT)
 */
export async function getOrgContext(req) {
    // Debug: Log all headers to see what we're receiving
    console.log('[AuthContext] Request headers keys:', Object.keys(req.headers));
    console.log('[AuthContext] Looking for x-active-org-id in headers:', {
        'x-active-org-id': req.headers['x-active-org-id'],
        'X-Active-Org-Id': req.headers['X-Active-Org-Id'],
        'all headers': Object.keys(req.headers).filter(k => k.toLowerCase().includes('active') || k.toLowerCase().includes('org'))
    });
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
            env: verified.env,
            apiKeyMode: verified.mode, // Attach mode to context for capability checks
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
        // Check for active org ID in header (set by admin org switch)
        // HTTP headers are case-insensitive, but Express normalizes them to lowercase
        // Express normalizes all header names to lowercase, so check lowercase first
        const activeOrgId = req.headers['x-active-org-id'] ||
            req.headers['X-Active-Org-Id'];
        // Debug logging for org switching
        console.log('[AuthContext] Checking for active org ID header. User:', user.id);
        console.log('[AuthContext] All headers with "active" or "org":', Object.keys(req.headers).filter(k => k.toLowerCase().includes('active') || k.toLowerCase().includes('org')));
        if (activeOrgId) {
            console.log('[AuthContext] ✓ Active org ID from header:', activeOrgId);
        }
        else {
            console.log('[AuthContext] ✗ No active org ID header found');
        }
        let targetOrgId;
        // First, try to use the active org ID from header if provided
        if (activeOrgId) {
            console.log('[AuthContext] Verifying user membership in org:', activeOrgId);
            // Verify user has access to the requested org
            const { data: membershipCheck, error: membershipError } = await supabaseAdmin
                .from('org_members')
                .select('org_id, role')
                .eq('org_id', activeOrgId)
                .eq('user_id', user.id)
                .maybeSingle();
            if (membershipError) {
                console.error('[AuthContext] Error checking membership:', membershipError);
            }
            if (membershipCheck) {
                // User has access to the requested org, use it
                console.log('[AuthContext] ✓ User has access to org:', activeOrgId, 'Role:', membershipCheck.role);
                targetOrgId = activeOrgId;
            }
            else {
                console.log('[AuthContext] ✗ User does NOT have access to org:', activeOrgId, '- falling back to default');
                // User doesn't have access to requested org, fall through to default
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
                targetOrgId = membership.org_id;
                console.log('[AuthContext] Using default org:', targetOrgId);
            }
        }
        else {
            // No active org ID in header, use default (first org)
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
            targetOrgId = membership.org_id;
        }
        // Get the membership for the target org to get the role
        const { data: membership, error: memberError } = await supabaseAdmin
            .from('org_members')
            .select('org_id, role')
            .eq('org_id', targetOrgId)
            .eq('user_id', user.id)
            .single();
        if (memberError || !membership) {
            return { error: `Error fetching org membership: ${memberError?.message || 'Not found'}` };
        }
        // Get default project for the org
        // If no default project, try to get any project for the org
        let project = null;
        const { data: defaultProject, error: defaultProjectError } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('org_id', targetOrgId)
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
                .eq('org_id', targetOrgId)
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
            orgId: targetOrgId,
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
