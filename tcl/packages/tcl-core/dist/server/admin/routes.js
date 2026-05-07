/**
 * Admin Routes
 * Superuser-only endpoints for org switching, emulation, and internal test org management
 */
import { supabaseAdmin } from '../supabase.js';
import { requireSuperuser, assertInternalTestOrg, logAdminAction, getAdminContext } from './middleware.js';
import { getOrgContext } from '../auth-context.js';
export function setupAdminRoutes(app) {
    // ============================================================================
    // GET /api/orgs - List orgs user can access
    // ============================================================================
    app.get('/api/orgs', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || !context.userId) {
                return res.status(401).json({ error: 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            // Get user's org memberships
            const { data: memberships, error: memberError } = await supabaseAdmin
                .from('org_members')
                .select('org_id, role')
                .eq('user_id', context.userId);
            if (memberError) {
                return res.status(500).json({ error: 'Failed to fetch org memberships' });
            }
            if (!memberships || memberships.length === 0) {
                return res.json({ orgs: [] });
            }
            const orgIds = memberships.map(m => m.org_id);
            // Get org details
            const { data: orgs, error: orgError } = await supabaseAdmin
                .from('organizations')
                .select('id, name, slug, plan_tier, plan_status, is_internal_test, billing_mode')
                .in('id', orgIds)
                .order('is_internal_test', { ascending: false }) // Internal test orgs first
                .order('name', { ascending: true });
            if (orgError) {
                return res.status(500).json({ error: 'Failed to fetch organizations' });
            }
            // Check if user is superuser
            const adminContext = await getAdminContext(req);
            const isSuperuser = adminContext?.isSuperuser || false;
            // Format response
            const formattedOrgs = (orgs || []).map(org => ({
                id: org.id,
                name: org.name,
                slug: org.slug,
                planTier: org.plan_tier,
                planStatus: org.plan_status,
                isInternalTest: org.is_internal_test || false,
                billingMode: org.billing_mode || 'STRIPE',
                membership: memberships.find(m => m.org_id === org.id),
            }));
            res.json({
                orgs: formattedOrgs,
                isSuperuser,
            });
        }
        catch (error) {
            console.error('Error listing orgs:', error);
            res.status(500).json({ error: error.message || 'Failed to list orgs' });
        }
    });
    // ============================================================================
    // GET /api/admin/orgs - List all orgs with pagination (superuser only)
    // ============================================================================
    app.get('/api/admin/orgs', requireSuperuser, async (req, res) => {
        try {
            const query = req.query.query || '';
            const limit = Math.min(parseInt(req.query.limit || '50', 10), 100); // Max 100 per page
            const offset = parseInt(req.query.offset || '0', 10);
            const planTier = req.query.planTier;
            const planStatus = req.query.planStatus;
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            // Build base query with count
            let queryBuilder = supabaseAdmin
                .from('organizations')
                .select('id, name, slug, plan_tier, plan_status, is_internal_test, billing_mode, created_at', { count: 'exact' })
                .order('is_internal_test', { ascending: false })
                .order('created_at', { ascending: false });
            // Apply filters
            if (query) {
                queryBuilder = queryBuilder.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
            }
            if (planTier) {
                queryBuilder = queryBuilder.eq('plan_tier', planTier);
            }
            if (planStatus) {
                queryBuilder = queryBuilder.eq('plan_status', planStatus);
            }
            // Apply pagination
            queryBuilder = queryBuilder.range(offset, offset + limit - 1);
            const { data: orgs, error, count } = await queryBuilder;
            if (error) {
                console.error('Error fetching organizations:', error);
                return res.status(500).json({ error: 'Failed to fetch organizations' });
            }
            res.json({
                orgs: (orgs || []).map(org => ({
                    id: org.id,
                    name: org.name,
                    slug: org.slug,
                    planTier: org.plan_tier,
                    planStatus: org.plan_status,
                    isInternalTest: org.is_internal_test || false,
                    billingMode: org.billing_mode || 'STRIPE',
                    createdAt: org.created_at,
                })),
                total: count || 0,
                limit,
                offset,
            });
        }
        catch (error) {
            console.error('Error listing all orgs:', error);
            res.status(500).json({ error: error.message || 'Failed to list orgs' });
        }
    });
    // ============================================================================
    // POST /api/admin/switch-org - Switch active org (superuser only)
    // ============================================================================
    app.post('/api/admin/switch-org', requireSuperuser, async (req, res) => {
        try {
            const adminContext = req.adminContext;
            const { orgId } = req.body;
            if (!orgId) {
                return res.status(400).json({ error: 'orgId is required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            // Verify org exists
            const { data: org, error: orgError } = await supabaseAdmin
                .from('organizations')
                .select('id, name, plan_tier, is_internal_test')
                .eq('id', orgId)
                .single();
            if (orgError || !org) {
                return res.status(404).json({ error: 'Organization not found' });
            }
            // Verify user has access to this org (membership check)
            const { data: membership } = await supabaseAdmin
                .from('org_members')
                .select('org_id')
                .eq('org_id', orgId)
                .eq('user_id', adminContext.userId)
                .single();
            if (!membership) {
                return res.status(403).json({ error: 'You do not have access to this organization' });
            }
            // Store active org in session (for now, we'll use a simple approach)
            // In production, you might want to store this in JWT or a session store
            req.activeOrgId = orgId;
            // Log audit
            await logAdminAction(adminContext.userId, 'admin.switch_org', orgId, { orgName: org.name, planTier: org.plan_tier });
            res.json({
                activeOrgId: orgId,
                org: {
                    id: org.id,
                    name: org.name,
                    planTier: org.plan_tier,
                    isInternalTest: org.is_internal_test || false,
                },
            });
        }
        catch (error) {
            console.error('Error switching org:', error);
            res.status(500).json({ error: error.message || 'Failed to switch org' });
        }
    });
    // ============================================================================
    // POST /api/admin/emulation - Enable emulation (superuser only)
    // ============================================================================
    app.post('/api/admin/emulation', requireSuperuser, async (req, res) => {
        try {
            const adminContext = req.adminContext;
            const { enabled, planTier } = req.body;
            if (enabled === true) {
                if (!planTier || !['SANDBOX', 'TEAM', 'ENTERPRISE'].includes(planTier)) {
                    return res.status(400).json({ error: 'Valid planTier is required when enabling emulation' });
                }
                // Store emulation in session
                req.emulation = {
                    enabled: true,
                    planTier: planTier,
                };
                await logAdminAction(adminContext.userId, 'admin.emulation.enabled', null, { planTier });
                res.json({
                    emulation: {
                        enabled: true,
                        planTier,
                    },
                });
            }
            else {
                // Disable emulation
                req.emulation = {
                    enabled: false,
                    planTier: null,
                };
                await logAdminAction(adminContext.userId, 'admin.emulation.disabled', null, {});
                res.json({
                    emulation: {
                        enabled: false,
                        planTier: null,
                    },
                });
            }
        }
        catch (error) {
            console.error('Error setting emulation:', error);
            res.status(500).json({ error: error.message || 'Failed to set emulation' });
        }
    });
    // ============================================================================
    // DELETE /api/admin/emulation - Disable emulation (superuser only)
    // ============================================================================
    app.delete('/api/admin/emulation', requireSuperuser, async (req, res) => {
        try {
            const adminContext = req.adminContext;
            req.emulation = {
                enabled: false,
                planTier: null,
            };
            await logAdminAction(adminContext.userId, 'admin.emulation.disabled', null, {});
            res.json({
                emulation: {
                    enabled: false,
                    planTier: null,
                },
            });
        }
        catch (error) {
            console.error('Error disabling emulation:', error);
            res.status(500).json({ error: error.message || 'Failed to disable emulation' });
        }
    });
    // ============================================================================
    // POST /api/admin/internal-org/plan - Set plan for internal test org (superuser only)
    // ============================================================================
    app.post('/api/admin/internal-org/plan', requireSuperuser, async (req, res) => {
        try {
            const adminContext = req.adminContext;
            const { orgId, planTier, planStatus, billingMode } = req.body;
            if (!orgId) {
                return res.status(400).json({ error: 'orgId is required' });
            }
            if (!planTier || !['SANDBOX', 'TEAM', 'ENTERPRISE'].includes(planTier)) {
                return res.status(400).json({ error: 'Valid planTier is required' });
            }
            // Assert that this is an internal test org
            await assertInternalTestOrg(orgId);
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            // Update org plan
            const updateData = {
                plan_tier: planTier,
                plan_changed_at: new Date().toISOString(),
            };
            if (planStatus && ['ACTIVE', 'PAST_DUE', 'CANCELED'].includes(planStatus)) {
                updateData.plan_status = planStatus;
            }
            if (billingMode && ['STRIPE', 'COMPED'].includes(billingMode)) {
                updateData.billing_mode = billingMode;
            }
            const { data: org, error: updateError } = await supabaseAdmin
                .from('organizations')
                .update(updateData)
                .eq('id', orgId)
                .select('id, name, plan_tier, plan_status, billing_mode')
                .single();
            if (updateError) {
                return res.status(500).json({ error: `Failed to update org plan: ${updateError.message}` });
            }
            // Log audit
            await logAdminAction(adminContext.userId, 'admin.internal_org.plan_set', orgId, { planTier, planStatus, billingMode, orgName: org.name });
            res.json({
                success: true,
                org: {
                    id: org.id,
                    name: org.name,
                    planTier: org.plan_tier,
                    planStatus: org.plan_status,
                    billingMode: org.billing_mode,
                },
            });
        }
        catch (error) {
            console.error('Error setting internal org plan:', error);
            res.status(403).json({ error: error.message || 'Failed to set org plan' });
        }
    });
    // ============================================================================
    // POST /api/admin/orgs/:orgId/upgrade - Upgrade any org to Enterprise (superuser only)
    // This is the general upgrade endpoint for customer orgs
    // ============================================================================
    app.post('/api/admin/orgs/:orgId/upgrade', requireSuperuser, async (req, res) => {
        try {
            const adminContext = req.adminContext;
            const { orgId } = req.params;
            const { planTier, planStatus, billingMode } = req.body;
            if (!orgId) {
                return res.status(400).json({ error: 'orgId is required' });
            }
            const targetTier = planTier || 'ENTERPRISE';
            if (!['SANDBOX', 'TEAM', 'ENTERPRISE'].includes(targetTier)) {
                return res.status(400).json({ error: 'Valid planTier is required (SANDBOX, TEAM, or ENTERPRISE)' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            // Get current org info
            const { data: currentOrg, error: fetchError } = await supabaseAdmin
                .from('organizations')
                .select('id, name, plan_tier, plan_status, billing_mode')
                .eq('id', orgId)
                .single();
            if (fetchError || !currentOrg) {
                return res.status(404).json({ error: 'Organization not found' });
            }
            // Update org plan (this will trigger the entitlement update via database trigger)
            const updateData = {
                plan_tier: targetTier,
                plan_changed_at: new Date().toISOString(),
            };
            if (planStatus && ['ACTIVE', 'PAST_DUE', 'CANCELED'].includes(planStatus)) {
                updateData.plan_status = planStatus;
            }
            else if (!currentOrg.plan_status) {
                updateData.plan_status = 'ACTIVE';
            }
            if (billingMode && ['STRIPE', 'COMPED'].includes(billingMode)) {
                updateData.billing_mode = billingMode;
            }
            const { data: updatedOrg, error: updateError } = await supabaseAdmin
                .from('organizations')
                .update(updateData)
                .eq('id', orgId)
                .select('id, name, plan_tier, plan_status, billing_mode')
                .single();
            if (updateError) {
                console.error('Failed to update org plan:', updateError);
                return res.status(500).json({ error: `Failed to update org plan: ${updateError.message}` });
            }
            // Explicitly refresh entitlements (in case trigger didn't fire or needs manual refresh)
            const { error: entitlementsError } = await supabaseAdmin.rpc('init_org_entitlements', {
                p_org_id: orgId,
                p_tier: targetTier
            });
            if (entitlementsError) {
                console.warn('Warning: Failed to explicitly refresh entitlements (trigger should have handled this):', entitlementsError);
                // Don't fail the request, as the trigger should have handled it
            }
            // Verify entitlements were updated
            const { data: entitlements, error: entitlementsFetchError } = await supabaseAdmin
                .from('org_entitlements')
                .select('tier, features')
                .eq('org_id', orgId)
                .single();
            if (entitlementsFetchError) {
                console.warn('Warning: Could not verify entitlements after upgrade:', entitlementsFetchError);
            }
            else {
                console.log(`[Upgrade] Org ${orgId} upgraded to ${targetTier}. Entitlements:`, {
                    tier: entitlements.tier,
                    batchIngestion: entitlements.features?.batchIngestion,
                    allFeatures: entitlements.features
                });
            }
            // Log audit
            await logAdminAction(adminContext.userId, 'admin.org.upgrade', orgId, {
                previousTier: currentOrg.plan_tier,
                newTier: targetTier,
                planStatus: updatedOrg.plan_status,
                billingMode: updatedOrg.billing_mode,
                orgName: updatedOrg.name,
                entitlementsVerified: !entitlementsFetchError
            });
            res.json({
                success: true,
                message: `Organization upgraded to ${targetTier}`,
                org: {
                    id: updatedOrg.id,
                    name: updatedOrg.name,
                    planTier: updatedOrg.plan_tier,
                    planStatus: updatedOrg.plan_status,
                    billingMode: updatedOrg.billing_mode,
                },
                entitlements: entitlements ? {
                    tier: entitlements.tier,
                    batchIngestion: entitlements.features?.batchIngestion,
                    allFeatures: entitlements.features
                } : null,
            });
        }
        catch (error) {
            console.error('Error upgrading org:', error);
            res.status(500).json({ error: error.message || 'Failed to upgrade organization' });
        }
    });
}
