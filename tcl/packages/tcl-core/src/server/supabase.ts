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
 * Verify API key and return org/project/env/mode info (extended)
 */
export async function verifyApiKeyExtended(key: string): Promise<{ orgId: string; projectId: string; env: string; mode: 'SANDBOX' | 'PROD'; scopes: string[] } | null> {
  if (!supabaseAdmin) return null;
  
  const hash = hashApiKey(key);
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('org_id, project_id, env, mode, scopes')
    .eq('key_hash', hash)
    .eq('is_active', true)
    .is('revoked_at', null)
    .single();
  
  if (error || !data) return null;

  // Update last_used_at (non-blocking)
  try {
    await supabaseAdmin.rpc('update_api_key_last_used', { p_key_hash: hash });
  } catch (e) {
    // Non-fatal if update fails
  }
  
  // Determine mode from database field or fallback to env
  const mode = (data.mode as 'SANDBOX' | 'PROD') || 
               (data.env === 'production' ? 'PROD' : 'SANDBOX');
  
  return {
    orgId: data.org_id,
    projectId: data.project_id || '',
    env: (data.env as string) || 'sandbox',
    mode,
    scopes: data.scopes || []
  };
}

/**
 * Get or create user profile - RELIABLE VERSION
 * Uses database function (RPC) which runs in database context and handles timing properly
 */
export async function ensureProfile(userId: string, email?: string): Promise<boolean> {
  if (!supabaseAdmin) {
    console.error('ensureProfile: supabaseAdmin is null');
    return false;
  }
  
  console.log(`ensureProfile: Starting for user ${userId}, email: ${email || 'not provided'}`);
  
  // Get email from user if not provided
  if (!email) {
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
      email = userData?.user?.email || undefined;
      console.log(`ensureProfile: Retrieved email from auth: ${email || 'none'}`);
    } catch (err) {
      console.warn('ensureProfile: Could not get user email, continuing without email');
      email = undefined;
    }
  }
  
  // Use database function (RPC) - this is more reliable because:
  // 1. Runs in database context (no timing issues)
  // 2. Can handle foreign key constraints properly
  // 3. Can check if user exists atomically
  // 4. Falls back to trigger if needed
  try {
    console.log(`ensureProfile: Calling RPC ensure_user_profile with userId=${userId}, email=${email || 'null'}`);
    const { data, error } = await supabaseAdmin.rpc('ensure_user_profile', {
      p_user_id: userId,
      p_email: email
    });
    
    if (error) {
      // If function doesn't exist, fall back to direct upsert
      if (error.code === '42883' || error.message?.includes('function') || error.message?.includes('does not exist')) {
        console.warn('ensureProfile: RPC function not available (function does not exist), using direct upsert fallback...');
        console.warn('ensureProfile: To fix this, run: supabase/sql/009_ensure_profile_function.sql');
        return await ensureProfileFallback(userId, email);
      }
      
      console.error('ensureProfile: RPC call failed:', error);
      console.error('ensureProfile: Error code:', error.code, 'Message:', error.message);
      // Try fallback anyway
      return await ensureProfileFallback(userId, email);
    }
    
    console.log(`ensureProfile: RPC returned: ${data}`);
    
    if (data === true) {
      // Verify profile actually exists
      const { data: profile, error: verifyError } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('id', userId)
        .maybeSingle();
      
      if (verifyError) {
        console.error('ensureProfile: Failed to verify profile after RPC:', verifyError);
        return false;
      }
      
      if (profile) {
        console.log(`✅ Profile ensured via RPC: id=${profile.id}, email=${profile.email || 'null'}`);
        return true;
      } else {
        console.error('ensureProfile: RPC returned true but profile not found in database!');
        // Try fallback
        return await ensureProfileFallback(userId, email);
      }
    }
    
    // If RPC returned false or unexpected value, try fallback
    console.warn(`ensureProfile: RPC returned unexpected value: ${data}, trying fallback...`);
    return await ensureProfileFallback(userId, email);
  } catch (err: any) {
    console.error('ensureProfile: Error calling RPC:', err);
    console.error('ensureProfile: Error stack:', err?.stack);
    return await ensureProfileFallback(userId, email);
  }
}

/**
 * Fallback: Direct upsert if RPC function is not available
 * This is less reliable but works if the database function doesn't exist
 */
