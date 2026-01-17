/**
 * Representative Management Routes
 * 
 * CRUD operations for representatives (business-level employee identity)
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { requirePermission } from '../permissions/middleware.js';
import { Permission } from '../permissions/permission-service.js';

export function setupRepresentativeRoutes(app: express.Application) {
  console.log("Setting up representative routes...");

  /**
   * GET /api/orgs/:orgId/representatives
   * Get all active representatives for an organization
   */
  app.get("/api/orgs/:orgId/representatives", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
      }
      
      const { orgId } = req.params;
      
      // Verify user has access to this org
      if (orgId !== context.orgId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      // Get active representatives
      const { data, error } = await supabaseAdmin
        .from('representatives')
        .select('id, display_name, external_id, status, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('status', 'ACTIVE')
        .order('display_name', { ascending: true });
      
      if (error) {
        console.error("Error fetching representatives:", error);
        return res.status(500).json({ error: error.message });
      }
      
      res.json({ representatives: data || [] });
    } catch (e: any) {
      console.error("Get representatives error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });

  /**
   * POST /api/orgs/:orgId/representatives/upsert-by-name
   * Upsert representative by display name (case-insensitive)
   * Creates if not exists, returns existing if found
   */
  app.post("/api/orgs/:orgId/representatives/upsert-by-name", 
    requirePermission(Permission.MANAGE_ORGANIZATION),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error) {
          return res.status(401).json({ error: context?.error || "Authorization required" });
        }
        
        const { orgId } = req.params;
        const { displayName } = req.body;
        
        // Verify user has access to this org
        if (orgId !== context.orgId) {
          return res.status(403).json({ error: "Access denied" });
        }
        
        if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
          return res.status(400).json({ error: "displayName is required and must be a non-empty string" });
        }
        
        if (!supabaseAdmin) {
          return res.status(503).json({ error: "Supabase not configured" });
        }
        
        const normalizedName = displayName.trim();
        
        // Try to find existing representative (case-insensitive)
        const { data: existing, error: findError } = await supabaseAdmin
          .from('representatives')
          .select('id, display_name, external_id, status, created_at, updated_at')
          .eq('org_id', orgId)
          .ilike('display_name', normalizedName)
          .maybeSingle();
        
        if (findError && findError.code !== 'PGRST116') { // PGRST116 is "not found"
          console.error("Error finding representative:", findError);
          return res.status(500).json({ error: findError.message });
        }
        
        if (existing) {
          // Return existing
          return res.json({ representative: existing });
        }
        
        // Create new representative
        const { data: created, error: createError } = await supabaseAdmin
          .from('representatives')
          .insert({
            org_id: orgId,
            display_name: normalizedName,
            status: 'ACTIVE'
          })
          .select('id, display_name, external_id, status, created_at, updated_at')
          .single();
        
        if (createError) {
          console.error("Error creating representative:", createError);
          return res.status(500).json({ error: createError.message });
        }
        
        res.json({ representative: created });
      } catch (e: any) {
        console.error("Upsert representative error:", e);
        res.status(500).json({ 
          error: e?.message ?? "unknown error"
        });
      }
    }
  );
  
  console.log("Representative routes registered successfully");
}

