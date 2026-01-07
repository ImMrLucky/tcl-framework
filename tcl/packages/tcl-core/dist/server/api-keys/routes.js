/**
 * API Key Management Routes
 * Handles creation, listing, and revocation of API keys
 */
import { supabaseAdmin, generateApiKey, logAudit } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { Capability } from '../plans/capabilities.js';
import { planService } from '../plans/plan-service.js';
export function setupApiKeyRoutes(app) {
    // ============================================================================
    // GET /api/api-keys - List API keys for current org
    // ============================================================================
    app.get('/api/api-keys', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { data: keys, error } = await supabaseAdmin
                .from('api_keys')
                .select('id, name, prefix, mode, created_at, last_used_at, revoked_at')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            const response = (keys || []).map((k) => ({
                id: k.id,
                name: k.name,
                prefix: k.prefix,
                mode: (k.mode || 'SANDBOX'),
                createdAt: k.created_at,
                lastUsedAt: k.last_used_at || undefined,
            }));
            res.json({ keys: response });
        }
        catch (e) {
            console.error('List API keys error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/api-keys - Create new API key
    // ============================================================================
    app.post('/api/api-keys', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { name, mode } = req.body;
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'name is required' });
            }
            const keyMode = (mode || 'SANDBOX');
            // Check capability based on requested mode
            const requiredCapability = keyMode === 'PROD'
                ? Capability.API_ACCESS_PROD
                : Capability.API_ACCESS_SANDBOX;
            const hasCap = await planService.hasCapability(context.orgId, requiredCapability);
            if (!hasCap) {
                const planContext = await planService.getOrgPlanContext(context.orgId);
                return res.status(403).json({
                    error: 'UPGRADE_REQUIRED',
                    requiredCapability: requiredCapability,
                    currentPlan: planContext.tier,
                    message: `Creating ${keyMode} API keys requires ${requiredCapability}. Your current plan (${planContext.tier}) does not include this capability.`,
                });
            }
            // Generate API key
            const { key, prefix, hash } = generateApiKey();
            // Get default project and env for the key
            const defaultProject = context.projectId || '';
            const defaultEnv = keyMode === 'PROD' ? 'production' : 'sandbox';
            const { data, error: insertError } = await supabaseAdmin
                .from('api_keys')
                .insert({
                org_id: context.orgId,
                project_id: defaultProject || null,
                env: defaultEnv,
                name: name.trim(),
                key_hash: hash,
                prefix,
                mode: keyMode,
                scopes: ['validate:write', 'validate:read'],
                is_active: true,
            })
                .select('id, name, prefix, mode, created_at')
                .single();
            if (insertError) {
                return res.status(500).json({ error: insertError.message });
            }
            // Return key only once (never again)
            const response = {
                id: data.id,
                name: data.name,
                prefix: data.prefix,
                mode: (data.mode || 'SANDBOX'),
                createdAt: data.created_at,
                key, // Only returned on creation
            };
            res.json(response);
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'apikey.create',
                targetType: 'api_key',
                targetId: data.id,
                meta: { name: data.name, mode: keyMode }
            });
        }
        catch (e) {
            console.error('Create API key error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // DELETE /api/api-keys/:id - Revoke API key
    // ============================================================================
    app.delete('/api/api-keys/:id', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            // Verify key belongs to org
            const { data: key, error: fetchError } = await supabaseAdmin
                .from('api_keys')
                .select('id, name, org_id')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (fetchError || !key) {
                return res.status(404).json({ error: 'API key not found' });
            }
            // Revoke key
            const { error: updateError } = await supabaseAdmin
                .from('api_keys')
                .update({
                revoked_at: new Date().toISOString(),
                is_active: false,
            })
                .eq('id', id)
                .eq('org_id', context.orgId);
            if (updateError) {
                return res.status(500).json({ error: updateError.message });
            }
            res.json({ success: true, message: 'API key revoked' });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'apikey.revoke',
                targetType: 'api_key',
                targetId: id,
                meta: { name: key.name }
            });
        }
        catch (e) {
            console.error('Revoke API key error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
