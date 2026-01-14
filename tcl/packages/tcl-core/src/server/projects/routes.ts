/**
 * Project Routes
 * Handles project settings and business context
 * Part of ProtectQA Evidence/Policy System
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { checkUserPermission } from '../supabase.js';
import { logAudit } from '../supabase.js';

export function setupProjectRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/projects/:projectId - Get project details
  // ============================================================================
  app.get('/api/projects/:projectId', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { projectId } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get project and verify it belongs to user's org
      const { data: project, error } = await supabaseAdmin
        .from('projects')
        .select('id, org_id, name, slug, description, is_default, business_function_override, industry_override, default_template_id, default_lens, created_at, updated_at')
        .eq('id', projectId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Project not found' });
        }
        return res.status(500).json({ error: error.message });
      }

      // Verify user has access to this project's org
      if (project.org_id !== context.orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        id: project.id,
        orgId: project.org_id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        isDefault: project.is_default,
        businessFunctionOverride: project.business_function_override,
        industryOverride: project.industry_override,
        defaultTemplateId: project.default_template_id,
        defaultLens: project.default_lens,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      });
    } catch (e: any) {
      console.error('Get project error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // PATCH /api/projects/:projectId - Update project settings
  // ============================================================================
  app.patch('/api/projects/:projectId', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!context.userId) {
        return res.status(401).json({ error: 'User authentication required' });
      }

      const { projectId } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Get project and verify it belongs to user's org
      const { data: project, error: projectError } = await supabaseAdmin
        .from('projects')
        .select('id, org_id')
        .eq('id', projectId)
        .single();

      if (projectError) {
        if (projectError.code === 'PGRST116') {
          return res.status(404).json({ error: 'Project not found' });
        }
        return res.status(500).json({ error: projectError.message });
      }

      // Verify user has access to this project's org
      if (project.org_id !== context.orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check permission (admin/owner can update project settings)
      const hasPermission = await checkUserPermission(
        context.userId,
        context.orgId,
        'configure'
      );

      if (!hasPermission) {
        return res.status(403).json({ error: 'Insufficient permissions. Admin or owner role required.' });
      }

      const {
        name,
        description,
        businessFunctionOverride,
        industryOverride,
        defaultTemplateId,
        defaultLens,
      } = req.body;

      const updateData: any = {};

      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (businessFunctionOverride !== undefined) {
        const validFunctions = ['BILLING_SUPPORT', 'CUSTOMER_SUPPORT_RETENTION', 'SALES_ONBOARDING', 'REGULATED_OPERATIONS', 'MIXED', null];
        if (!validFunctions.includes(businessFunctionOverride)) {
          return res.status(400).json({ error: `Invalid businessFunctionOverride. Must be one of: ${validFunctions.filter(f => f !== null).join(', ')}` });
        }
        updateData.business_function_override = businessFunctionOverride;
      }
      if (industryOverride !== undefined) {
        const validIndustries = ['FINANCE', 'TELECOM', 'HEALTHCARE', 'INSURANCE', 'SAAS', 'RETAIL', 'GOV', 'OTHER', 'UNKNOWN', null];
        if (!validIndustries.includes(industryOverride)) {
          return res.status(400).json({ error: `Invalid industryOverride. Must be one of: ${validIndustries.filter(i => i !== null).join(', ')}` });
        }
        updateData.industry_override = industryOverride;
      }
      if (defaultTemplateId !== undefined) {
        updateData.default_template_id = defaultTemplateId || null;
      }
      if (defaultLens !== undefined) {
        const validLenses = ['regulatory_exposure', 'financial_exposure', 'customer_dispute_risk', 'promise_commitment_risk', 'privacy_security_risk', 'operational_process_risk', 'neutral_engine_order', null];
        if (!validLenses.includes(defaultLens)) {
          return res.status(400).json({ error: `Invalid defaultLens. Must be one of: ${validLenses.filter(l => l !== null).join(', ')}` });
        }
        updateData.default_lens = defaultLens;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const { data: updatedProject, error: updateError } = await supabaseAdmin
        .from('projects')
        .update(updateData)
        .eq('id', projectId)
        .select('id, org_id, name, slug, description, is_default, business_function_override, industry_override, default_template_id, default_lens, updated_at')
        .single();

      if (updateError) {
        return res.status(500).json({ error: `Failed to update project: ${updateError.message}` });
      }

      // Log audit
      await logAudit({
        orgId: context.orgId,
        actorUserId: context.userId,
        action: 'project.update',
        targetType: 'project',
        targetId: projectId,
        meta: updateData,
      });

      res.json({
        id: updatedProject.id,
        orgId: updatedProject.org_id,
        name: updatedProject.name,
        slug: updatedProject.slug,
        description: updatedProject.description,
        isDefault: updatedProject.is_default,
        businessFunctionOverride: updatedProject.business_function_override,
        industryOverride: updatedProject.industry_override,
        defaultTemplateId: updatedProject.default_template_id,
        defaultLens: updatedProject.default_lens,
        updatedAt: updatedProject.updated_at,
      });
    } catch (e: any) {
      console.error('Update project error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });
}

