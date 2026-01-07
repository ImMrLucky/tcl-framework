/**
 * Policy Library Routes
 * Handles policy CRUD, versioning, activation, and archiving
 */
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
export function setupPolicyRoutes(app) {
    // ============================================================================
    // POST /api/policies - Create a new policy
    // ============================================================================
    app.post('/api/policies', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { name, description, content, version, metadata } = req.body;
            if (!name || !content) {
                return res.status(400).json({ error: 'Name and content are required' });
            }
            const { data: policy, error } = await supabaseAdmin
                .from('policies')
                .insert({
                org_id: context.orgId,
                name,
                description: description || null,
                content,
                version: version || '1.0.0',
                metadata: metadata || {},
                status: 'draft',
                created_by: context.userId || null,
            })
                .select()
                .single();
            if (error) {
                console.error('Create policy error:', error);
                return res.status(500).json({ error: error.message });
            }
            res.json({ policy });
        }
        catch (e) {
            console.error('Create policy error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/policies - List policies
    // ============================================================================
    app.get('/api/policies', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const status = req.query.status;
            const name = req.query.name;
            let query = supabaseAdmin
                .from('policies')
                .select('*')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (status) {
                query = query.eq('status', status);
            }
            if (name) {
                query = query.ilike('name', `%${name}%`);
            }
            const { data: policies, error } = await query;
            if (error) {
                console.error('List policies error:', error);
                return res.status(500).json({ error: error.message });
            }
            res.json({ policies: policies || [] });
        }
        catch (e) {
            console.error('List policies error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/policies/:id - Get a single policy with version history
    // ============================================================================
    app.get('/api/policies/:id', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            // Get the policy
            const { data: policy, error: policyError } = await supabaseAdmin
                .from('policies')
                .select('*')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (policyError || !policy) {
                return res.status(404).json({ error: 'Policy not found' });
            }
            // Get all versions of this policy (same name, different versions)
            const { data: versions, error: versionsError } = await supabaseAdmin
                .from('policies')
                .select('id, version, status, created_at, activated_at, archived_at')
                .eq('org_id', context.orgId)
                .eq('name', policy.name)
                .order('created_at', { ascending: false });
            // Get linked sources
            const { data: sources, error: sourcesError } = await supabaseAdmin
                .from('policy_sources')
                .select('*, sources(*)')
                .eq('policy_id', id);
            // Get linked issues
            const { data: issueLinks, error: issueLinksError } = await supabaseAdmin
                .from('issue_policy_links')
                .select('*')
                .eq('policy_id', id);
            res.json({
                policy,
                versions: versions || [],
                sources: sources || [],
                issueLinks: issueLinks || [],
            });
        }
        catch (e) {
            console.error('Get policy error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/policies/:id/activate - Activate a policy
    // ============================================================================
    app.post('/api/policies/:id/activate', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            // Get the policy
            const { data: policy, error: policyError } = await supabaseAdmin
                .from('policies')
                .select('*')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (policyError || !policy) {
                return res.status(404).json({ error: 'Policy not found' });
            }
            // Archive other active versions of the same policy name
            await supabaseAdmin
                .from('policies')
                .update({
                status: 'archived',
                archived_at: new Date().toISOString(),
            })
                .eq('org_id', context.orgId)
                .eq('name', policy.name)
                .eq('status', 'active');
            // Activate this policy
            const { data: updatedPolicy, error: updateError } = await supabaseAdmin
                .from('policies')
                .update({
                status: 'active',
                activated_at: new Date().toISOString(),
            })
                .eq('id', id)
                .select()
                .single();
            if (updateError) {
                console.error('Activate policy error:', updateError);
                return res.status(500).json({ error: updateError.message });
            }
            res.json({ policy: updatedPolicy });
        }
        catch (e) {
            console.error('Activate policy error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/policies/:id/archive - Archive a policy
    // ============================================================================
    app.post('/api/policies/:id/archive', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            // Get the policy
            const { data: policy, error: policyError } = await supabaseAdmin
                .from('policies')
                .select('*')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (policyError || !policy) {
                return res.status(404).json({ error: 'Policy not found' });
            }
            // Archive the policy
            const { data: updatedPolicy, error: updateError } = await supabaseAdmin
                .from('policies')
                .update({
                status: 'archived',
                archived_at: new Date().toISOString(),
            })
                .eq('id', id)
                .select()
                .single();
            if (updateError) {
                console.error('Archive policy error:', updateError);
                return res.status(500).json({ error: updateError.message });
            }
            res.json({ policy: updatedPolicy });
        }
        catch (e) {
            console.error('Archive policy error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // PUT /api/policies/:id - Update a policy
    // ============================================================================
    app.put('/api/policies/:id', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            const { name, description, content, version, metadata } = req.body;
            // Get the existing policy
            const { data: existingPolicy, error: policyError } = await supabaseAdmin
                .from('policies')
                .select('*')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (policyError || !existingPolicy) {
                return res.status(404).json({ error: 'Policy not found' });
            }
            // Update the policy
            const updateData = {};
            if (name !== undefined)
                updateData.name = name;
            if (description !== undefined)
                updateData.description = description;
            if (content !== undefined)
                updateData.content = content;
            if (version !== undefined)
                updateData.version = version;
            if (metadata !== undefined)
                updateData.metadata = metadata;
            const { data: updatedPolicy, error: updateError } = await supabaseAdmin
                .from('policies')
                .update(updateData)
                .eq('id', id)
                .select()
                .single();
            if (updateError) {
                console.error('Update policy error:', updateError);
                return res.status(500).json({ error: updateError.message });
            }
            res.json({ policy: updatedPolicy });
        }
        catch (e) {
            console.error('Update policy error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
