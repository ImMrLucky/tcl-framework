import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
/**
 * Setup issue signoffs API routes
 */
export function setupIssueSignoffsRoutes(app) {
    // ============================================================================
    // GET /api/issues/:issueId/signoffs - Get signoffs for an issue decision
    // ============================================================================
    app.get('/api/issues/:issueId/signoffs', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { issueId } = req.params;
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get decision for this issue
            const { data: decision, error: decisionError } = await supabaseAdmin
                .from('issue_decisions')
                .select('id')
                .eq('org_id', context.orgId)
                .eq('issue_id', issueId)
                .maybeSingle();
            if (decisionError) {
                return res.status(500).json({ error: `Failed to fetch decision: ${decisionError.message}` });
            }
            if (!decision) {
                // No decision exists, return empty signoffs
                return res.json({ signoffs: [] });
            }
            // Get signoffs for this decision
            const { data: signoffs, error: signoffsError } = await supabaseAdmin
                .from('issue_signoffs')
                .select('*')
                .eq('decision_id', decision.id)
                .order('signed_at', { ascending: true });
            if (signoffsError) {
                return res.status(500).json({ error: `Failed to fetch signoffs: ${signoffsError.message}` });
            }
            res.json({ signoffs: signoffs || [] });
        }
        catch (error) {
            console.error('Get issue signoffs error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // POST /api/issues/:issueId/signoff - Create a signoff
    // ============================================================================
    app.post('/api/issues/:issueId/signoff', requireEntitlement('reviewerSignoff'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { issueId } = req.params;
            const { role, note } = req.body;
            if (!role) {
                return res.status(400).json({ error: 'role is required' });
            }
            // Validate role
            const validRoles = ['QA', 'COMPLIANCE', 'LEGAL', 'MANAGER'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({ error: `Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}` });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get decision for this issue
            const { data: decision, error: decisionError } = await supabaseAdmin
                .from('issue_decisions')
                .select('id')
                .eq('org_id', context.orgId)
                .eq('issue_id', issueId)
                .maybeSingle();
            if (decisionError) {
                return res.status(500).json({ error: `Failed to fetch decision: ${decisionError.message}` });
            }
            if (!decision) {
                return res.status(404).json({ error: 'Decision not found. A decision must exist before adding signoffs.' });
            }
            // Check if signoff already exists for this role
            const { data: existingSignoff } = await supabaseAdmin
                .from('issue_signoffs')
                .select('id')
                .eq('decision_id', decision.id)
                .eq('role', role)
                .maybeSingle();
            if (existingSignoff) {
                return res.status(409).json({ error: `Signoff for role '${role}' already exists for this decision. Signoffs are immutable.` });
            }
            // Create signoff
            const { data: signoff, error: signoffError } = await supabaseAdmin
                .from('issue_signoffs')
                .insert({
                org_id: context.orgId,
                decision_id: decision.id,
                role,
                signed_by_user_id: context.userId,
                note: note || null,
            })
                .select()
                .single();
            if (signoffError) {
                return res.status(500).json({ error: `Failed to create signoff: ${signoffError.message}` });
            }
            // Create event log entry in decision events
            await supabaseAdmin
                .from('issue_decision_events')
                .insert({
                decision_id: decision.id,
                event_type: 'SIGNED_OFF',
                payload_json: {
                    role,
                    note: note ? note.substring(0, 500) : undefined,
                },
                actor_user_id: context.userId,
            });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: 'issue.signoff.create',
                targetType: 'issue_signoff',
                targetId: signoff.id,
                meta: {
                    issueId,
                    decisionId: decision.id,
                    role,
                },
            });
            res.json({ success: true, signoff });
        }
        catch (error) {
            console.error('Create issue signoff error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
}
