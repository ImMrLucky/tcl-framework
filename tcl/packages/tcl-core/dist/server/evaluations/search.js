/**
 * Evaluation Search Routes
 * Server-side search and filtering for evaluations
 */
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
export function setupEvaluationSearchRoutes(app) {
    // ============================================================================
    // GET /api/evaluations/search - Search evaluations with filters
    // ============================================================================
    app.get('/api/evaluations/search', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            // Parse query parameters
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const offset = parseInt(req.query.offset) || 0;
            const dateFrom = req.query.dateFrom;
            const dateTo = req.query.dateTo;
            const severityDisplay = req.query.severityDisplay;
            const verification = req.query.verification;
            const category = req.query.category;
            const type = req.query.type;
            const agent = req.query.agent;
            const team = req.query.team;
            const textContains = req.query.textContains;
            const projectId = req.query.projectId || context.projectId;
            const env = req.query.env || context.env;
            // Build base query - we need 'report' for filtering, but we'll only load what we need
            // For large datasets, we should paginate the database query first
            // Join with conversations to get audio and transcript asset IDs
            // Use !conversation_id to specify which foreign key relationship to use
            // (there are two relationships: evaluations.conversation_id and conversations.evaluation_id)
            let query = supabaseAdmin
                .from('evaluations')
                .select(`
          id, 
          org_id, 
          project_id, 
          env, 
          conversation_id, 
          scores, 
          engine_version, 
          latency_ms, 
          report, 
          created_at,
          transcript_asset_id,
          conversations!conversation_id(audio_asset_id, transcript_asset_id)
        `, { count: 'exact' })
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false })
                .limit(1000); // Limit to prevent loading too many reports at once
            if (projectId) {
                query = query.eq('project_id', projectId);
            }
            if (env) {
                query = query.eq('env', env);
            }
            if (dateFrom) {
                query = query.gte('created_at', dateFrom);
            }
            if (dateTo) {
                query = query.lte('created_at', dateTo);
            }
            // Get all matching evaluations (we'll filter by issue properties in memory)
            // Note: For large datasets, this could be optimized with database-level filtering
            const { data: evaluations, error } = await query;
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            if (!evaluations || evaluations.length === 0) {
                return res.json({
                    evaluations: [],
                    total: 0,
                    limit,
                    offset,
                });
            }
            // Filter evaluations based on issue properties and text search
            const filteredEvaluations = [];
            for (const eval_ of evaluations) {
                const report = eval_.report;
                const issues = report?.allIssuesV2 || report?.topIssuesV2 || report?.issues || [];
                // Apply issue-level filters
                let matchesFilters = true;
                let hasMatchingIssues = false;
                if (severityDisplay || verification || category || type) {
                    // Check if any issue matches the filters
                    for (const issue of issues) {
                        let issueMatches = true;
                        if (severityDisplay) {
                            const issueSeverity = issue.severityDisplay || issue.severity;
                            if (issueSeverity !== severityDisplay) {
                                issueMatches = false;
                            }
                        }
                        if (verification && issueMatches) {
                            const issueVerification = issue.verification?.level;
                            if (issueVerification !== verification) {
                                issueMatches = false;
                            }
                        }
                        if (category && issueMatches) {
                            if (issue.category !== category) {
                                issueMatches = false;
                            }
                        }
                        if (type && issueMatches) {
                            if (issue.type !== type) {
                                issueMatches = false;
                            }
                        }
                        if (issueMatches) {
                            hasMatchingIssues = true;
                            break;
                        }
                    }
                    if (!hasMatchingIssues) {
                        matchesFilters = false;
                    }
                }
                // Text search (search in evaluation ID, conversation ID, issue summaries)
                if (textContains && matchesFilters) {
                    const searchLower = textContains.toLowerCase();
                    const matchesId = eval_.id.toLowerCase().includes(searchLower);
                    const matchesConvId = eval_.conversation_id?.toLowerCase().includes(searchLower);
                    let matchesIssueText = false;
                    for (const issue of issues) {
                        const summary = (issue.what?.issueSummary || '').toLowerCase();
                        const detail = (issue.what?.issueDetail || '').toLowerCase();
                        if (summary.includes(searchLower) || detail.includes(searchLower)) {
                            matchesIssueText = true;
                            break;
                        }
                    }
                    if (!matchesId && !matchesConvId && !matchesIssueText) {
                        matchesFilters = false;
                    }
                }
                // Agent/Team filter (from metadata or conversation metadata)
                if ((agent || team) && matchesFilters) {
                    const metadata = report?.run?.metadata || report?.metadata || {};
                    const convMetadata = metadata.conversationMetadata || {};
                    if (agent) {
                        const evalAgent = metadata.agentId || convMetadata.agentId || metadata.agent_id;
                        if (!evalAgent || !evalAgent.toLowerCase().includes(agent.toLowerCase())) {
                            matchesFilters = false;
                        }
                    }
                    if (team && matchesFilters) {
                        const evalTeam = metadata.teamId || convMetadata.teamId || metadata.team_id;
                        if (!evalTeam || !evalTeam.toLowerCase().includes(team.toLowerCase())) {
                            matchesFilters = false;
                        }
                    }
                }
                if (matchesFilters) {
                    // Calculate summary stats for this evaluation
                    let totalIssues = issues.length;
                    let highCriticalCount = 0;
                    let verifiedCount = 0;
                    const categoryCounts = new Map();
                    for (const issue of issues) {
                        const severityDisplay = issue.severityDisplay || issue.severity;
                        if (severityDisplay === 'high' || severityDisplay === 'critical') {
                            highCriticalCount++;
                        }
                        const verificationLevel = issue.verification?.level;
                        if (verificationLevel === 'EXTERNAL_VERIFIED') {
                            verifiedCount++;
                        }
                        const cat = issue.category || 'other';
                        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
                    }
                    const verifiedPercent = totalIssues > 0 ? (verifiedCount / totalIssues) * 100 : 0;
                    const topCategories = Array.from(categoryCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([cat]) => cat);
                    // Extract agent from metadata
                    const metadata = report?.run?.metadata || report?.metadata || {};
                    const convMetadata = metadata.conversationMetadata || {};
                    const agentId = metadata.agentId || convMetadata.agentId || metadata.agent_id || 'N/A';
                    // Get audio and transcript asset IDs from conversation or evaluation
                    // Prefer evaluation's transcript_asset_id, fall back to conversation's
                    const conversation = Array.isArray(eval_.conversations)
                        ? eval_.conversations[0]
                        : eval_.conversations;
                    const audioAssetId = conversation?.audio_asset_id || null;
                    const transcriptAssetId = eval_.transcript_asset_id || conversation?.transcript_asset_id || null;
                    filteredEvaluations.push({
                        evaluationId: eval_.id,
                        createdAt: eval_.created_at,
                        agent: agentId,
                        totalIssues,
                        highCriticalCount,
                        verifiedPercent: Math.round(verifiedPercent * 10) / 10,
                        topCategories,
                        conversationId: eval_.conversation_id,
                        env: eval_.env,
                        scores: eval_.scores,
                        audioAssetId,
                        transcriptAssetId,
                        report: {
                            // Include minimal report data for display
                            source: report?.source,
                        },
                    });
                }
            }
            // Apply pagination
            const total = filteredEvaluations.length;
            const paginatedEvaluations = filteredEvaluations.slice(offset, offset + limit);
            res.json({
                evaluations: paginatedEvaluations,
                total,
                limit,
                offset,
            });
        }
        catch (e) {
            console.error('Search evaluations error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
