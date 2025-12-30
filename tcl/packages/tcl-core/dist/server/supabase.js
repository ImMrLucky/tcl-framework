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
 * Verify an API key and return org_id + scopes (legacy - use verifyApiKeyExtended)
 */
export async function verifyApiKey(key) {
    const result = await verifyApiKeyExtended(key);
    if (!result)
        return null;
    return {
        orgId: result.orgId,
        scopes: result.scopes
    };
}
/**
 * Verify API key and return org/project/env info (extended)
 */
export async function verifyApiKeyExtended(key) {
    if (!supabaseAdmin)
        return null;
    const hash = hashApiKey(key);
    const { data, error } = await supabaseAdmin
        .from('api_keys')
        .select('org_id, project_id, env, scopes')
        .eq('key_hash', hash)
        .eq('is_active', true)
        .is('revoked_at', null)
        .single();
    if (error || !data)
        return null;
    return {
        orgId: data.org_id,
        projectId: data.project_id || '',
        env: data.env || 'sandbox',
        scopes: data.scopes || []
    };
}
/**
 * Get or create user profile - SIMPLIFIED VERSION
 * Just wait a bit, then upsert. Simple and reliable.
 */
export async function ensureProfile(userId, email) {
    if (!supabaseAdmin) {
        console.error('ensureProfile: supabaseAdmin is null');
        return false;
    }
    // Simple approach: Wait 1 second for user to be committed, then upsert
    // This is usually enough time for Supabase Auth to commit the user
    console.log(`ensureProfile: Waiting 1 second for user to be committed...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Get email from user if not provided
    if (!email) {
        try {
            const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
            email = userData?.user?.email || undefined;
        }
        catch (err) {
            console.warn('ensureProfile: Could not get user email, continuing without email');
            email = undefined;
        }
    }
    // Simple upsert - this handles both insert and update
    // Try up to 3 times with increasing delays
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const { error: upsertError } = await supabaseAdmin
                .from('profiles')
                .upsert({
                id: userId,
                email: email || null,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'id'
            });
            if (upsertError) {
                // Foreign key error means user isn't committed yet - wait and retry
                if (upsertError.code === '23503') {
                    const waitTime = attempt * 500; // 500ms, 1000ms, 1500ms
                    console.warn(`ensureProfile: Foreign key error (user not committed), waiting ${waitTime}ms and retrying... (attempt ${attempt}/3)`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                else {
                    console.error('ensureProfile: Upsert failed:', upsertError);
                    return false;
                }
            }
            // Verify it was created
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('id, email')
                .eq('id', userId)
                .maybeSingle();
            if (profile) {
                console.log(`✅ Profile ensured: id=${profile.id}, email=${profile.email || 'null'}`);
                return true;
            }
            else {
                console.warn(`ensureProfile: Upsert succeeded but profile not found, retrying... (attempt ${attempt}/3)`);
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                continue;
            }
        }
        catch (err) {
            console.error(`ensureProfile: Error on attempt ${attempt}:`, err);
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
        }
    }
    console.error('❌ ensureProfile: Failed after 3 attempts');
    return false;
}
/**
 * Provision user: create profile + default org + default project if needed
 */
export async function provisionUser(userId, email) {
    if (!supabaseAdmin) {
        console.error('provisionUser: supabaseAdmin is null');
        return null;
    }
    try {
        console.log(`Provisioning user: ${userId} (${email})`);
        // Ensure profile exists
        console.log('Step 1: Ensuring profile exists...');
        const profileEnsured = await ensureProfile(userId, email);
        if (!profileEnsured) {
            console.error('Step 1 FAILED: Could not ensure profile exists');
            console.error('Attempting fallback: Direct profile creation...');
            // FALLBACK: Try to create profile directly with multiple attempts
            let fallbackSuccess = false;
            for (let attempt = 1; attempt <= 5; attempt++) {
                await new Promise(resolve => setTimeout(resolve, attempt * 200)); // Wait longer each attempt
                // Try direct insert
                const { error: insertError } = await supabaseAdmin
                    .from('profiles')
                    .insert({
                    id: userId,
                    email: email,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
                if (!insertError) {
                    // Verify it was created
                    const { data: verifyProfile } = await supabaseAdmin
                        .from('profiles')
                        .select('id')
                        .eq('id', userId)
                        .maybeSingle();
                    if (verifyProfile) {
                        console.log(`Step 1 FALLBACK: ✅ Profile created successfully on attempt ${attempt}`);
                        fallbackSuccess = true;
                        break;
                    }
                }
                else if (insertError.code === '23505') {
                    // Profile already exists (unique constraint)
                    console.log('Step 1 FALLBACK: Profile already exists (unique constraint)');
                    fallbackSuccess = true;
                    break;
                }
                else if (insertError.code !== '23503') {
                    // Not a foreign key error - log and try upsert
                    console.warn(`Step 1 FALLBACK: Insert failed (${insertError.code}), trying upsert...`);
                    const { error: upsertError } = await supabaseAdmin
                        .from('profiles')
                        .upsert({
                        id: userId,
                        email: email,
                        updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'id'
                    });
                    if (!upsertError) {
                        console.log(`Step 1 FALLBACK: ✅ Profile created via upsert on attempt ${attempt}`);
                        fallbackSuccess = true;
                        break;
                    }
                }
                console.warn(`Step 1 FALLBACK: Attempt ${attempt} failed, retrying...`);
            }
            if (!fallbackSuccess) {
                console.error('Step 1 FALLBACK: All attempts failed. Profile may not exist.');
                console.error('CRITICAL: User will not be able to use the app without a profile.');
                // Continue anyway - user can still sign in, but profile needs to be created manually
            }
        }
        else {
            console.log('Step 1: ✅ Profile ensured successfully');
        }
        // Check if user has any orgs
        console.log('Step 2: Checking existing org memberships...');
        const { data: memberships, error: checkError } = await supabaseAdmin
            .from('org_members')
            .select('org_id')
            .eq('user_id', userId)
            .limit(1);
        if (checkError) {
            console.error('Step 2 FAILED: Failed to check memberships:', checkError);
            return null;
        }
        console.log(`Step 2: Found ${memberships?.length || 0} existing memberships`);
        let orgId;
        // If user has orgs, use the first one
        if (memberships && memberships.length > 0) {
            orgId = memberships[0].org_id;
            console.log(`Step 3: Using existing org: ${orgId}`);
        }
        else {
            // Create default org
            console.log('Step 3: Creating new organization...');
            // Use email as org name (remove "org" suffix)
            const orgName = email;
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
                console.error('Step 3 FAILED: Failed to create org:', orgError);
                return null;
            }
            orgId = org.id;
            console.log(`Step 3: Created org: ${orgId}`);
            // Add user as owner
            console.log('Step 4: Adding user as org owner...');
            // OPTIMIZED: Skip user verification here - we already did it in ensureProfile
            // This saves 10+ seconds of retries
            console.log('Step 4: User already verified in Step 1, proceeding to add to org...');
            // Try to insert org_members with retry logic
            // OPTIMIZED: Reduced retries and delays
            let memberInserted = false;
            let memberRetries = 3; // Reduced from 5 to 3
            let memberRetryDelay = 200; // Reduced from 300ms to 200ms
            while (memberRetries > 0 && !memberInserted) {
                const { error: memberError } = await supabaseAdmin
                    .from('org_members')
                    .insert({
                    org_id: orgId,
                    user_id: userId,
                    role: 'owner'
                });
                if (memberError) {
                    if (memberError.code === '23503') {
                        if (memberRetries > 1) {
                            console.warn(`Step 4: Foreign key error, waiting ${memberRetryDelay}ms... (${memberRetries} retries left)`);
                        }
                        await new Promise(resolve => setTimeout(resolve, memberRetryDelay));
                        memberRetryDelay = Math.min(memberRetryDelay * 1.4, 500); // Reduced max from 1500ms to 500ms
                        memberRetries--;
                        continue;
                    }
                    else if (memberError.code === '23505') {
                        // Unique constraint - user already member (OK)
                        console.log('Step 4: User is already a member (this is OK)');
                        memberInserted = true;
                        break;
                    }
                    else {
                        console.error('Step 4: Failed to add user as owner:', memberError);
                        // Don't return null - continue to Step 5, we'll return orgId anyway
                        console.warn('Step 4: Continuing despite error - org exists, user can still use the app');
                        break; // Don't retry for non-foreign-key errors
                    }
                }
                else {
                    memberInserted = true;
                    console.log('Step 4: User added as owner');
                    break;
                }
            }
            if (!memberInserted) {
                console.error('Step 4: Could not add user as owner after all retries');
                console.error('SOLUTION: Run supabase/sql/005_fix_provision_issues.sql to make foreign keys deferrable');
                // Check if user is already a member (maybe from a previous attempt)
                const { data: existingMember } = await supabaseAdmin
                    .from('org_members')
                    .select('*')
                    .eq('org_id', orgId)
                    .eq('user_id', userId)
                    .maybeSingle();
                if (existingMember) {
                    console.log('Step 4: User is already a member (from previous attempt), continuing...');
                    memberInserted = true;
                }
                else {
                    // Continue anyway - org exists, user can still use the app
                    // We'll try to add them to org_members later or manually
                    console.warn('Step 4: User not added to org_members, but org exists - continuing with provision');
                    console.warn('User may need to be added to org_members manually or on next login');
                    // Don't return null - continue to Step 5
                }
            }
        }
        // Ensure default project exists
        console.log('Step 5: Ensuring default project exists...');
        const { data: project, error: projectError } = await supabaseAdmin
            .rpc('ensure_default_project', {
            p_org_id: orgId,
            p_user_id: userId
        })
            .maybeSingle();
        if (projectError) {
            console.error('Step 5 FAILED: RPC call failed:', projectError);
            console.error('Error details:', JSON.stringify(projectError, null, 2));
            // Try to get existing default project
            console.log('Step 5 fallback: Checking for existing default project...');
            const { data: existingProject, error: existingError } = await supabaseAdmin
                .from('projects')
                .select('id')
                .eq('org_id', orgId)
                .eq('is_default', true)
                .maybeSingle();
            if (existingError) {
                console.error('Step 5 fallback FAILED:', existingError);
            }
            if (existingProject) {
                console.log(`Step 5 fallback: Found existing project: ${existingProject.id}`);
                return { orgId, projectId: existingProject.id };
            }
            // Return orgId even if project creation fails (user can still use the app)
            console.warn('Step 5: No project found, but returning orgId anyway');
            return { orgId, projectId: '' };
        }
        // Handle RPC return value - it returns a UUID (string)
        // The RPC function returns uuid directly, so project should be a string
        let projectId = '';
        if (project) {
            if (typeof project === 'string') {
                projectId = project;
            }
            else if (typeof project === 'object' && project !== null) {
                // Sometimes Supabase wraps it in an object
                const projectObj = project;
                if (typeof projectObj.id === 'string') {
                    projectId = projectObj.id;
                }
                else if (typeof projectObj === 'string') {
                    projectId = projectObj;
                }
            }
        }
        if (!projectId) {
            console.warn('Step 5: Project RPC returned but projectId is empty, trying fallback...');
            // Fallback: query for the project
            const { data: fallbackProject } = await supabaseAdmin
                .from('projects')
                .select('id')
                .eq('org_id', orgId)
                .eq('is_default', true)
                .maybeSingle();
            if (fallbackProject) {
                projectId = fallbackProject.id;
            }
        }
        console.log(`Step 5: Project ensured: ${projectId}`);
        console.log(`✅ Provisioning complete: orgId=${orgId}, projectId=${projectId}`);
        return { orgId, projectId };
    }
    catch (error) {
        console.error('provisionUser: Unexpected error:', error);
        console.error('Error stack:', error?.stack);
        // Try to return partial success if we have an orgId
        // This allows the user to still use the app even if provisioning partially failed
        try {
            // Check if user has an org (from org_members or by checking organizations)
            const { data: userOrgs } = await supabaseAdmin
                .from('org_members')
                .select('org_id')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();
            if (userOrgs?.org_id) {
                console.warn('Returning partial success - org exists, project may need to be created manually');
                return { orgId: userOrgs.org_id, projectId: '' };
            }
            // If no org_members, check if org was created but member wasn't added
            // We can't easily query this, so we'll return null
            // But the express endpoint will check for existing orgs
        }
        catch (fallbackError) {
            console.error('Could not get fallback orgId:', fallbackError);
        }
        return null;
    }
}
/**
 * Get user's role in an organization
 */
export async function getUserRole(userId, orgId) {
    if (!supabaseAdmin)
        return null;
    const { data, error } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .maybeSingle();
    if (error || !data)
        return null;
    return data.role || null;
}
/**
 * Check if user has a specific permission in an org
 */
export async function checkUserPermission(userId, orgId, permission) {
    if (!supabaseAdmin)
        return false;
    const role = await getUserRole(userId, orgId);
    if (!role)
        return false;
    // Import permission utilities
    const { hasPermission, isValidRole } = await import('./permissions');
    if (!isValidRole(role)) {
        return false;
    }
    return hasPermission(role, permission);
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
 * Get projects for an org
 */
export async function getOrgProjects(orgId) {
    if (!supabaseAdmin)
        return [];
    const { data, error } = await supabaseAdmin
        .from('projects')
        .select('id, name, slug, is_default')
        .eq('org_id', orgId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
    if (error || !data)
        return [];
    return data.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        isDefault: p.is_default
    }));
}
/**
 * Get project environments
 */
export async function getProjectEnvs(projectId) {
    if (!supabaseAdmin)
        return [];
    const { data, error } = await supabaseAdmin
        .from('project_envs')
        .select('id, env, limits')
        .eq('project_id', projectId);
    if (error || !data)
        return [];
    return data.map((e) => ({
        id: e.id,
        env: e.env,
        limits: e.limits
    }));
}
/**
 * Track usage for an evaluation or conversation
 */
export async function trackUsage(orgId, projectId, env, type) {
    if (!supabaseAdmin)
        return;
    const today = new Date().toISOString().split('T')[0];
    // Try upsert first
    const { error: upsertError } = await supabaseAdmin
        .from('usage_daily')
        .upsert({
        org_id: orgId,
        project_id: projectId,
        env: env,
        date: today,
        evaluations_count: type === 'evaluation' ? 1 : 0,
        conversations_count: type === 'conversation' ? 1 : 0
    }, {
        onConflict: 'org_id,project_id,env,date',
        ignoreDuplicates: false
    });
    // If upsert failed, try using RPC function to increment
    if (upsertError) {
        const { error: rpcError } = await supabaseAdmin.rpc('increment_usage', {
            p_org_id: orgId,
            p_project_id: projectId,
            p_env: env,
            p_date: today,
            p_type: type
        });
        if (rpcError) {
            console.error('Failed to track usage:', rpcError);
        }
    }
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
