import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { logAudit } from '../supabase.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { getJiraIntegration, getJiraCredentials, createJiraTicket, createJiraTicketsBulk } from './jira.js';
import { createHash } from 'crypto';
/**
 * Setup Jira API routes
 */
export function setupJiraRoutes(app) {
    // ============================================================================
    // POST /api/integrations/jira/test - Test Jira connection
    // ============================================================================
    app.post('/api/integrations/jira/test', requireEntitlement('integrations'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { baseUrl, email, apiToken, projectKey } = req.body;
            if (!baseUrl || !email || !apiToken || !projectKey) {
                return res.status(400).json({ error: 'baseUrl, email, apiToken, and projectKey are required' });
            }
            // Test connection by fetching project
            const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
            const response = await fetch(`${baseUrl}/rest/api/3/project/${projectKey}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json',
                },
            });
            if (!response.ok) {
                const errorBody = await response.text().catch(() => '');
                return res.status(400).json({
                    success: false,
                    error: `Jira connection failed: ${response.status} ${errorBody.substring(0, 200)}`,
                });
            }
            const project = await response.json();
            res.json({
                success: true,
                project: {
                    key: project.key,
                    name: project.name,
                },
            });
        }
        catch (error) {
            console.error('Test Jira connection error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to test Jira connection',
            });
        }
    });
    // ============================================================================
    // POST /api/integrations/jira/tickets/from-issue - Create Jira ticket from issue
    // ============================================================================
    app.post('/api/integrations/jira/tickets/from-issue', requireEntitlement('integrations'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { issueId, evaluationId } = req.body;
            if (!issueId) {
                return res.status(400).json({ error: 'issueId is required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get Jira integration
            const integration = await getJiraIntegration(context.orgId, supabaseAdmin);
            if (!integration) {
                return res.status(404).json({ error: 'Jira integration not found or not active' });
            }
            // Get credentials
            const credentials = await getJiraCredentials(context.orgId, supabaseAdmin);
            if (!credentials) {
                return res.status(400).json({ error: 'Jira credentials not configured' });
            }
            const config = integration.config_json;
            // Get issue from evaluation
            let issue = null;
            if (evaluationId) {
                const { data: evaluation } = await supabaseAdmin
                    .from('evaluations')
                    .select('report')
                    .eq('id', evaluationId)
                    .eq('org_id', context.orgId)
                    .single();
                if (evaluation) {
                    const report = evaluation.report;
                    const allIssues = report?.allIssuesV2 || report?.topIssuesV2 || [];
                    issue = allIssues.find((i) => i.issueId === issueId);
                }
            }
            if (!issue) {
                return res.status(404).json({ error: 'Issue not found' });
            }
            // Get decision and signoffs if available
            const { data: decision } = await supabaseAdmin
                .from('issue_decisions')
                .select('*')
                .eq('org_id', context.orgId)
                .eq('issue_id', issueId)
                .maybeSingle();
            if (decision) {
                issue.decision = decision;
            }
            const { data: signoffs } = await supabaseAdmin
                .from('issue_signoffs')
                .select('*')
                .eq('decision_id', decision?.id)
                .order('signed_at', { ascending: true });
            if (signoffs) {
                issue.signoffs = signoffs;
            }
            // Build evaluation link
            const evaluationLink = evaluationId
                ? `${req.headers.host || 'protectqa.com'}/evaluations/${evaluationId}`
                : undefined;
            // Create Jira ticket
            const ticket = await createJiraTicket(config, credentials, issue, evaluationLink);
            // Create integration export record
            const payloadHash = createHash('sha256')
                .update(JSON.stringify(issue))
                .digest('hex');
            await supabaseAdmin
                .from('integration_exports')
                .insert({
                integration_id: integration.id,
                org_id: context.orgId,
                target_type: 'ISSUE',
                target_id: issueId,
                status: 'SENT',
                external_ref: ticket.key,
                payload_hash: payloadHash,
                sent_at: new Date().toISOString(),
            });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: 'integration.jira.ticket.create',
                targetType: 'integration_export',
                meta: {
                    issueId,
                    jiraKey: ticket.key,
                },
            });
            res.json({ success: true, ticket });
        }
        catch (error) {
            console.error('Create Jira ticket error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // POST /api/integrations/jira/tickets/from-issues - Create Jira tickets from multiple issues
    // ============================================================================
    app.post('/api/integrations/jira/tickets/from-issues', requireEntitlement('integrations'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { issueIds, evaluationId } = req.body;
            if (!issueIds || !Array.isArray(issueIds) || issueIds.length === 0) {
                return res.status(400).json({ error: 'issueIds array is required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get Jira integration
            const integration = await getJiraIntegration(context.orgId, supabaseAdmin);
            if (!integration) {
                return res.status(404).json({ error: 'Jira integration not found or not active' });
            }
            // Get credentials
            const credentials = await getJiraCredentials(context.orgId, supabaseAdmin);
            if (!credentials) {
                return res.status(400).json({ error: 'Jira credentials not configured' });
            }
            const config = integration.config_json;
            // Get issues from evaluation
            let issues = [];
            if (evaluationId) {
                const { data: evaluation } = await supabaseAdmin
                    .from('evaluations')
                    .select('report')
                    .eq('id', evaluationId)
                    .eq('org_id', context.orgId)
                    .single();
                if (evaluation) {
                    const report = evaluation.report;
                    const allIssues = report?.allIssuesV2 || report?.topIssuesV2 || [];
                    issues = allIssues.filter((i) => issueIds.includes(i.issueId));
                }
            }
            if (issues.length === 0) {
                return res.status(404).json({ error: 'No issues found' });
            }
            // Enrich issues with decisions and signoffs
            for (const issue of issues) {
                const { data: decision } = await supabaseAdmin
                    .from('issue_decisions')
                    .select('*')
                    .eq('org_id', context.orgId)
                    .eq('issue_id', issue.issueId)
                    .maybeSingle();
                if (decision) {
                    issue.decision = decision;
                    const { data: signoffs } = await supabaseAdmin
                        .from('issue_signoffs')
                        .select('*')
                        .eq('decision_id', decision.id)
                        .order('signed_at', { ascending: true });
                    if (signoffs) {
                        issue.signoffs = signoffs;
                    }
                }
            }
            // Build evaluation link
            const evaluationLink = evaluationId
                ? `${req.headers.host || 'protectqa.com'}/evaluations/${evaluationId}`
                : undefined;
            // Create Jira tickets
            const tickets = await createJiraTicketsBulk(config, credentials, issues, evaluationLink);
            // Create integration export records
            for (let i = 0; i < tickets.length; i++) {
                const issue = issues[i];
                const ticket = tickets[i];
                const payloadHash = createHash('sha256')
                    .update(JSON.stringify(issue))
                    .digest('hex');
                await supabaseAdmin
                    .from('integration_exports')
                    .insert({
                    integration_id: integration.id,
                    org_id: context.orgId,
                    target_type: 'ISSUE',
                    target_id: issue.issueId,
                    status: 'SENT',
                    external_ref: ticket.key,
                    payload_hash: payloadHash,
                    sent_at: new Date().toISOString(),
                });
            }
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: 'integration.jira.tickets.bulk',
                targetType: 'integration_export',
                meta: {
                    issueCount: tickets.length,
                    jiraKeys: tickets.map(t => t.key),
                },
            });
            res.json({ success: true, tickets });
        }
        catch (error) {
            console.error('Create Jira tickets bulk error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
    // ============================================================================
    // POST /api/integrations/jira/tickets/from-case - Create Jira ticket from case
    // ============================================================================
    app.post('/api/integrations/jira/tickets/from-case', requireEntitlement('integrations'), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId || !context.userId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const { caseId } = req.body;
            if (!caseId) {
                return res.status(400).json({ error: 'caseId is required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Get case
            const { data: case_, error: caseError } = await supabaseAdmin
                .from('cases')
                .select('*')
                .eq('id', caseId)
                .eq('org_id', context.orgId)
                .single();
            if (caseError || !case_) {
                return res.status(404).json({ error: 'Case not found' });
            }
            // Get case issues
            const { data: caseIssues } = await supabaseAdmin
                .from('case_issues')
                .select('issue_id, evaluation_id')
                .eq('case_id', caseId);
            if (!caseIssues || caseIssues.length === 0) {
                return res.status(400).json({ error: 'Case has no issues' });
            }
            // Get Jira integration
            const integration = await getJiraIntegration(context.orgId, supabaseAdmin);
            if (!integration) {
                return res.status(404).json({ error: 'Jira integration not found or not active' });
            }
            // Get credentials
            const credentials = await getJiraCredentials(context.orgId, supabaseAdmin);
            if (!credentials) {
                return res.status(400).json({ error: 'Jira credentials not configured' });
            }
            const config = integration.config_json;
            // Build case description for Jira
            const description = [
                `*ProtectQA Case: ${case_.title}*`,
                ``,
                case_.description || '',
                ``,
                `*Case Status:* ${case_.status}`,
                `*Issues in Case:* ${caseIssues.length}`,
                ``,
                `*Issue IDs:*`,
                ...caseIssues.map(ci => `- ${ci.issue_id}`),
            ];
            // Create a summary issue for the case
            const caseIssue = {
                issueId: `case-${caseId}`,
                type: 'CASE',
                category: 'CASE_MANAGEMENT',
                severity: 'high',
                what: {
                    issueSummary: case_.title,
                    issueDetail: description.join('\n'),
                },
            };
            const summary = `[ProtectQA Case] ${case_.title}`;
            // Create Jira ticket
            const ticket = await createJiraTicket(config, credentials, caseIssue);
            // Create integration export record
            const payloadHash = createHash('sha256')
                .update(JSON.stringify(case_))
                .digest('hex');
            await supabaseAdmin
                .from('integration_exports')
                .insert({
                integration_id: integration.id,
                org_id: context.orgId,
                target_type: 'CASE',
                target_id: caseId,
                status: 'SENT',
                external_ref: ticket.key,
                payload_hash: payloadHash,
                sent_at: new Date().toISOString(),
            });
            // Log audit
            await logAudit({
                orgId: context.orgId,
                actorUserId: context.userId,
                action: 'integration.jira.ticket.from_case',
                targetType: 'integration_export',
                meta: {
                    caseId,
                    jiraKey: ticket.key,
                },
            });
            res.json({ success: true, ticket });
        }
        catch (error) {
            console.error('Create Jira ticket from case error:', error);
            res.status(500).json({ error: error.message || 'Unknown error' });
        }
    });
}
