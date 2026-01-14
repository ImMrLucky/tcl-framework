/**
 * Templates Routes
 * Handles template listing and retrieval
 * Part of ProtectQA Evidence/Policy System
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';

export function setupTemplateRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/templates - List templates (system + org)
  // ============================================================================
  app.get('/api/templates', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      const hasAuth = context && !context.error;
      const orgId = hasAuth ? context.orgId : null;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { industry, businessFunction } = req.query;

      // Get system templates (is_system_template = true) - always available
      let systemTemplatesQuery = supabaseAdmin
        .from('templates')
        .select('id, name, description, industry, business_function, default_lens, guidance_markdown, attached_evidence_ids, is_system_template, created_at, updated_at')
        .eq('is_system_template', true)
        .order('name', { ascending: true });

      if (industry) {
        systemTemplatesQuery = systemTemplatesQuery.eq('industry', industry);
      }
      if (businessFunction) {
        systemTemplatesQuery = systemTemplatesQuery.eq('business_function', businessFunction);
      }

      const { data: systemTemplates, error: systemError } = await systemTemplatesQuery;

      if (systemError) {
        console.error('Error fetching system templates:', systemError);
      }

      // Get org templates (org_id = context.orgId) - only if authenticated
      let orgTemplates: any[] = [];
      if (orgId) {
        let orgTemplatesQuery = supabaseAdmin
          .from('templates')
          .select('id, name, description, industry, business_function, default_lens, guidance_markdown, attached_evidence_ids, is_system_template, created_at, updated_at')
          .eq('org_id', orgId)
          .eq('is_system_template', false)
          .order('name', { ascending: true });

        if (industry) {
          orgTemplatesQuery = orgTemplatesQuery.eq('industry', industry);
        }
        if (businessFunction) {
          orgTemplatesQuery = orgTemplatesQuery.eq('business_function', businessFunction);
        }

        const { data: orgTemplatesData, error: orgError } = await orgTemplatesQuery;

        if (orgError) {
          console.error('Error fetching org templates:', orgError);
        } else {
          orgTemplates = orgTemplatesData || [];
        }
      }

      res.json({
        templates: [
          ...(systemTemplates || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            industry: t.industry,
            businessFunction: t.business_function,
            defaultLens: t.default_lens,
            guidanceMarkdown: t.guidance_markdown,
            attachedEvidenceIds: t.attached_evidence_ids || [],
            isSystemTemplate: t.is_system_template,
            createdAt: t.created_at,
            updatedAt: t.updated_at,
          })),
          ...orgTemplates.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            industry: t.industry,
            businessFunction: t.business_function,
            defaultLens: t.default_lens,
            guidanceMarkdown: t.guidance_markdown,
            attachedEvidenceIds: t.attached_evidence_ids || [],
            isSystemTemplate: t.is_system_template,
            createdAt: t.created_at,
            updatedAt: t.updated_at,
          })),
        ],
      });
    } catch (e: any) {
      console.error('List templates error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });

  // ============================================================================
  // GET /api/templates/:templateId - Get template details
  // ============================================================================
  app.get('/api/templates/:templateId', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const { templateId } = req.params;

      // Get template (system or org)
      const { data: template, error } = await supabaseAdmin
        .from('templates')
        .select('id, org_id, name, description, industry, business_function, default_lens, guidance_markdown, attached_evidence_ids, is_system_template, created_at, updated_at')
        .eq('id', templateId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Template not found' });
        }
        return res.status(500).json({ error: error.message });
      }

      // Verify access: system templates are public, org templates require org membership
      if (!template.is_system_template && template.org_id !== context.orgId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        id: template.id,
        orgId: template.org_id,
        name: template.name,
        description: template.description,
        industry: template.industry,
        businessFunction: template.business_function,
        defaultLens: template.default_lens,
        guidanceMarkdown: template.guidance_markdown,
        attachedEvidenceIds: template.attached_evidence_ids || [],
        isSystemTemplate: template.is_system_template,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      });
    } catch (e: any) {
      console.error('Get template error:', e);
      res.status(500).json({ error: e?.message ?? 'unknown error' });
    }
  });
}

