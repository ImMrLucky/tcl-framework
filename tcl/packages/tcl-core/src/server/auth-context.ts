import express from "express";
import { supabaseAdmin, verifyApiKeyExtended } from "./supabase.js";

export interface OrgContext {
  orgId: string;
  projectId: string;
  env: string;
  userId?: string;
  role?: string;
  apiKeyMode?: 'SANDBOX' | 'PROD'; // Set when authenticated via API key
  error?: string;
}

/**
 * Extract org/project/env from request (API key or user session JWT)
 */
export async function getOrgContext(req: express.Request): Promise<OrgContext | null> {
  // Check for API key in Authorization header
  // Express lowercases header names, so check 'authorization' (lowercase)
  // Also check raw headers in case Express hasn't lowercased it yet
  const authHeader = req.headers.authorization || 
                     (req.headers as any).Authorization || 
                     (req.headers as any)['authorization'] ||
                     (req.headers as any)['Authorization'];
  
  if (!authHeader || typeof authHeader !== 'string') {
    return { error: 'No authorization header' } as any;
  }
  
  if (!authHeader.startsWith('Bearer ')) {
    return { error: 'Invalid authorization format (expected Bearer token)' } as any;
  }
  
  const token = authHeader.substring(7);
  if (!token || token.trim().length === 0) {
    return { error: 'Empty token' } as any;
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
    return { error: 'Supabase not configured on server' } as any;
  }
  
  try {
    // Verify the JWT token with Supabase
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError) {
      return { error: `Token verification failed: ${userError.message}` } as any;
    }
    if (!user) {
      return { error: 'Token valid but no user found' } as any;
    }

    // Get user's org membership (use maybeSingle to handle no membership gracefully)
    const { data: membership, error: memberError } = await supabaseAdmin
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    
    if (memberError) {
      return { error: `Error fetching org membership: ${memberError.message}` } as any;
    }
    
    if (!membership) {
      // User exists but has no org membership - this is a provisioning issue
      return { error: 'User has no organization. Please contact support or re-register.' } as any;
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
    } else {
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
  } catch (e: any) {
    console.error("Error getting org context from JWT:", e);
    return { error: `Error verifying session: ${e?.message || 'Unknown error'}` } as any;
  }
}

