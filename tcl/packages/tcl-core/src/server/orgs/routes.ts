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
}

