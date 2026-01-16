/**
 * Permission Middleware
 * Enforces role-based permissions on API endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { getOrgContext } from '../auth-context.js';
import { supabaseAdmin } from '../supabase.js';
import { hasPermission, type Permission, type OrgRole } from './permission-service.js';

/**
 * Require a specific permission
 */
export function requirePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      // Get user's role in the org
      const role = await getUserRole(context.orgId, context.userId);
      
      if (!role) {
        return res.status(403).json({ error: 'User is not a member of this organization' });
      }

      // Check permission
      if (!hasPermission(role, permission)) {
        return res.status(403).json({ 
          error: `Permission denied: ${permission} requires role ${getMinimumRoleForPermission(permission)} or higher` 
        });
      }

      // Add role to context for downstream use
      (req as any).userRole = role;
      next();
    } catch (error: any) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  };
}

/**
 * Require one of multiple permissions (OR logic)
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const role = await getUserRole(context.orgId, context.userId);
      
      if (!role) {
        return res.status(403).json({ error: 'User is not a member of this organization' });
      }

      // Check if user has any of the required permissions
      const hasAny = permissions.some(permission => hasPermission(role, permission));
      
      if (!hasAny) {
        return res.status(403).json({ 
          error: `Permission denied: requires one of: ${permissions.join(', ')}` 
        });
      }

      (req as any).userRole = role;
      next();
    } catch (error: any) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  };
}

/**
 * Require all of multiple permissions (AND logic)
 */
export function requireAllPermissions(...permissions: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const role = await getUserRole(context.orgId, context.userId);
      
      if (!role) {
        return res.status(403).json({ error: 'User is not a member of this organization' });
      }

      // Check if user has all required permissions
      const hasAll = permissions.every(permission => hasPermission(role, permission));
      
      if (!hasAll) {
        return res.status(403).json({ 
          error: `Permission denied: requires all of: ${permissions.join(', ')}` 
        });
      }

      (req as any).userRole = role;
      next();
    } catch (error: any) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  };
}

/**
 * Get user's role in an organization
 */
async function getUserRole(orgId: string, userId: string): Promise<OrgRole | null> {
  if (!supabaseAdmin) {
    return null;
  }

  const { data: member, error } = await supabaseAdmin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !member) {
    return null;
  }

  return (member.role as OrgRole) || null;
}

/**
 * Get minimum role required for a permission
 */
function getMinimumRoleForPermission(permission: Permission): OrgRole {
  const roleHierarchy: OrgRole[] = ['VIEWER', 'ANALYST', 'MANAGER', 'ADMIN', 'OWNER'];
  
  for (const role of roleHierarchy) {
    if (hasPermission(role, permission)) {
      return role;
    }
  }
  
  return 'OWNER'; // Fallback
}

