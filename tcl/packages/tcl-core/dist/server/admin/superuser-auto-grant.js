/**
 * Dev-Only Superuser Auto-Grant
 * Automatically grants SUPERUSER role to allowlisted emails/domains in dev/staging
 * Must be explicitly enabled in production via env var
 */
import { supabaseAdmin } from '../supabase.js';
import { logAdminAction } from './middleware.js';
/**
 * Parse comma-separated environment variable into array of trimmed strings
 */
function parseCsvEnv(envVar) {
    if (!envVar)
        return [];
    return envVar
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
}
/**
 * Check if user should be auto-granted SUPERUSER role
 * Returns true if user should be granted, false otherwise
 */
export async function maybeGrantSuperuser(userId, email) {
    if (!supabaseAdmin) {
        console.warn('maybeGrantSuperuser: Supabase not configured');
        return false;
    }
    // Check environment restrictions
    const isProd = process.env.NODE_ENV === 'production';
    const prodAllowed = process.env.ALLOW_DEV_SUPERUSER_IN_PROD === 'true';
    if (isProd && !prodAllowed) {
        // Production is disabled by default
        return false;
    }
    // Parse allowlists
    const emailAllowlist = parseCsvEnv(process.env.DEV_SUPERUSER_EMAILS);
    const domainAllowlist = parseCsvEnv(process.env.DEV_SUPERUSER_DOMAINS);
    if (emailAllowlist.length === 0 && domainAllowlist.length === 0) {
        // No allowlist configured
        return false;
    }
    const emailLower = email.toLowerCase();
    const emailMatch = emailAllowlist.includes(emailLower);
    // Extract domain from email
    const emailParts = emailLower.split('@');
    const domain = emailParts.length > 1 ? emailParts[1] : null;
    const domainMatch = domain && domainAllowlist.length > 0
        ? domainAllowlist.includes(domain)
        : false;
    if (!emailMatch && !domainMatch) {
        // User not in allowlist
        return false;
    }
    // Check current role
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', userId)
        .single();
    if (profileError || !profile) {
        console.error('maybeGrantSuperuser: Failed to fetch profile:', profileError);
        return false;
    }
    // Never auto-demote - if already SUPERUSER, leave it
    if (profile.role === 'SUPERUSER') {
        return false; // Already superuser, no action needed
    }
    // Grant SUPERUSER role
    const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ role: 'SUPERUSER' })
        .eq('id', userId);
    if (updateError) {
        console.error('maybeGrantSuperuser: Failed to update role:', updateError);
        return false;
    }
    // Log the auto-grant
    console.log(`🔐 AUTO-GRANTED SUPERUSER: ${email} (${emailMatch ? 'email match' : 'domain match'})`);
    await logAdminAction(userId, 'AUTO_GRANT_SUPERUSER', null, {
        email,
        emailMatch,
        domainMatch,
        domain: domain || null,
        environment: isProd ? 'production' : 'development',
        prodGateEnabled: prodAllowed,
    });
    return true;
}
