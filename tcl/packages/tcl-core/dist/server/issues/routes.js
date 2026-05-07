/**
 * Issue Workflow Routes
 * Handles issue triage: status, assignment, comments, and activity log
 */
import { createHash } from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { toIssueDto } from '../dto/issue.dto.js';
import { requirePermission } from '../permissions/middleware.js';
export function setupIssueWorkflowRoutes(app) {
    // ============================================================================
    // GET /api/issues-v2 - List issues with filters and pagination
    // ============================================================================
    app.get('/api/issues-v2', requirePermission('view_issues'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get user ID from token if available
            const authHeader = req.headers.authorization;
            let userId;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
                userId = user?.id;
            }
            // Parse query parameters
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const offset = parseInt(req.query.offset) || 0;
            const status = req.query.status;
            const severityDisplay = req.query.severityDisplay;
            const verificationLevel = req.query.verificationLevel;
            const category = req.query.category;
            const type = req.query.type;
            const assigneeUserId = req.query.assigneeUserId;
            const dateFrom = req.query.dateFrom;
            const dateTo = req.query.dateTo;
            const evaluationId = req.query.evaluationId;
            // Build evaluation query
            // Limit to prevent loading too many evaluations at once (each can have many issues)
            let evalQuery = supabaseAdmin
                .from('evaluations')
                .select('id, report, created_at')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false })
                .limit(100); // Limit evaluations to prevent huge responses
            if (evaluationId) {
                evalQuery = evalQuery.eq('id', evaluationId);
            }
            if (dateFrom || dateTo) {
                if (dateFrom) {
                    evalQuery = evalQuery.gte('created_at', dateFrom);
                }
                if (dateTo) {
                    evalQuery = evalQuery.lte('created_at', dateTo);
                }
            }
            const { data: evaluations, error: evalError } = await evalQuery;
            if (evalError) {
                return res.status(500).json({ error: evalError.message });
            }
            if (!evaluations || evaluations.length === 0) {
                return res.json({ issues: [], total: 0 });
            }
            // Extract all issues from evaluations
            const allIssues = [];
            for (const eval_ of evaluations) {
                const report = eval_.report;
                const issues = report?.issues || report?.topIssuesV2 || report?.allIssuesV2 || [];
                for (const issue of issues) {
                    // Ensure issue has required fields
                    if (!issue || !issue.issueId) {
                        console.warn('Skipping issue without issueId:', issue);
                        continue;
                    }
                    // Transform old issue format to IssueV2 format
                    // Handle both old format (risk.severity, what.claimSummary) and new format
                    // Compute score from available data (confidence, contradictions, etc.)
                    const importance = issue.confidence?.importance ?? 0.5;
                    const nodeBlame = issue.confidence?.nodeBlameNorm ?? 0;
                    const nliScore = issue.confidence?.nliScore ?? 0;
                    // Check if there are contradictions (higher risk)
                    const hasContradictions = (issue.conflictsWith && issue.conflictsWith.length > 0) ||
                        (issue.conflictsWith && Array.isArray(issue.conflictsWith) && issue.conflictsWith.length > 0);
                    const contradictionBoost = hasContradictions ? 0.15 : 0;
                    // Compute risk score from available signals
                    // Base: importance (0-1)
                    // Boost: nodeBlame (0-1) * 0.3 (contradictions/conflicts)
                    // Boost: nliScore (0-1) * 0.2 (NLI confidence)
                    // Boost: contradiction presence * 0.15
                    const computedRiskScore = Math.min(1.0, (importance * 0.5) +
                        (nodeBlame * 0.3) +
                        (nliScore * 0.2) +
                        contradictionBoost);
                    // Derive severity from computed risk score
                    const deriveSeverityFromScore = (riskScore) => {
                        if (riskScore >= 0.75)
                            return 'high';
                        if (riskScore >= 0.5)
                            return 'medium';
                        return 'low';
                    };
                    const derivedSeverity = deriveSeverityFromScore(computedRiskScore);
                    // Use DTO mapper to ensure no raw object spreading
                    // Preserve computed score if issue doesn't have one
                    const issueWithComputedScore = {
                        ...issue,
                        // Override score/riskScore if not present (DTO will use these)
                        score: issue.score ?? Math.round(computedRiskScore * 100),
                        riskScore: issue.riskScore ?? computedRiskScore,
                        // Override severity/impact if not present (DTO will use these)
                        severity: issue.severity || derivedSeverity,
                        severityDisplay: issue.severityDisplay || (derivedSeverity === 'high' ? 'high' : derivedSeverity === 'medium' ? 'medium' : 'low'),
                        impact: issue.impact || (derivedSeverity === 'high' || (derivedSeverity === 'medium' && hasContradictions) ? 'high' : derivedSeverity === 'medium' ? 'medium' : 'low'),
                    };
                    // Use DTO mapper (explicit field mapping, no spreading)
                    const transformedIssue = toIssueDto(issueWithComputedScore, eval_.id, eval_.created_at);
                    allIssues.push(transformedIssue);
                }
            }
            // Get workflow records for all issue IDs
            const issueIds = allIssues.map(i => i.issueId).filter(Boolean);
            const { data: workflows, error: workflowError } = await supabaseAdmin
                .from('issue_workflow')
                .select('*')
                .in('issue_id', issueIds)
                .eq('org_id', context.orgId);
            if (workflowError) {
                console.error('Error fetching workflows:', workflowError);
            }
            // Get decision records for all issue IDs (if issueDecisions entitlement is enabled)
            let decisions = [];
            try {
                const { entitlementsService } = await import('../entitlements/entitlements-service.js');
                const hasIssueDecisions = await entitlementsService.has(context.orgId, 'issueDecisions');
                if (hasIssueDecisions) {
                    const { data: decisionsData, error: decisionsError } = await supabaseAdmin
                        .from('issue_decisions')
                        .select('*')
                        .in('issue_id', issueIds)
                        .eq('org_id', context.orgId);
                    if (decisionsError) {
                        console.error('Error fetching decisions:', decisionsError);
                    }
                    else {
                        decisions = decisionsData || [];
                    }
                }
            }
            catch (e) {
                // Entitlements check failed, skip decisions
                console.warn('Failed to check issueDecisions entitlement:', e);
            }
            // Create a map of issue_id -> workflow
            const workflowMap = new Map((workflows || []).map(w => [w.issue_id, w]));
            // Create a map of issue_id -> decision
            const decisionMap = new Map(decisions.map(d => [d.issue_id, d]));
            // Merge issues with workflow and decision data
            let enrichedIssues = allIssues.map(issue => {
                const workflow = workflowMap.get(issue.issueId);
                const decision = decisionMap.get(issue.issueId);
                return {
                    ...issue,
                    status: workflow?.status || decision?.disposition || 'OPEN',
                    assigneeUserId: workflow?.assignee_user_id || decision?.assigned_to_user_id || null,
                    workflowUpdatedAt: workflow?.updated_at || null,
                    // Decision fields
                    decision: decision ? {
                        id: decision.id,
                        disposition: decision.disposition,
                        severityOverride: decision.severity_override,
                        assignedToUserId: decision.assigned_to_user_id,
                        notes: decision.notes,
                        expiresAt: decision.expires_at,
                        createdAt: decision.created_at,
                        updatedAt: decision.updated_at,
                    } : null,
                };
            });
            // Apply filters
            if (status) {
                enrichedIssues = enrichedIssues.filter(i => i.status === status);
            }
            if (severityDisplay) {
                enrichedIssues = enrichedIssues.filter(i => i.severityDisplay === severityDisplay);
            }
            if (verificationLevel) {
                enrichedIssues = enrichedIssues.filter(i => i.verification?.level === verificationLevel);
            }
            if (category) {
                enrichedIssues = enrichedIssues.filter(i => i.category === category);
            }
            if (type) {
                enrichedIssues = enrichedIssues.filter(i => i.type === type);
            }
            if (assigneeUserId) {
                enrichedIssues = enrichedIssues.filter(i => i.assigneeUserId === assigneeUserId);
            }
            // Sort by riskScore descending, then by createdAt
            enrichedIssues.sort((a, b) => {
                const scoreA = a.score ?? (a.riskScore ?? 0) * 100;
                const scoreB = b.score ?? (b.riskScore ?? 0) * 100;
                if (scoreB !== scoreA) {
                    return scoreB - scoreA;
                }
                const dateA = new Date(a.evaluationCreatedAt || a.audit?.createdAt || 0).getTime();
                const dateB = new Date(b.evaluationCreatedAt || b.audit?.createdAt || 0).getTime();
                return dateB - dateA;
            });
            // Paginate
            const total = enrichedIssues.length;
            const paginatedIssues = enrichedIssues.slice(offset, offset + limit);
            res.json({
                issues: paginatedIssues,
                total,
                limit,
                offset,
            });
        }
        catch (e) {
            console.error('Get issues-v2 error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/issues-v2/:issueId/status - Update issue status
    // ============================================================================
    app.post('/api/issues-v2/:issueId/status', async (req, res) => {
        try {
            const { issueId } = req.params;
            const { status } = req.body;
            if (!status || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status. Must be OPEN, ACKNOWLEDGED, RESOLVED, or FALSE_POSITIVE' });
            }
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get user ID
            const authHeader = req.headers.authorization;
            let userId;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
                userId = user?.id;
            }
            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }
            // Get or create workflow record
            const { data: existingWorkflow } = await supabaseAdmin
                .from('issue_workflow')
                .select('*')
                .eq('issue_id', issueId)
                .eq('org_id', context.orgId)
                .maybeSingle();
            const oldStatus = existingWorkflow?.status || 'OPEN';
            // Upsert workflow record
            const { data: workflow, error: workflowError } = await supabaseAdmin
                .from('issue_workflow')
                .upsert({
                issue_id: issueId,
                org_id: context.orgId,
                status,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'issue_id',
            })
                .select()
                .single();
            if (workflowError) {
                return res.status(500).json({ error: workflowError.message });
            }
            // Log action
            await supabaseAdmin
                .from('issue_actions_log')
                .insert({
                issue_id: issueId,
                org_id: context.orgId,
                actor_user_id: userId,
                action_type: 'STATUS_CHANGE',
                payload_json: {
                    oldStatus,
                    newStatus: status,
                },
            });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'issue.status.update',
                targetType: 'issue',
                targetId: issueId,
                meta: { oldStatus, newStatus: status },
            });
            res.json({ success: true, workflow });
        }
        catch (e) {
            console.error('Update issue status error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/issues-v2/:issueId/assign - Assign issue to user
    // ============================================================================
    app.post('/api/issues-v2/:issueId/assign', async (req, res) => {
        try {
            const { issueId } = req.params;
            const { assigneeUserId } = req.body; // null to unassign
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get actor user ID
            const authHeader = req.headers.authorization;
            let actorUserId;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
                actorUserId = user?.id;
            }
            if (!actorUserId) {
                return res.status(401).json({ error: 'User authentication required' });
            }
            // Get existing workflow
            const { data: existingWorkflow } = await supabaseAdmin
                .from('issue_workflow')
                .select('*')
                .eq('issue_id', issueId)
                .eq('org_id', context.orgId)
                .maybeSingle();
            const oldAssignee = existingWorkflow?.assignee_user_id || null;
            // Upsert workflow record
            const { data: workflow, error: workflowError } = await supabaseAdmin
                .from('issue_workflow')
                .upsert({
                issue_id: issueId,
                org_id: context.orgId,
                assignee_user_id: assigneeUserId || null,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'issue_id',
            })
                .select()
                .single();
            if (workflowError) {
                return res.status(500).json({ error: workflowError.message });
            }
            // Log action
            await supabaseAdmin
                .from('issue_actions_log')
                .insert({
                issue_id: issueId,
                org_id: context.orgId,
                actor_user_id: actorUserId,
                action_type: 'ASSIGNMENT',
                payload_json: {
                    oldAssignee,
                    newAssignee: assigneeUserId || null,
                },
            });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: 'issue.assign',
                targetType: 'issue',
                targetId: issueId,
                meta: { oldAssignee, newAssignee: assigneeUserId },
            });
            res.json({ success: true, workflow });
        }
        catch (e) {
            console.error('Assign issue error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/issues-v2/:issueId/comment - Add comment to issue
    // ============================================================================
    app.post('/api/issues-v2/:issueId/comment', async (req, res) => {
        try {
            const { issueId } = req.params;
            const { body } = req.body;
            if (!body || typeof body !== 'string' || body.trim().length === 0) {
                return res.status(400).json({ error: 'Comment body is required' });
            }
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get user ID
            const authHeader = req.headers.authorization;
            let userId;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
                userId = user?.id;
            }
            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }
            // Ensure workflow record exists
            await supabaseAdmin
                .from('issue_workflow')
                .upsert({
                issue_id: issueId,
                org_id: context.orgId,
            }, {
                onConflict: 'issue_id',
            });
            // Insert comment
            const { data: comment, error: commentError } = await supabaseAdmin
                .from('issue_comments')
                .insert({
                issue_id: issueId,
                org_id: context.orgId,
                actor_user_id: userId,
                body: body.trim(),
            })
                .select()
                .single();
            if (commentError) {
                return res.status(500).json({ error: commentError.message });
            }
            // Log action
            await supabaseAdmin
                .from('issue_actions_log')
                .insert({
                issue_id: issueId,
                org_id: context.orgId,
                actor_user_id: userId,
                action_type: 'COMMENT',
                payload_json: {
                    commentId: comment.id,
                },
            });
            res.json({ success: true, comment });
        }
        catch (e) {
            console.error('Add comment error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/issues-v2/:issueId/activity - Get activity log (comments + actions)
    // ============================================================================
    app.get('/api/issues-v2/:issueId/activity', async (req, res) => {
        try {
            const { issueId } = req.params;
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get comments
            const { data: comments, error: commentsError } = await supabaseAdmin
                .from('issue_comments')
                .select('*, actor_user_id')
                .eq('issue_id', issueId)
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (commentsError) {
                return res.status(500).json({ error: commentsError.message });
            }
            // Get action log
            const { data: actions, error: actionsError } = await supabaseAdmin
                .from('issue_actions_log')
                .select('*, actor_user_id')
                .eq('issue_id', issueId)
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (actionsError) {
                return res.status(500).json({ error: actionsError.message });
            }
            // Get user profiles for actors
            const userIds = new Set();
            (comments || []).forEach(c => c.actor_user_id && userIds.add(c.actor_user_id));
            (actions || []).forEach(a => a.actor_user_id && userIds.add(a.actor_user_id));
            const userProfiles = {};
            if (userIds.size > 0) {
                const { data: profiles } = await supabaseAdmin
                    .from('profiles')
                    .select('id, email, full_name')
                    .in('id', Array.from(userIds));
                (profiles || []).forEach(p => {
                    userProfiles[p.id] = p;
                });
            }
            // Combine and sort by created_at
            const activity = [
                ...(comments || []).map(c => ({
                    type: 'comment',
                    id: c.id,
                    actor: userProfiles[c.actor_user_id] || { id: c.actor_user_id },
                    body: c.body,
                    createdAt: c.created_at,
                })),
                ...(actions || []).map(a => ({
                    type: 'action',
                    id: a.id,
                    actor: userProfiles[a.actor_user_id] || { id: a.actor_user_id },
                    actionType: a.action_type,
                    payload: a.payload_json,
                    createdAt: a.created_at,
                })),
            ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            res.json({ activity });
        }
        catch (e) {
            console.error('Get activity error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/issues-v2/bulk - Bulk actions (status change, assignment)
    // ============================================================================
    app.post('/api/issues-v2/bulk', async (req, res) => {
        try {
            const { issueIds, action, payload } = req.body;
            if (!Array.isArray(issueIds) || issueIds.length === 0) {
                return res.status(400).json({ error: 'issueIds must be a non-empty array' });
            }
            if (!action || !['status', 'assign'].includes(action)) {
                return res.status(400).json({ error: 'action must be "status" or "assign"' });
            }
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get user ID
            const authHeader = req.headers.authorization;
            let userId;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
                userId = user?.id;
            }
            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }
            const results = [];
            const errors = [];
            for (const issueId of issueIds) {
                try {
                    if (action === 'status') {
                        const status = payload?.status;
                        if (!status || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) {
                            errors.push({ issueId, error: 'Invalid status' });
                            continue;
                        }
                        await supabaseAdmin
                            .from('issue_workflow')
                            .upsert({
                            issue_id: issueId,
                            org_id: context.orgId,
                            status,
                            updated_at: new Date().toISOString(),
                        }, {
                            onConflict: 'issue_id',
                        });
                        await supabaseAdmin
                            .from('issue_actions_log')
                            .insert({
                            issue_id: issueId,
                            org_id: context.orgId,
                            actor_user_id: userId,
                            action_type: 'BULK_STATUS_CHANGE',
                            payload_json: { status },
                        });
                        results.push({ issueId, success: true });
                    }
                    else if (action === 'assign') {
                        const assigneeUserId = payload?.assigneeUserId;
                        await supabaseAdmin
                            .from('issue_workflow')
                            .upsert({
                            issue_id: issueId,
                            org_id: context.orgId,
                            assignee_user_id: assigneeUserId || null,
                            updated_at: new Date().toISOString(),
                        }, {
                            onConflict: 'issue_id',
                        });
                        await supabaseAdmin
                            .from('issue_actions_log')
                            .insert({
                            issue_id: issueId,
                            org_id: context.orgId,
                            actor_user_id: userId,
                            action_type: 'BULK_ASSIGNMENT',
                            payload_json: { assigneeUserId },
                        });
                        results.push({ issueId, success: true });
                    }
                }
                catch (e) {
                    errors.push({ issueId, error: e.message });
                }
            }
            // Log audit
            await logAudit({
                orgId: context.orgId,
                action: `issue.bulk.${action}`,
                targetType: 'issue',
                meta: { issueIds, action, payload, resultsCount: results.length, errorsCount: errors.length },
            });
            res.json({ results, errors });
        }
        catch (e) {
            console.error('Bulk action error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // Pattern Key Generation
    // ============================================================================
    /**
     * Generate deterministic pattern key from issue
     * Hash of: type + category + normalized claim text + speaker role
     */
    function generatePatternKey(issue) {
        try {
            const type = issue?.type || issue?.what?.issueType || 'UNVERIFIED_CLAIM';
            const category = issue?.category || issue?.risk?.category || 'evidence';
            // Normalize claim text: lowercase, remove extra whitespace, remove quotes
            const claimText = issue?.what?.claimText || issue?.what?.claimSummary || issue?.what?.issueSummary || '';
            const normalizedClaim = (claimText || '')
                .toString()
                .toLowerCase()
                .trim()
                .replace(/["'`]/g, '')
                .replace(/\s+/g, ' ')
                .substring(0, 200); // Limit length for consistency
            // Normalize speaker role (AGENT, CUSTOMER, SYSTEM, UNKNOWN)
            const speaker = issue?.who?.speaker || issue?.who?.speakerType || 'UNKNOWN';
            const normalizedRole = (speaker || 'UNKNOWN').toString().toUpperCase();
            // Create deterministic hash
            const input = `${type}|${category}|${normalizedClaim}|${normalizedRole}`;
            return createHash('sha256').update(input).digest('hex').substring(0, 16);
        }
        catch (error) {
            console.error('Error generating pattern key:', error);
            // Fallback to a simple hash based on category and type
            const category = issue?.category || 'unknown';
            const type = issue?.type || 'UNKNOWN';
            const fallbackInput = `${category}:${type}:${Date.now()}`;
            return createHash('sha256').update(fallbackInput).digest('hex').substring(0, 16);
        }
    }
    // ============================================================================
    // GET /api/issues/queue - Aggregated pattern queue
    // ============================================================================
    app.get('/api/issues/queue', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Parse query parameters
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const pageSize = Math.min(100, Math.max(10, parseInt(req.query.pageSize) || 25));
            const offset = (page - 1) * pageSize;
            const dateFrom = req.query.from;
            const dateTo = req.query.to;
            const severityFilter = req.query.severity;
            const verificationFilter = req.query.verification;
            const statusFilter = req.query.status;
            const typeFilter = req.query.type;
            const categoryFilter = req.query.category;
            const assigneeFilter = req.query.assignee;
            const searchQuery = req.query.q;
            // Build evaluation query (same as /api/issues-v2)
            let evalQuery = supabaseAdmin
                .from('evaluations')
                .select('id, report, created_at')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false })
                .limit(100);
            if (dateFrom) {
                evalQuery = evalQuery.gte('created_at', dateFrom);
            }
            if (dateTo) {
                evalQuery = evalQuery.lte('created_at', dateTo);
            }
            const { data: evaluations, error: evalError } = await evalQuery;
            if (evalError) {
                return res.status(500).json({ error: evalError.message });
            }
            if (!evaluations || evaluations.length === 0) {
                return res.json({ rows: [], total: 0, page, pageSize });
            }
            // Extract all issues and transform to IssueV2 format
            const allIssues = [];
            for (const eval_ of evaluations) {
                try {
                    const report = eval_.report;
                    if (!report)
                        continue;
                    // Try to get issues from various possible locations in the report
                    const issues = report?.issues?.atomic ||
                        report?.issues?.grouped ||
                        report?.topIssuesV2 ||
                        report?.allIssuesV2 ||
                        report?.issues ||
                        [];
                    if (!Array.isArray(issues))
                        continue;
                    for (const issue of issues) {
                        if (!issue || !issue.issueId)
                            continue;
                        try {
                            // Transform to IssueV2 format (same logic as /api/issues-v2)
                            const importance = issue.confidence?.importance ?? 0.5;
                            const nodeBlame = issue.confidence?.nodeBlameNorm ?? 0;
                            const nliScore = issue.confidence?.nliScore ?? 0;
                            const hasContradictions = (issue.conflictsWith && issue.conflictsWith.length > 0);
                            const contradictionBoost = hasContradictions ? 0.15 : 0;
                            const computedRiskScore = Math.min(1.0, (importance * 0.5) + (nodeBlame * 0.3) + (nliScore * 0.2) + contradictionBoost);
                            const deriveSeverityFromScore = (riskScore) => {
                                if (riskScore >= 0.75)
                                    return 'high';
                                if (riskScore >= 0.5)
                                    return 'medium';
                                return 'low';
                            };
                            const derivedSeverity = deriveSeverityFromScore(computedRiskScore);
                            const deriveImpact = (severity, hasContradictions) => {
                                if (severity === 'high' || (severity === 'medium' && hasContradictions))
                                    return 'high';
                                if (severity === 'medium')
                                    return 'medium';
                                return 'low';
                            };
                            const transformedIssue = {
                                ...issue,
                                evaluationId: eval_.id,
                                evaluationCreatedAt: eval_.created_at,
                                severity: issue.severity || derivedSeverity,
                                severityDisplay: issue.severityDisplay || (derivedSeverity === 'high' ? 'high' : derivedSeverity === 'medium' ? 'medium' : 'low'),
                                category: issue.category || issue.risk?.category || 'evidence',
                                type: issue.type || issue.what?.issueType || 'UNVERIFIED_CLAIM',
                                impact: issue.impact || deriveImpact(derivedSeverity, hasContradictions),
                                score: issue.score ?? Math.round(computedRiskScore * 100),
                                riskScore: issue.riskScore ?? computedRiskScore,
                                what: {
                                    ...issue.what,
                                    issueSummary: issue.what?.issueSummary || issue.what?.claimSummary || issue.what?.claimText || '',
                                    issueDetail: issue.what?.issueDetail || issue.what?.description || issue.what?.claimText || '',
                                    primaryClaimId: issue.what?.primaryClaimId || issue.claimId || '',
                                    claimText: issue.what?.claimText || issue.what?.claimSummary || '',
                                },
                                verification: issue.verification || { level: 'NONE', reasonCodes: [] },
                                who: issue.who || { speaker: 'UNKNOWN' },
                                evidence: issue.evidence || { refs: [] },
                                compliance: issue.compliance || { tags: [], disclaimers: [] },
                                audit: issue.audit || { createdAt: eval_.created_at, engineVersion: '', scorerId: '' },
                            };
                            allIssues.push(transformedIssue);
                        }
                        catch (issueError) {
                            console.warn(`Failed to transform issue ${issue?.issueId || 'unknown'} from evaluation ${eval_.id}:`, issueError?.message || issueError);
                            // Continue processing other issues
                            continue;
                        }
                    }
                }
                catch (evalError) {
                    console.warn(`Failed to process evaluation ${eval_?.id || 'unknown'}:`, evalError?.message || evalError);
                    // Continue processing other evaluations
                    continue;
                }
            }
            // Get workflow records
            const issueIds = allIssues.map(i => i.issueId).filter(Boolean);
            let workflows = [];
            if (issueIds.length > 0) {
                try {
                    const { data, error } = await supabaseAdmin
                        .from('issue_workflow')
                        .select('*')
                        .in('issue_id', issueIds)
                        .eq('org_id', context.orgId);
                    if (!error && data) {
                        workflows = data;
                    }
                }
                catch (e) {
                    console.warn('Failed to load workflows:', e);
                }
            }
            const workflowMap = new Map(workflows.map((w) => [w.issue_id, w]));
            // Enrich issues with workflow data (DTO already includes workflow fields)
            const enrichedIssues = allIssues.map(issue => {
                const workflow = workflowMap.get(issue.issueId);
                // DTO already has status/assigneeUserId fields, just update them
                if (workflow) {
                    issue.status = workflow.status || 'OPEN';
                    issue.assigneeUserId = workflow.assignee_user_id || null;
                    issue.workflowUpdatedAt = workflow.updated_at || null;
                }
                else {
                    issue.status = issue.status || 'OPEN';
                    issue.assigneeUserId = issue.assigneeUserId || null;
                }
                return issue;
            });
            // Generate pattern keys and group
            const patternMap = new Map();
            for (const issue of enrichedIssues) {
                const patternKey = generatePatternKey(issue);
                if (!patternMap.has(patternKey)) {
                    patternMap.set(patternKey, { issues: [], patternKey });
                }
                patternMap.get(patternKey).issues.push(issue);
            }
            // Build pattern rows
            const patternRows = [];
            for (const [patternKey, group] of patternMap.entries()) {
                const issues = group.issues;
                // Apply filters
                if (severityFilter && severityFilter !== 'all') {
                    const filtered = issues.filter(i => (i.severityDisplay || i.severity) === severityFilter);
                    if (filtered.length === 0)
                        continue;
                }
                if (verificationFilter && verificationFilter !== 'all') {
                    const filtered = issues.filter(i => i.verification?.level === verificationFilter);
                    if (filtered.length === 0)
                        continue;
                }
                if (statusFilter && statusFilter !== 'all') {
                    const filtered = issues.filter(i => i.status === statusFilter);
                    if (filtered.length === 0)
                        continue;
                }
                if (typeFilter && typeFilter !== 'all') {
                    const filtered = issues.filter(i => i.type === typeFilter);
                    if (filtered.length === 0)
                        continue;
                }
                if (categoryFilter && categoryFilter !== 'all') {
                    const filtered = issues.filter(i => i.category === categoryFilter);
                    if (filtered.length === 0)
                        continue;
                }
                if (assigneeFilter && assigneeFilter !== 'all') {
                    if (assigneeFilter === 'unassigned') {
                        const filtered = issues.filter(i => !i.assigneeUserId);
                        if (filtered.length === 0)
                            continue;
                    }
                    else {
                        const filtered = issues.filter(i => i.assigneeUserId === assigneeFilter);
                        if (filtered.length === 0)
                            continue;
                    }
                }
                if (searchQuery) {
                    const searchLower = searchQuery.toLowerCase();
                    const matches = issues.some(i => (i.what?.issueSummary || '').toLowerCase().includes(searchLower) ||
                        (i.what?.claimText || '').toLowerCase().includes(searchLower) ||
                        (i.type || '').toLowerCase().includes(searchLower) ||
                        (i.category || '').toLowerCase().includes(searchLower));
                    if (!matches)
                        continue;
                }
                // Get representative issue (highest score)
                const representative = issues.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
                // Compute aggregates
                const riskScores = issues.map(i => i.riskScore ?? 0).filter(s => s > 0);
                const avgRiskScore = riskScores.length > 0
                    ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length
                    : 0;
                const maxRiskScore = riskScores.length > 0 ? Math.max(...riskScores) : 0;
                const dates = issues.map(i => new Date(i.evaluationCreatedAt || i.audit?.createdAt || 0).getTime()).filter(d => d > 0);
                const firstSeenAt = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : new Date().toISOString();
                const lastSeenAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : new Date().toISOString();
                // Verification counts
                const verificationCounts = {
                    EXTERNAL_VERIFIED: issues.filter(i => i.verification?.level === 'EXTERNAL_VERIFIED').length,
                    TRANSCRIPT_ONLY: issues.filter(i => i.verification?.level === 'TRANSCRIPT_ONLY').length,
                    NONE: issues.filter(i => i.verification?.level === 'NONE' || !i.verification?.level).length,
                };
                // Unique agents/customers (from conversation metadata if available)
                const uniqueAgents = new Set(issues.map(i => i.who?.speaker === 'AGENT' ? 'agent' : null).filter(Boolean)).size;
                const uniqueCustomers = new Set(issues.map(i => i.who?.speaker === 'CUSTOMER' ? 'customer' : null).filter(Boolean)).size;
                // Status counts
                const statusCounts = {
                    OPEN: issues.filter(i => i.status === 'OPEN').length,
                    ACKNOWLEDGED: issues.filter(i => i.status === 'ACKNOWLEDGED').length,
                    RESOLVED: issues.filter(i => i.status === 'RESOLVED').length,
                    FALSE_POSITIVE: issues.filter(i => i.status === 'FALSE_POSITIVE').length,
                };
                // Determine pattern status (most common, or OPEN if tie)
                const patternStatus = Object.entries(statusCounts)
                    .sort((a, b) => b[1] - a[1])[0][0];
                // Pattern assignee (most common, or null)
                const assignees = issues.map(i => i.assigneeUserId).filter(Boolean);
                const patternAssignee = assignees.length > 0
                    ? assignees.sort((a, b) => assignees.filter(x => x === a).length - assignees.filter(x => x === b).length).pop() || null
                    : null;
                // Compute trend (simple: compare last 7 days vs previous 7 days)
                const now = Date.now();
                const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
                const fourteenDaysAgo = now - (14 * 24 * 60 * 60 * 1000);
                const recentIssues = issues.filter(i => {
                    const date = new Date(i.evaluationCreatedAt || i.audit?.createdAt || 0).getTime();
                    return date >= sevenDaysAgo;
                });
                const previousIssues = issues.filter(i => {
                    const date = new Date(i.evaluationCreatedAt || i.audit?.createdAt || 0).getTime();
                    return date >= fourteenDaysAgo && date < sevenDaysAgo;
                });
                const recentCount = recentIssues.length;
                const previousCount = previousIssues.length;
                const pctChange = previousCount > 0
                    ? Math.round(((recentCount - previousCount) / previousCount) * 100)
                    : recentCount > 0 ? 100 : 0;
                const trend = {
                    direction: pctChange > 10 ? 'up' : pctChange < -10 ? 'down' : 'flat',
                    pctChange,
                    window: 'prev_period',
                };
                // Compute priority score (combination of recurrence + risk + unresolved)
                const occurrenceWeight = Math.min(issues.length / 10, 1.0) * 0.3; // Cap at 10 occurrences
                const riskWeight = avgRiskScore * 0.5;
                const unresolvedWeight = (statusCounts.OPEN + statusCounts.ACKNOWLEDGED) / issues.length * 0.2;
                const priorityScore = Math.round((occurrenceWeight + riskWeight + unresolvedWeight) * 100);
                // Generate title from representative issue
                const title = representative.what?.issueSummary ||
                    representative.what?.claimSummary ||
                    `${representative.type} in ${representative.category}`;
                const summary = representative.what?.issueDetail ||
                    representative.what?.description ||
                    title;
                patternRows.push({
                    patternKey,
                    title,
                    summary,
                    category: representative.category,
                    type: representative.type,
                    impact: representative.impact,
                    severity: representative.severity,
                    severityDisplay: representative.severityDisplay || representative.severity,
                    occurrences: issues.length,
                    uniqueAgents: uniqueAgents > 0 ? uniqueAgents : undefined,
                    uniqueCustomers: uniqueCustomers > 0 ? uniqueCustomers : undefined,
                    verificationCounts,
                    lastSeenAt,
                    firstSeenAt,
                    trend,
                    status: patternStatus,
                    assignee: patternAssignee,
                    priorityScore,
                    avgRiskScore,
                    maxRiskScore,
                });
            }
            // Sort by priority score DESC, then by occurrences DESC
            patternRows.sort((a, b) => {
                if (b.priorityScore !== a.priorityScore) {
                    return b.priorityScore - a.priorityScore;
                }
                return b.occurrences - a.occurrences;
            });
            // Paginate
            const total = patternRows.length;
            const paginatedRows = patternRows.slice(offset, offset + pageSize);
            res.json({
                rows: paginatedRows,
                total,
                page,
                pageSize,
            });
        }
        catch (e) {
            console.error('Get issue queue error:', e);
            console.error('Error stack:', e?.stack);
            res.status(500).json({
                error: e?.message ?? 'unknown error',
                details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
            });
        }
    });
    // ============================================================================
    // GET /api/issues/pattern/:patternKey - Pattern detail for drawer
    // ============================================================================
    app.get('/api/issues/pattern/:patternKey', async (req, res) => {
        try {
            const { patternKey } = req.params;
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get all evaluations and extract issues (same as queue endpoint)
            let evaluations = [];
            try {
                const { data, error } = await supabaseAdmin
                    .from('evaluations')
                    .select('id, report, created_at')
                    .eq('org_id', context.orgId)
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (!error && data) {
                    evaluations = data;
                }
            }
            catch (e) {
                console.warn('Failed to load evaluations:', e);
            }
            if (!evaluations || evaluations.length === 0) {
                return res.status(404).json({ error: 'Pattern not found' });
            }
            // Extract and transform all issues
            const allIssues = [];
            for (const eval_ of evaluations) {
                try {
                    const report = eval_.report;
                    // Check for new canonical structure first
                    let issues = [];
                    if (report?.issues?.atomic) {
                        issues = report.issues.atomic;
                    }
                    else if (report?.issues?.grouped) {
                        // Flatten grouped issues
                        issues = report.issues.grouped.flatMap((g) => g.issues || []);
                    }
                    else {
                        // Fallback to legacy structure
                        issues = report?.topIssuesV2 || report?.allIssuesV2 || report?.issues || [];
                    }
                    if (!Array.isArray(issues)) {
                        console.warn(`Skipping evaluation ${eval_.id} due to non-array issues:`, issues);
                        continue;
                    }
                    for (const issue of issues) {
                        if (!issue || !issue.issueId)
                            continue;
                        // Same transformation as queue endpoint
                        const importance = issue.confidence?.importance ?? 0.5;
                        const nodeBlame = issue.confidence?.nodeBlameNorm ?? 0;
                        const nliScore = issue.confidence?.nliScore ?? 0;
                        const hasContradictions = (issue.conflictsWith && issue.conflictsWith.length > 0);
                        const contradictionBoost = hasContradictions ? 0.15 : 0;
                        const computedRiskScore = Math.min(1.0, (importance * 0.5) + (nodeBlame * 0.3) + (nliScore * 0.2) + contradictionBoost);
                        const deriveSeverityFromScore = (riskScore) => {
                            if (riskScore >= 0.75)
                                return 'high';
                            if (riskScore >= 0.5)
                                return 'medium';
                            return 'low';
                        };
                        const derivedSeverity = deriveSeverityFromScore(computedRiskScore);
                        const deriveImpact = (severity, hasContradictions) => {
                            if (severity === 'high' || (severity === 'medium' && hasContradictions))
                                return 'high';
                            if (severity === 'medium')
                                return 'medium';
                            return 'low';
                        };
                        const transformedIssue = {
                            ...issue,
                            evaluationId: eval_.id,
                            evaluationCreatedAt: eval_.created_at,
                            severity: issue.severity || derivedSeverity,
                            severityDisplay: issue.severityDisplay || (derivedSeverity === 'high' ? 'high' : derivedSeverity === 'medium' ? 'medium' : 'low'),
                            category: issue.category || issue.risk?.category || 'evidence',
                            type: issue.type || issue.what?.issueType || 'UNVERIFIED_CLAIM',
                            impact: issue.impact || deriveImpact(derivedSeverity, hasContradictions),
                            score: issue.score ?? Math.round(computedRiskScore * 100),
                            riskScore: issue.riskScore ?? computedRiskScore,
                            what: {
                                ...issue.what,
                                issueSummary: issue.what?.issueSummary || issue.what?.claimSummary || issue.what?.claimText || '',
                                issueDetail: issue.what?.issueDetail || issue.what?.description || issue.what?.claimText || '',
                                primaryClaimId: issue.what?.primaryClaimId || issue.claimId || '',
                                claimText: issue.what?.claimText || issue.what?.claimSummary || '',
                            },
                            verification: issue.verification || { level: 'NONE', reasonCodes: [] },
                            who: issue.who || { speaker: 'UNKNOWN' },
                            evidence: issue.evidence || { refs: [] },
                            compliance: issue.compliance || { tags: [], disclaimers: [] },
                            audit: issue.audit || { createdAt: eval_.created_at, engineVersion: '', scorerId: '' },
                        };
                        allIssues.push(transformedIssue);
                    }
                }
                catch (e) {
                    console.error(`Error processing evaluation ${eval_.id}:`, e);
                    // Continue with next evaluation
                }
            }
            // Get workflow records
            const issueIds = allIssues.map(i => i.issueId).filter(Boolean);
            let workflows = [];
            if (issueIds.length > 0) {
                try {
                    const { data, error } = await supabaseAdmin
                        .from('issue_workflow')
                        .select('*')
                        .in('issue_id', issueIds)
                        .eq('org_id', context.orgId);
                    if (!error && data) {
                        workflows = data;
                    }
                }
                catch (e) {
                    console.warn('Failed to load workflows:', e);
                }
            }
            const workflowMap = new Map(workflows.map((w) => [w.issue_id, w]));
            // Enrich issues with workflow
            const enrichedIssues = allIssues.map(issue => {
                const workflow = workflowMap.get(issue.issueId);
                return {
                    ...issue,
                    status: workflow?.status || 'OPEN',
                    assigneeUserId: workflow?.assignee_user_id || null,
                };
            });
            // Find all issues matching this pattern key
            const patternIssues = enrichedIssues.filter(issue => generatePatternKey(issue) === patternKey);
            if (patternIssues.length === 0) {
                return res.status(404).json({ error: 'Pattern not found' });
            }
            // Get representative issue
            const representative = patternIssues.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
            // Compute aggregates (same as queue)
            const riskScores = patternIssues.map(i => i.riskScore ?? 0).filter(s => s > 0);
            const avgRiskScore = riskScores.length > 0
                ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length
                : 0;
            const dates = patternIssues.map(i => new Date(i.evaluationCreatedAt || i.audit?.createdAt || 0).getTime()).filter(d => d > 0);
            const firstSeenAt = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : new Date().toISOString();
            const lastSeenAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : new Date().toISOString();
            const verificationCounts = {
                EXTERNAL_VERIFIED: patternIssues.filter(i => i.verification?.level === 'EXTERNAL_VERIFIED').length,
                TRANSCRIPT_ONLY: patternIssues.filter(i => i.verification?.level === 'TRANSCRIPT_ONLY').length,
                NONE: patternIssues.filter(i => i.verification?.level === 'NONE' || !i.verification?.level).length,
            };
            const statusCounts = {
                OPEN: patternIssues.filter(i => i.status === 'OPEN').length,
                ACKNOWLEDGED: patternIssues.filter(i => i.status === 'ACKNOWLEDGED').length,
                RESOLVED: patternIssues.filter(i => i.status === 'RESOLVED').length,
                FALSE_POSITIVE: patternIssues.filter(i => i.status === 'FALSE_POSITIVE').length,
            };
            const patternStatus = Object.entries(statusCounts)
                .sort((a, b) => b[1] - a[1])[0][0];
            const assignees = patternIssues.map(i => i.assigneeUserId).filter(Boolean);
            const patternAssignee = assignees.length > 0
                ? assignees.sort((a, b) => assignees.filter(x => x === a).length - assignees.filter(x => x === b).length).pop() || null
                : null;
            // Build occurrences list (sorted by date DESC)
            const occurrencesList = patternIssues
                .sort((a, b) => {
                const dateA = new Date(a.evaluationCreatedAt || a.audit?.createdAt || 0).getTime();
                const dateB = new Date(b.evaluationCreatedAt || b.audit?.createdAt || 0).getTime();
                return dateB - dateA;
            })
                .map(issue => ({
                evaluationId: issue.evaluationId,
                conversationId: issue.conversationId,
                occurredAt: issue.evaluationCreatedAt || issue.audit?.createdAt,
                riskScore: issue.riskScore ?? 0,
                score: issue.score,
                severityDisplay: issue.severityDisplay || issue.severity,
                verificationLevel: issue.verification?.level || 'NONE',
                who: {
                    speaker: issue.who?.speaker || 'UNKNOWN',
                    turnIndex: issue.who?.turnIndex,
                },
                what: {
                    primaryClaimId: issue.what?.primaryClaimId || '',
                    issueSummary: issue.what?.issueSummary || '',
                    claimText: issue.what?.claimText || '',
                },
                evidencePreview: (issue.evidence?.refs || []).slice(0, 3).map((ref) => ({
                    sourceType: ref.sourceType || 'TRANSCRIPT',
                    quote: ref.quote || '',
                    turnIndex: ref.turnIndex,
                })),
                tracePreview: issue.conflictsWith ? {
                    contradictionPairs: (issue.conflictsWith || []).slice(0, 3).map((conflict) => ({
                        claimA: conflict.claimId || '',
                        claimB: conflict.claimId || '',
                        weight: conflict.edgeWeight || 0,
                    })),
                } : undefined,
            }));
            // Extract traceability (top edges from representative)
            const traceability = representative.evidence?.edges ? {
                topEdges: (representative.evidence.edges || []).slice(0, 10).map((edge) => ({
                    kind: edge.kind || 'grounding',
                    claimA: edge.claimA || '',
                    claimB: edge.claimB,
                    weight: edge.weight || 0,
                })),
            } : undefined;
            // Compute priority score (same formula as queue endpoint)
            const occurrenceWeight = Math.min(patternIssues.length / 10, 1.0) * 0.3; // Cap at 10 occurrences
            const riskWeight = avgRiskScore * 0.5;
            const unresolvedWeight = (statusCounts.OPEN + statusCounts.ACKNOWLEDGED) / patternIssues.length * 0.2;
            const priorityScore = Math.round((occurrenceWeight + riskWeight + unresolvedWeight) * 100);
            const title = representative.what?.issueSummary ||
                representative.what?.claimSummary ||
                `${representative.type} in ${representative.category}`;
            const summary = representative.what?.issueDetail ||
                representative.what?.description ||
                title;
            res.json({
                patternKey,
                title,
                summary,
                occurrences: patternIssues.length,
                verificationCounts,
                status: patternStatus,
                assignee: patternAssignee,
                firstSeenAt,
                lastSeenAt,
                occurrencesList,
                traceability,
                scoring: representative.scoring,
                // Add fields needed for drawer display
                severityDisplay: representative.severityDisplay || representative.severity || 'medium',
                priorityScore: priorityScore,
            });
        }
        catch (e) {
            console.error('Get pattern detail error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // PATCH /api/issues/pattern/:patternKey - Update pattern status/assignee
    // ============================================================================
    app.patch('/api/issues/pattern/:patternKey', async (req, res) => {
        try {
            const { patternKey } = req.params;
            const { status, assignee } = req.body;
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get user ID
            const authHeader = req.headers.authorization;
            let userId;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
                userId = user?.id;
            }
            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }
            // Get all issues matching this pattern (same logic as detail endpoint)
            let evaluations = [];
            try {
                const { data, error } = await supabaseAdmin
                    .from('evaluations')
                    .select('id, report, created_at')
                    .eq('org_id', context.orgId)
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (!error && data) {
                    evaluations = data;
                }
            }
            catch (e) {
                console.warn('Failed to load evaluations:', e);
            }
            const allIssues = [];
            for (const eval_ of evaluations || []) {
                const report = eval_.report;
                const issues = report?.issues || report?.topIssuesV2 || report?.allIssuesV2 || [];
                for (const issue of issues) {
                    if (!issue || !issue.issueId)
                        continue;
                    allIssues.push({ ...issue, evaluationId: eval_.id });
                }
            }
            const patternIssues = allIssues.filter(issue => generatePatternKey(issue) === patternKey);
            const issueIds = patternIssues.map(i => i.issueId).filter(Boolean);
            if (issueIds.length === 0) {
                return res.status(404).json({ error: 'Pattern not found' });
            }
            // Update workflow for all issues in pattern
            if (status && ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) {
                for (const issueId of issueIds) {
                    await supabaseAdmin
                        .from('issue_workflow')
                        .upsert({
                        issue_id: issueId,
                        org_id: context.orgId,
                        status,
                        updated_at: new Date().toISOString(),
                    }, {
                        onConflict: 'issue_id',
                    });
                    await supabaseAdmin
                        .from('issue_actions_log')
                        .insert({
                        issue_id: issueId,
                        org_id: context.orgId,
                        actor_user_id: userId,
                        action_type: 'BULK_STATUS_CHANGE',
                        payload_json: { status, patternKey },
                    });
                }
            }
            if (assignee !== undefined) {
                for (const issueId of issueIds) {
                    await supabaseAdmin
                        .from('issue_workflow')
                        .upsert({
                        issue_id: issueId,
                        org_id: context.orgId,
                        assignee_user_id: assignee || null,
                        updated_at: new Date().toISOString(),
                    }, {
                        onConflict: 'issue_id',
                    });
                    await supabaseAdmin
                        .from('issue_actions_log')
                        .insert({
                        issue_id: issueId,
                        org_id: context.orgId,
                        actor_user_id: userId,
                        action_type: 'BULK_ASSIGNMENT',
                        payload_json: { assigneeUserId: assignee, patternKey },
                    });
                }
            }
            res.json({ success: true, updatedCount: issueIds.length });
        }
        catch (e) {
            console.error('Update pattern error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/issues/queue/export/csv - Export queue as CSV
    // ============================================================================
    app.get('/api/issues/queue/export/csv', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Use same logic as queue endpoint but return all rows (no pagination)
            // ... (implementation similar to queue endpoint but return CSV)
            // For now, return JSON with CSV content
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="issue-queue.csv"');
            // TODO: Implement CSV generation
            res.send('Pattern Key,Title,Category,Type,Occurrences,Avg Risk,Last Seen\n');
        }
        catch (e) {
            console.error('Export queue CSV error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/issues/queue/export/json - Export queue as JSON
    // ============================================================================
    app.get('/api/issues/queue/export/json', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get queue data (same as queue endpoint but all rows)
            // For now, return placeholder
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="issue-queue.json"');
            res.json({ rows: [], total: 0 });
        }
        catch (e) {
            console.error('Export queue JSON error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
