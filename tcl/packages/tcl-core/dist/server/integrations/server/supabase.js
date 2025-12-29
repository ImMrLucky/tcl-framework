/**
 * Supabase client for Integration Service
 * Separate from TCL Core to maintain decoupling
 */
import { createClient } from '@supabase/supabase-js';
// Support both .env file and environment variables
// Can reference existing .env from tcl-core folder or set directly
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Set these environment variables or ensure .env file is loaded.');
}
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});
/**
 * Get organization context from API key or user session
 */
export async function getOrgContext(apiKey, userId) {
    // Implementation similar to TCL Core but for integrations
    // This allows integrations to work independently
    if (apiKey) {
        // Verify API key and get org context
        const { data, error } = await supabaseAdmin
            .from('api_keys')
            .select('org_id, project_id, env')
            .eq('key_hash', apiKey) // Simplified - actual implementation would hash
            .eq('is_active', true)
            .single();
        if (error || !data)
            return null;
        return {
            orgId: data.org_id,
            projectId: data.project_id,
            env: data.env,
        };
    }
    if (userId) {
        // Get user's default org and project
        const { data } = await supabaseAdmin
            .from('org_members')
            .select('org_id')
            .eq('user_id', userId)
            .limit(1)
            .single();
        if (!data)
            return null;
        // Get default project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('org_id', data.org_id)
            .eq('is_default', true)
            .single();
        if (!project)
            return null;
        return {
            orgId: data.org_id,
            projectId: project.id,
            env: 'sandbox', // Default to sandbox for user-initiated
        };
    }
    return null;
}
