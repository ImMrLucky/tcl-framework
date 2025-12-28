import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('⚠️ Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable database features.');
}
// Service role client (backend only - bypasses RLS)
export const supabaseAdmin = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
    : null;
// Anon client (for frontend - respects RLS)
export const supabaseAnon = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
/**
 * Hash an API key for storage
 */
export function hashApiKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}
/**
 * Generate a new API key
 */
export function generateApiKey() {
    const randomBytes = crypto.randomBytes(32);
    const key = `pq_live_${randomBytes.toString('base64url')}`;
    const prefix = key.substring(0, 10); // First 10 chars for display
    const hash = hashApiKey(key);
    return { key, prefix, hash };
}
/**
 * Verify an API key and return org_id + scopes
 */
export async function verifyApiKey(key) {
    if (!supabaseAdmin)
        return null;
    const hash = hashApiKey(key);
    const { data, error } = await supabaseAdmin
        .from('api_keys')
        .select('org_id, scopes')
        .eq('key_hash', hash)
        .eq('is_active', true)
        .is('revoked_at', null)
        .single();
    if (error || !data)
        return null;
    return {
        orgId: data.org_id,
        scopes: data.scopes || []
    };
}
/**
 * Get or create user profile
 */
export async function ensureProfile(userId, email) {
    if (!supabaseAdmin)
        return;
    const { error } = await supabaseAdmin
        .from('profiles')
        .upsert({
        id: userId,
        email: email || null,
        updated_at: new Date().toISOString()
    }, {
        onConflict: 'id'
    });
    if (error) {
        console.error('Failed to ensure profile:', error);
    }
}
/**
 * Provision user: create profile + default org if needed
 */
export async function provisionUser(userId, email) {
    if (!supabaseAdmin)
        return null;
    // Ensure profile exists
    await ensureProfile(userId, email);
    // Check if user has any orgs
    const { data: memberships, error: checkError } = await supabaseAdmin
        .from('org_members')
        .select('org_id')
        .eq('user_id', userId)
        .limit(1);
    if (checkError) {
        console.error('Failed to check memberships:', checkError);
        return null;
    }
    // If user has orgs, return the first one
    if (memberships && memberships.length > 0) {
        return { orgId: memberships[0].org_id };
    }
    // Create default org
    const orgName = `${email} org`;
    const orgSlug = `${email.split('@')[0]}-${crypto.randomBytes(4).toString('hex')}`;
    const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({
        name: orgName,
        slug: orgSlug,
        plan: 'trial'
    })
        .select('id')
        .single();
    if (orgError || !org) {
        console.error('Failed to create org:', orgError);
        return null;
    }
    // Add user as owner
    const { error: memberError } = await supabaseAdmin
        .from('org_members')
        .insert({
        org_id: org.id,
        user_id: userId,
        role: 'owner'
    });
    if (memberError) {
        console.error('Failed to add user as owner:', memberError);
        return null;
    }
    return { orgId: org.id };
}
/**
 * Get user's organizations
 */
export async function getUserOrgs(userId) {
    if (!supabaseAdmin)
        return [];
    const { data, error } = await supabaseAdmin
        .from('org_members')
        .select(`
      org_id,
      role,
      organizations (
        id,
        name,
        slug
      )
    `)
        .eq('user_id', userId);
    if (error || !data)
        return [];
    return data.map((m) => ({
        id: m.org_id,
        name: m.organizations.name,
        slug: m.organizations.slug,
        role: m.role
    }));
}
/**
 * Log audit event
 */
export async function logAudit(params) {
    if (!supabaseAdmin)
        return;
    const { error } = await supabaseAdmin
        .from('audit_log')
        .insert({
        org_id: params.orgId || null,
        actor_user_id: params.actorUserId || null,
        actor_api_key_id: params.actorApiKeyId || null,
        action: params.action,
        target_type: params.targetType || null,
        target_id: params.targetId || null,
        meta: params.meta || {}
    });
    if (error) {
        console.error('Failed to log audit:', error);
    }
}