async function ensureProfileFallback(userId: string, email: string | undefined): Promise<boolean> {
  if (!supabaseAdmin) {
    console.error('ensureProfileFallback: supabaseAdmin is null');
    return false;
  }
  
  console.log(`ensureProfileFallback: Starting fallback for user ${userId}`);
  
  // Verify user exists first - wait up to 3 seconds
  let userExists = false;
  for (let check = 0; check < 6; check++) {
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (userData?.user) {
        userExists = true;
        if (!email) {
          email = userData.user.email || undefined;
        }
        console.log(`ensureProfileFallback: User verified in auth.users`);
        break;
      }
    } catch (err) {
      // Continue checking
    }
    if (check < 5) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  if (!userExists) {
    console.error('ensureProfileFallback: User not found in auth.users after checks');
    return false;
  }
  
  // Wait additional time for user to be fully committed
  console.log('ensureProfileFallback: Waiting 1.5 seconds for user to be fully committed...');
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Try upsert with retries - use service role which should bypass RLS
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`ensureProfileFallback: Attempt ${attempt}/5`);
      
      const profileData: any = {
        id: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (email !== undefined) {
        profileData.email = email;
      }
      
      console.log(`ensureProfileFallback: Upserting profile with data:`, { id: userId, email: email || 'null' });
      
      // Use service role client (supabaseAdmin) which should bypass RLS
      const { data: upsertData, error: upsertError } = await supabaseAdmin
        .from('profiles')
        .upsert(profileData, {
          onConflict: 'id'
        })
        .select('id')
        .single();
      
      if (upsertError) {
        console.error(`ensureProfileFallback: Upsert error on attempt ${attempt}:`, upsertError);
        console.error('Error code:', upsertError.code, 'Message:', upsertError.message, 'Details:', upsertError.details);
        
        if (upsertError.code === '23503' && attempt < 5) {
          // Foreign key error - wait longer and retry
          const waitTime = 1500 * attempt; // 1.5s, 3s, 4.5s, 6s
          console.warn(`ensureProfileFallback: Foreign key error, waiting ${waitTime}ms and retrying...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        } else if (upsertError.code === '42501') {
          // Permission denied - RLS blocking
          console.error('ensureProfileFallback: Permission denied - RLS policy blocking insert');
          console.error('ensureProfileFallback: Service role should bypass RLS - check SUPABASE_SERVICE_ROLE_KEY');
          return false;
        }
        console.error('ensureProfileFallback: Upsert failed and not retrying:', upsertError);
        return false;
      }
      
      console.log('ensureProfileFallback: Upsert succeeded, verifying profile exists...');
      
      // Verify it was created - wait a moment for commit
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const { data: profile, error: verifyError } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('id', userId)
        .maybeSingle();
      
      if (verifyError) {
        console.error('ensureProfileFallback: Failed to verify profile:', verifyError);
        if (attempt < 5) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        return false;
      }
      
      if (profile) {
        console.log(`✅ Profile ensured via fallback: id=${profile.id}, email=${profile.email || 'null'}`);
        return true;
      } else {
        console.warn(`ensureProfileFallback: Upsert succeeded but profile not found, retrying... (attempt ${attempt}/5)`);
        if (attempt < 5) {
          await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        }
      }
    } catch (err: any) {
      console.error(`ensureProfileFallback: Exception on attempt ${attempt}:`, err);
      console.error('Exception stack:', err?.stack);
      if (attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
      }
    }
  }
  
  console.error('ensureProfileFallback: ❌ Failed after 5 attempts');
  return false;
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
    console.log(`Step 1: User ID: ${userId}, Email: ${email}`);
    const profileEnsured = await ensureProfile(userId, email);
    console.log(`Step 1: ensureProfile returned: ${profileEnsured}`);
    
    // Step 1.5: Auto-grant superuser if in allowlist (dev/staging only)
    const { maybeGrantSuperuser } = await import('./admin/superuser-auto-grant.js');
    await maybeGrantSuperuser(userId, email);
    
    // Verify profile exists regardless of return value
    const { data: profileCheck } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle();
    
    if (profileCheck) {
      console.log(`Step 1: ✅ Profile verified to exist: id=${profileCheck.id}, email=${profileCheck.email || 'null'}`);
    } else {
      console.error(`Step 1: ❌ Profile does NOT exist in database even though ensureProfile returned ${profileEnsured}`);
    }
    
    if (!profileEnsured) {
      console.error('Step 1 FAILED: Could not ensure profile exists');
      console.error('Attempting fallback: Direct profile creation...');
      
      // FALLBACK: Wait longer and try to create profile directly
      // The user needs more time to be committed to auth.users
      console.log('Step 1 FALLBACK: Waiting 2 seconds for user to be fully committed...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify user exists first
      let userVerified = false;
      for (let check = 0; check < 5; check++) {
        try {
          const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
          if (userData?.user) {
            userVerified = true;
            console.log('Step 1 FALLBACK: User verified in auth.users');
            break;
          }
        } catch (err) {
          // Continue checking
        }
        if (check < 4) {
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
      
      let fallbackSuccess = false;
      
      if (!userVerified) {
        console.error('Step 1 FALLBACK: User not found in auth.users, cannot create profile');
      } else {
        // Try to create profile with multiple attempts and longer waits
        for (let attempt = 1; attempt <= 5; attempt++) {
          const waitTime = attempt * 1000; // 1s, 2s, 3s, 4s, 5s
          if (attempt > 1) {
            console.log(`Step 1 FALLBACK: Waiting ${waitTime}ms before attempt ${attempt}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          
          // Try upsert (more reliable than insert)
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
          } else if (upsertError.code === '23503') {
            // Foreign key error - user still not committed, wait longer
            console.warn(`Step 1 FALLBACK: Foreign key error on attempt ${attempt}, will wait longer...`);
            continue;
          } else if (upsertError.code === '23505') {
            // Profile already exists (unique constraint) - this is OK
            console.log('Step 1 FALLBACK: Profile already exists (unique constraint)');
            fallbackSuccess = true;
            break;
          } else {
            console.error(`Step 1 FALLBACK: Upsert failed:`, upsertError);
            // Don't retry for non-foreign-key errors
            break;
          }
        }
        
        if (!fallbackSuccess) {
          console.error('Step 1 FALLBACK: All attempts failed. Profile may not exist.');
        }
      }
      
      if (!fallbackSuccess) {
        console.error('Step 1 FALLBACK: All attempts failed. Profile may not exist.');
        console.error('CRITICAL: User will not be able to use the app without a profile.');
        // Continue anyway - user can still sign in, but profile needs to be created manually
      }
    } else {
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
    
    let orgId: string;
    
    // If user has orgs, use the first one
    if (memberships && memberships.length > 0) {
      orgId = memberships[0].org_id;
      console.log(`Step 3: Using existing org: ${orgId}`);
    } else {
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
      
      // Wait a bit more to ensure user is fully committed before adding to org
      // Profile should be created by now, but user might still be committing
      console.log('Step 4: Waiting 1 second before adding user to org...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to insert org_members with retry logic
      // Increased retries and waits for foreign key errors
      let memberInserted = false;
      let memberRetries = 5; // Increased from 3 to 5
      let memberRetryDelay = 1000; // Increased from 200ms to 1000ms
      
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
            console.warn(`Step 4: Foreign key error, waiting ${memberRetryDelay}ms... (${memberRetries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, memberRetryDelay));
            memberRetryDelay = Math.min(memberRetryDelay * 1.5, 3000); // Increased max to 3000ms
            memberRetries--;
            continue;
          } else if (memberError.code === '23505') {
            // Unique constraint - user already member (OK)
            console.log('Step 4: User is already a member (this is OK)');
            memberInserted = true;
            break;
          } else {
            console.error('Step 4: Failed to add user as owner:', memberError);
            // Don't return null - continue to Step 5, we'll return orgId anyway
            console.warn('Step 4: Continuing despite error - org exists, user can still use the app');
            break; // Don't retry for non-foreign-key errors
          }
        } else {
          memberInserted = true;
          console.log('Step 4: ✅ User added as owner');
          break;
        }
      }
      
      if (!memberInserted) {
        console.error('Step 4: Could not add user as owner after all retries');
        
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
        } else {
          // CRITICAL: User MUST be in org_members for auth to work
          // Try one more time with a longer delay
          console.warn('Step 4: Final attempt to add user to org_members...');
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
          
          const { error: finalMemberError } = await supabaseAdmin
            .from('org_members')
            .insert({
              org_id: orgId,
              user_id: userId,
              role: 'owner'
            });
          
          if (finalMemberError) {
            if (finalMemberError.code === '23505') {
              // Unique constraint - already exists (race condition, this is OK)
              console.log('Step 4: User already exists in org_members (race condition)');
              memberInserted = true;
            } else {
              console.error('Step 4: CRITICAL - Cannot add user to org_members:', finalMemberError);
              console.error('User will not be able to authenticate. Manual intervention required.');
              // Return null to indicate failure - user needs to be fixed manually
              return null;
            }
          } else {
            console.log('Step 4: ✅ User added as owner (on final attempt)');
            memberInserted = true;
          }
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
      } else if (typeof project === 'object' && project !== null) {
        // Sometimes Supabase wraps it in an object
        const projectObj = project as any;
        if (typeof projectObj.id === 'string') {
          projectId = projectObj.id;
        } else if (typeof projectObj === 'string') {
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
  } catch (error: any) {
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
    } catch (fallbackError) {
      console.error('Could not get fallback orgId:', fallbackError);
    }
    
    return null;
  }
}

/**
 * Get user's role in an organization
 */
export async function getUserRole(userId: string, orgId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  
  const { data, error } = await supabaseAdmin
    .from('org_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  
  if (error || !data) return null;
  return data.role || null;
}

/**
 * Check if user has a specific permission in an org
 */
export async function checkUserPermission(userId: string, orgId: string, permission: 'view' | 'review' | 'configure' | 'export' | 'billing' | 'manage_members' | 'manage_integrations'): Promise<boolean> {
  if (!supabaseAdmin) return false;
  
  const role = await getUserRole(userId, orgId);
  if (!role) return false;
  
  // Import permission utilities
  const { hasPermission, isValidRole } = await import('./permissions');
  
  if (!isValidRole(role)) {
    return false;
  }
  
  return hasPermission(role as any, permission);
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
export async function trackUsage(orgId: string, projectId: string, env: string, type: 'evaluation' | 'conversation' | 'transcription'): Promise<void> {
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

