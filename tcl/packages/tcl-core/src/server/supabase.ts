import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const randomBytes = crypto.randomBytes(32);
  const key = `pq_live_${randomBytes.toString('base64url')}`;
  const prefix = key.substring(0, 10); // First 10 chars for display
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}

/**
 * Verify an API key and return org_id + scopes (legacy - use verifyApiKeyExtended)
 */
export async function verifyApiKey(key: string): Promise<{ orgId: string; scopes: string[] } | null> {
  const result = await verifyApiKeyExtended(key);
  if (!result) return null;
  return {
    orgId: result.orgId,
    scopes: result.scopes
  };
}

/**
 * Verify API key and return org/project/env info (extended)
 */
export async function verifyApiKeyExtended(key: string): Promise<{ orgId: string; projectId: string; env: string; scopes: string[] } | null> {
  if (!supabaseAdmin) return null;
  
  const hash = hashApiKey(key);
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('org_id, project_id, env, scopes')
    .eq('key_hash', hash)
    .eq('is_active', true)
    .is('revoked_at', null)
    .single();
  
  if (error || !data) return null;
  
  return {
    orgId: data.org_id,
    projectId: data.project_id || '',
    env: (data.env as string) || 'sandbox',
    scopes: data.scopes || []
  };
}

/**
 * Get or create user profile
 */
export async function ensureProfile(userId: string, email?: string): Promise<void> {
  if (!supabaseAdmin) return;
  
  // Try to upsert profile
  // Note: If the trigger is set up, the profile might already exist
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
    // If it's a foreign key error, the user might not be in auth.users yet
    // This can happen due to timing, but the trigger should handle it
    if (error.code === '23503') {
      console.warn('Profile creation failed - user may not be in auth.users yet:', error.message);
      console.warn('This should be handled by the database trigger. If it persists, check trigger setup.');
    } else {
      console.error('Failed to ensure profile:', error);
    }
  }
}

/**
 * Provision user: create profile + default org + default project if needed
 */
export async function provisionUser(userId: string, email: string): Promise<{ orgId: string; projectId: string } | null> {
  if (!supabaseAdmin) {
    console.error('provisionUser: supabaseAdmin is null');
    return null;
  }
  
  try {
    console.log(`Provisioning user: ${userId} (${email})`);
    
    // Ensure profile exists
    console.log('Step 1: Ensuring profile exists...');
    await ensureProfile(userId, email);
    console.log('Step 1: Profile ensured');
    
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
    
    let orgId: string;
    
    // If user has orgs, use the first one
    if (memberships && memberships.length > 0) {
      orgId = memberships[0].org_id;
      console.log(`Step 3: Using existing org: ${orgId}`);
    } else {
      // Create default org
      console.log('Step 3: Creating new organization...');
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
        console.error('Step 3 FAILED: Failed to create org:', orgError);
        return null;
      }
      
      orgId = org.id;
      console.log(`Step 3: Created org: ${orgId}`);
      
      // Add user as owner
      console.log('Step 4: Adding user as org owner...');
      const { error: memberError } = await supabaseAdmin
        .from('org_members')
        .insert({
          org_id: orgId,
          user_id: userId,
          role: 'owner'
        });
      
      if (memberError) {
        // If it's a foreign key error, the user might not be in auth.users yet
        // This should be handled by the database trigger, but we'll retry once
        if (memberError.code === '23503') {
          console.warn('Step 4: Foreign key error - user may not be in auth.users yet, waiting 1 second and retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const { error: retryError } = await supabaseAdmin
            .from('org_members')
            .insert({
              org_id: orgId,
              user_id: userId,
              role: 'owner'
            });
          
          if (retryError) {
            console.error('Step 4 FAILED: Retry also failed:', retryError);
            return null;
          }
          console.log('Step 4: Retry succeeded');
        } else {
          console.error('Step 4 FAILED: Failed to add user as owner:', memberError);
          return null;
        }
      } else {
        console.log('Step 4: User added as owner');
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
    
    const projectId = typeof project === 'string' ? project : (project?.id || '');
    console.log(`Step 5: Project ensured: ${projectId}`);
    console.log(`Provisioning complete: orgId=${orgId}, projectId=${projectId}`);
    
    return { orgId, projectId };
  } catch (error: any) {
    console.error('provisionUser: Unexpected error:', error);
    console.error('Error stack:', error?.stack);
    return null;
  }
}

/**
 * Get user's organizations
 */
export async function getUserOrgs(userId: string): Promise<Array<{ id: string; name: string; slug: string; role: string }>> {
  if (!supabaseAdmin) return [];
  
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
  
  if (error || !data) return [];
  
  return data.map((m: any) => ({
    id: m.org_id,
    name: m.organizations.name,
    slug: m.organizations.slug,
    role: m.role
  }));
}

/**
 * Get projects for an org
 */
export async function getOrgProjects(orgId: string): Promise<Array<{ id: string; name: string; slug: string; isDefault: boolean }>> {
  if (!supabaseAdmin) return [];
  
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, slug, is_default')
    .eq('org_id', orgId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  
  if (error || !data) return [];
  
  return data.map((p: any) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    isDefault: p.is_default
  }));
}

/**
 * Get project environments
 */
export async function getProjectEnvs(projectId: string): Promise<Array<{ id: string; env: string; limits: any }>> {
  if (!supabaseAdmin) return [];
  
  const { data, error } = await supabaseAdmin
    .from('project_envs')
    .select('id, env, limits')
    .eq('project_id', projectId);
  
  if (error || !data) return [];
  
  return data.map((e: any) => ({
    id: e.id,
    env: e.env,
    limits: e.limits
  }));
}

/**
 * Track usage for an evaluation or conversation
 */
export async function trackUsage(orgId: string, projectId: string, env: string, type: 'evaluation' | 'conversation'): Promise<void> {
  if (!supabaseAdmin) return;
  
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
export async function logAudit(params: {
  orgId?: string;
  actorUserId?: string;
  actorApiKeyId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, any>;
}): Promise<void> {
  if (!supabaseAdmin) return;
  
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

