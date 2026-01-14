/**
 * Organization Routes
 * Handles organization settings and business context
 * Part of ProtectQA Evidence/Policy System
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { checkUserPermission } from '../supabase.js';
import { logAudit } from '../supabase.js';

export function setupOrgRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/orgs/:orgId - Get organization details
  // ============================================================================
  app.get('/api/orgs/:orgId', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { orgId } = req.params;

      // Verify user has access to this org
      if (context.orgId !== orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: org, error } = await supabaseAdmin
        .from('organizations')
        .select('id, name, slug, plan, business_function_primary, industry_primary, regions, default_lens, default_evidence_inclusion, created_at, updated_at')
        .eq('id', orgId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Organization not found' });
        }
        return res.status(500).json({ error: error.message });
      }

      res.json({
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        businessFunctionPrimary: org.business_function_primary,
        industryPrimary: org.industry_primary,
        regions: org.regions || [],
        defaultLens: org.default_lens,
        defaultEvidenceInclusion: org.default_evidence_inclusion || {
          includeOrg: true,
          includeProject: true,
          includeTemplate: true,
        },
        createdAt: org.created_at,
        updatedAt: org.updated_at,
      });
    } catch (e: any) {
      console.error('Get organization error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // PATCH /api/orgs/:orgId - Update organization settings
  // ============================================================================
  app.patch('/api/orgs/:orgId', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!context.userId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      const { orgId } = req.params;

      // Verify user has access to this org
      if (context.orgId !== orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check permission (admin/owner can update org settings)
      const hasPermission = await checkUserPermission(
        context.userId,
        orgId,
        'configure'
      );

      if (!hasPermission) {
        return res.status(403).json({ error: 'Insufficient permissions. Admin or owner role required.' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const {
        name,
        businessFunctionPrimary,
        industryPrimary,
        regions,
        defaultLens,
        defaultEvidenceInclusion,
      } = req.body;

      const updateData: any = {};

      if (name !== undefined) updateData.name = name;
      if (businessFunctionPrimary !== undefined) {
        const validFunctions = ['BILLING_SUPPORT', 'CUSTOMER_SUPPORT_RETENTION', 'SALES_ONBOARDING', 'REGULATED_OPERATIONS', 'MIXED', null];
        if (!validFunctions.includes(businessFunctionPrimary)) {
          return res.status(400).json({ error: `Invalid businessFunctionPrimary. Must be one of: ${validFunctions.filter(f => f !== null).join(', ')}` });
        }
        updateData.business_function_primary = businessFunctionPrimary;
      }
      if (industryPrimary !== undefined) {
        const validIndustries = ['FINANCE', 'TELECOM', 'HEALTHCARE', 'INSURANCE', 'SAAS', 'RETAIL', 'GOV', 'OTHER', 'UNKNOWN', null];
        if (!validIndustries.includes(industryPrimary)) {
          return res.status(400).json({ error: `Invalid industryPrimary. Must be one of: ${validIndustries.filter(i => i !== null).join(', ')}` });
        }
        updateData.industry_primary = industryPrimary;
      }
      if (regions !== undefined) {
        updateData.regions = Array.isArray(regions) ? regions : [];
      }
      if (defaultLens !== undefined) {
        const validLenses = ['regulatory_exposure', 'financial_exposure', 'customer_dispute_risk', 'promise_commitment_risk', 'privacy_security_risk', 'operational_process_risk', 'neutral_engine_order', null];
        if (!validLenses.includes(defaultLens)) {
          return res.status(400).json({ error: `Invalid defaultLens. Must be one of: ${validLenses.filter(l => l !== null).join(', ')}` });
        }
        updateData.default_lens = defaultLens;
      }
      if (defaultEvidenceInclusion !== undefined) {
        updateData.default_evidence_inclusion = defaultEvidenceInclusion;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const { data: org, error: updateError } = await supabaseAdmin
        .from('organizations')
        .update(updateData)
        .eq('id', orgId)
        .select('id, name, slug, plan, business_function_primary, industry_primary, regions, default_lens, default_evidence_inclusion, updated_at')
        .single();

      if (updateError) {
        return res.status(500).json({ error: `Failed to update organization: ${updateError.message}` });
      }

      // Log audit
      await logAudit({
        orgId,
        actorUserId: context.userId,
        action: 'org.update',
        targetType: 'organization',
        targetId: orgId,
        meta: updateData,
      });

      res.json({
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        businessFunctionPrimary: org.business_function_primary,
        industryPrimary: org.industry_primary,
        regions: org.regions || [],
        defaultLens: org.default_lens,
        defaultEvidenceInclusion: org.default_evidence_inclusion || {
          includeOrg: true,
          includeProject: true,
          includeTemplate: true,
        },
        updatedAt: org.updated_at,
      });
    } catch (e: any) {
      console.error('Update organization error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/orgs/:orgId/members - List organization members
  // ============================================================================
  app.get('/api/orgs/:orgId/members', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.userId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { orgId } = req.params;

      // Verify user has access to this org (check membership, not just context orgId)
      // User might belong to multiple orgs, so we need to check if they're a member of the requested org
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { data: membership, error: membershipError } = await supabaseAdmin
        .from('org_members')
        .select('org_id, role')
        .eq('user_id', context.userId)
        .eq('org_id', orgId)
        .maybeSingle();

      if (membershipError) {
        console.error('Error checking org membership:', membershipError);
        return res.status(500).json({ error: 'Failed to verify organization access' });
      }

      if (!membership) {
        return res.status(403).json({ error: 'Access denied: You are not a member of this organization' });
      }

      // Get members with profile info
      // Use separate queries to avoid join issues
      let members: any[] = [];
      try {
        const { data: membersData, error: membersError } = await supabaseAdmin
          .from('org_members')
          .select('user_id, role, created_at')
          .eq('org_id', orgId)
          .order('created_at', { ascending: true });

        if (membersError) {
          console.error('Error fetching members:', membersError);
          console.error('Error details:', JSON.stringify(membersError, null, 2));
          return res.status(500).json({ 
            error: `Failed to fetch members: ${membersError.message}`,
            code: membersError.code,
            details: membersError.details
          });
        }

        members = membersData || [];
      } catch (queryError: any) {
        console.error('Exception fetching members:', queryError);
        return res.status(500).json({ 
          error: `Database query failed: ${queryError.message}` 
        });
      }

      // Get org owner
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('owner_user_id')
        .eq('id', orgId)
        .maybeSingle();

      if (orgError) {
        console.error('Error fetching org:', orgError);
        // Continue without owner info
      }

      // Get profile info for each member
      const memberIds = (members || []).map((m: any) => m.user_id).filter(Boolean);
      const profilesMap = new Map<string, { email?: string; full_name?: string }>();
      
      if (memberIds.length > 0) {
        try {
          const { data: profiles, error: profilesError } = await supabaseAdmin
            .from('profiles')
            .select('id, email, full_name')
            .in('id', memberIds);

          if (profilesError) {
            console.error('Error fetching profiles:', profilesError);
            // Continue without profile info
          } else if (profiles && Array.isArray(profiles)) {
            profiles.forEach((p: any) => {
              if (p && p.id) {
                profilesMap.set(p.id, {
                  email: p.email || '',
                  full_name: p.full_name || undefined
                });
              }
            });
          }
        } catch (e: any) {
          console.error('Exception fetching profiles:', e);
          // Continue without profile info
        }
      }

      // Ensure members is an array
      const membersList = Array.isArray(members) ? members : [];
      
      const membersResponse = membersList.map((m: any) => {
        try {
          if (!m || !m.user_id) {
            console.warn('Skipping invalid member record:', m);
            return null;
          }
          
          const profile = profilesMap.get(m.user_id) || {};
          return {
            userId: m.user_id,
            email: profile.email || '',
            fullName: profile.full_name || undefined,
            role: m.role || 'VIEWER',
            isOwner: org?.owner_user_id === m.user_id,
            createdAt: m.created_at || new Date().toISOString(),
          };
        } catch (memberError: any) {
          console.error('Error mapping member:', memberError, m);
          // Return a safe default for this member
          return {
            userId: m?.user_id || 'unknown',
            email: '',
            fullName: undefined,
            role: m?.role || 'VIEWER',
            isOwner: false,
            createdAt: m?.created_at || new Date().toISOString(),
          };
        }
      }).filter(Boolean); // Remove any null entries

      res.json({
        members: membersResponse,
      });
    } catch (e: any) {
      console.error('List members error:', e);
      console.error('Error stack:', e?.stack);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });

  // ============================================================================
  // POST /api/orgs/:orgId/transfer-ownership - Transfer org ownership
  // ============================================================================
  app.post('/api/orgs/:orgId/transfer-ownership', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!context.userId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      const { orgId } = req.params;
      const { newOwnerUserId } = req.body;

      if (!newOwnerUserId) {
        return res.status(400).json({ error: 'newOwnerUserId is required' });
      }

      // Verify user has access to this org
      if (context.orgId !== orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Check if current user is OWNER
      const { data: currentMembership } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', context.userId)
        .single();

      if (currentMembership?.role !== 'OWNER') {
        return res.status(403).json({ error: 'Only the current owner can transfer ownership' });
      }

      // Verify new owner exists and is an ADMIN
      const { data: newOwnerMembership } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', newOwnerUserId)
        .single();

      if (!newOwnerMembership) {
        return res.status(404).json({ error: 'New owner is not a member of this organization' });
      }

      if (newOwnerMembership.role !== 'ADMIN') {
        return res.status(400).json({ error: 'New owner must be an ADMIN before ownership transfer' });
      }

      // Check if org has at least one other ADMIN (besides the new owner)
      const { data: otherAdmins } = await supabaseAdmin
        .from('org_members')
        .select('user_id')
        .eq('org_id', orgId)
        .in('role', ['OWNER', 'ADMIN'])
        .neq('user_id', newOwnerUserId);

      if (!otherAdmins || otherAdmins.length === 0) {
        return res.status(400).json({ error: 'Organization must have at least one other ADMIN before ownership transfer' });
      }

      // Perform transfer in a transaction-like manner
      // 1. Update old owner to ADMIN
      const { error: updateOldOwnerError } = await supabaseAdmin
        .from('org_members')
        .update({ role: 'ADMIN' })
        .eq('org_id', orgId)
        .eq('user_id', context.userId);

      if (updateOldOwnerError) {
        return res.status(500).json({ error: `Failed to update old owner: ${updateOldOwnerError.message}` });
      }

      // 2. Update new owner to OWNER
      const { error: updateNewOwnerError } = await supabaseAdmin
        .from('org_members')
        .update({ role: 'OWNER' })
        .eq('org_id', orgId)
        .eq('user_id', newOwnerUserId);

      if (updateNewOwnerError) {
        // Rollback: restore old owner
        await supabaseAdmin
          .from('org_members')
          .update({ role: 'OWNER' })
          .eq('org_id', orgId)
          .eq('user_id', context.userId);
        return res.status(500).json({ error: `Failed to update new owner: ${updateNewOwnerError.message}` });
      }

      // 3. Update org.owner_user_id
      const { error: updateOrgError } = await supabaseAdmin
        .from('organizations')
        .update({ owner_user_id: newOwnerUserId })
        .eq('id', orgId);

      if (updateOrgError) {
        // Rollback: restore roles
        await supabaseAdmin
          .from('org_members')
          .update({ role: 'OWNER' })
          .eq('org_id', orgId)
          .eq('user_id', context.userId);
        await supabaseAdmin
          .from('org_members')
          .update({ role: 'ADMIN' })
          .eq('org_id', orgId)
          .eq('user_id', newOwnerUserId);
        return res.status(500).json({ error: `Failed to update organization: ${updateOrgError.message}` });
      }

      // Log audit
      await logAudit({
        orgId,
        actorUserId: context.userId,
        action: 'org.transfer_ownership',
        targetType: 'organization',
        targetId: orgId,
        meta: {
          oldOwnerUserId: context.userId,
          newOwnerUserId,
        },
      });

      res.json({
        success: true,
        message: 'Ownership transferred successfully',
        oldOwnerUserId: context.userId,
        newOwnerUserId,
      });
    } catch (e: any) {
      console.error('Transfer ownership error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // POST /api/orgs/:orgId/admin-recovery - Request admin recovery
  // ============================================================================
  app.post('/api/orgs/:orgId/admin-recovery', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!context.userId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      const { orgId } = req.params;
      const { reason } = req.body;

      // Verify user has access to this org (must be a member)
      if (context.orgId !== orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Check if org has at least one ADMIN/OWNER
      const { data: admins } = await supabaseAdmin
        .from('org_members')
        .select('user_id')
        .eq('org_id', orgId)
        .in('role', ['OWNER', 'ADMIN']);

      if (admins && admins.length > 0) {
        return res.status(400).json({ error: 'Organization already has administrators. No recovery needed.' });
      }

      // Get user profile for request details
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .eq('id', context.userId)
        .single();

      // Create recovery request
      const { data: request, error: createError } = await supabaseAdmin
        .from('org_admin_recovery_requests')
        .insert({
          org_id: orgId,
          requested_by_user_id: context.userId,
          reason: reason || null,
          user_email: profile?.email || null,
          user_name: profile?.full_name || null,
          status: 'PENDING',
        })
        .select()
        .single();

      if (createError) {
        return res.status(500).json({ error: `Failed to create recovery request: ${createError.message}` });
      }

      // Log audit
      await logAudit({
        orgId,
        actorUserId: context.userId,
        action: 'org.admin_recovery_request',
        targetType: 'organization',
        targetId: orgId,
        meta: {
          requestId: request.id,
          reason,
        },
      });

      res.json({
        success: true,
        message: 'Admin recovery request submitted successfully. Support will review your request.',
        requestId: request.id,
      });
    } catch (e: any) {
      console.error('Admin recovery request error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/orgs/:orgId/admin-recovery - Get recovery request status
  // ============================================================================
  app.get('/api/orgs/:orgId/admin-recovery', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { orgId } = req.params;

      // Verify user has access to this org
      if (context.orgId !== orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get most recent recovery request for this org
      const { data: request, error } = await supabaseAdmin
        .from('org_admin_recovery_requests')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      if (!request) {
        return res.json({ request: null });
      }

      res.json({
        request: {
          id: request.id,
          status: request.status,
          reason: request.reason,
          resolutionNotes: request.resolution_notes,
          createdAt: request.created_at,
          resolvedAt: request.resolved_at,
        },
      });
    } catch (e: any) {
      console.error('Get recovery request error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });
}

