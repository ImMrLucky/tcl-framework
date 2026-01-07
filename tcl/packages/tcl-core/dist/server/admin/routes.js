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
    // GET /api/admin/orgs - List all orgs (superuser only)
    // ============================================================================
    app.get('/api/admin/orgs', requireSuperuser, async (req, res) => {
        try {
            const query = req.query.query || '';
            const limit = parseInt(req.query.limit || '50', 10);
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Database not configured' });
            }
            let queryBuilder = supabaseAdmin
                .from('organizations')
                .select('id, name, slug, plan_tier, plan_status, is_internal_test, billing_mode, created_at')
                .order('is_internal_test', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(limit);
            if (query) {
                queryBuilder = queryBuilder.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
            }
            const { data: orgs, error } = await queryBuilder;
            if (error) {
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
}
