/**
 * Evidence Coverage Routes
 * Provides evidence coverage statistics and gap analysis
 */
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
export function setupEvidenceRoutes(app) {
    // ============================================================================
    // GET /api/evidence/coverage - Get evidence coverage statistics
    // ============================================================================
    app.get('/api/evidence/coverage', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const dateFrom = req.query.from;
            const dateTo = req.query.to;
            const projectId = req.query.projectId || context.projectId;
            const env = req.query.env || context.env;
            // Build evaluation query
            let evalQuery = supabaseAdmin
                .from('evaluations')
                .select('id, report, created_at')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (projectId) {
                evalQuery = evalQuery.eq('project_id', projectId);
            }
            if (env) {
                evalQuery = evalQuery.eq('env', env);
            }
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
                return res.json({
                    totalIssues: 0,
                    externalVerified: 0,
                    transcriptOnly: 0,
                    none: 0,
                    verifiedPercent: 0,
                    transcriptOnlyPercent: 0,
                    unverifiedPercent: 0,
                    byCategory: {},
                    byType: {},
                });
            }
            // Extract all issues from evaluations
            let totalIssues = 0;
            let externalVerified = 0;
            let transcriptOnly = 0;
            let none = 0;
            const byCategory = {};
            const byType = {};
            for (const eval_ of evaluations) {
                const report = eval_.report;
                const issues = report?.allIssuesV2 || report?.topIssuesV2 || report?.issues || [];
                for (const issue of issues) {
                    totalIssues++;
                    const verificationLevel = issue.verification?.level || 'NONE';
                    const category = issue.category || 'other';
                    const type = issue.type || 'OTHER';
                    // Count by verification level
                    if (verificationLevel === 'EXTERNAL_VERIFIED') {
                        externalVerified++;
                    }
                    else if (verificationLevel === 'TRANSCRIPT_ONLY') {
                        transcriptOnly++;
                    }
                    else {
                        none++;
                    }
                    // Count by category
                    if (!byCategory[category]) {
                        byCategory[category] = { total: 0, externalVerified: 0, transcriptOnly: 0, none: 0 };
                    }
                    byCategory[category].total++;
                    if (verificationLevel === 'EXTERNAL_VERIFIED') {
                        byCategory[category].externalVerified++;
                    }
                    else if (verificationLevel === 'TRANSCRIPT_ONLY') {
                        byCategory[category].transcriptOnly++;
                    }
                    else {
                        byCategory[category].none++;
                    }
                    // Count by type
                    if (!byType[type]) {
                        byType[type] = { total: 0, externalVerified: 0, transcriptOnly: 0, none: 0 };
                    }
                    byType[type].total++;
                    if (verificationLevel === 'EXTERNAL_VERIFIED') {
                        byType[type].externalVerified++;
                    }
                    else if (verificationLevel === 'TRANSCRIPT_ONLY') {
                        byType[type].transcriptOnly++;
                    }
                    else {
                        byType[type].none++;
                    }
                }
            }
            const verifiedPercent = totalIssues > 0 ? Math.round((externalVerified / totalIssues) * 100 * 10) / 10 : 0;
            const transcriptOnlyPercent = totalIssues > 0 ? Math.round((transcriptOnly / totalIssues) * 100 * 10) / 10 : 0;
            const unverifiedPercent = totalIssues > 0 ? Math.round((none / totalIssues) * 100 * 10) / 10 : 0;
            res.json({
                totalIssues,
                externalVerified,
                transcriptOnly,
                none,
                verifiedPercent,
                transcriptOnlyPercent,
                unverifiedPercent,
                byCategory,
                byType,
            });
        }
        catch (e) {
            console.error('Get evidence coverage error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/evidence/gaps - Get evidence gap recommendations
    // ============================================================================
    app.get('/api/evidence/gaps', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const dateFrom = req.query.from;
            const dateTo = req.query.to;
            const projectId = req.query.projectId || context.projectId;
            const env = req.query.env || context.env;
            // Build evaluation query
            let evalQuery = supabaseAdmin
                .from('evaluations')
                .select('id, report, created_at')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (projectId) {
                evalQuery = evalQuery.eq('project_id', projectId);
            }
            if (env) {
                evalQuery = evalQuery.eq('env', env);
            }
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
                return res.json({ gaps: [] });
            }
            // Analyze gaps: collect recommended evidence from issues
            const gapMap = new Map();
            for (const eval_ of evaluations) {
                const report = eval_.report;
                const issues = report?.allIssuesV2 || report?.topIssuesV2 || report?.issues || [];
                for (const issue of issues) {
                    const verificationLevel = issue.verification?.level || 'NONE';
                    // Only consider issues that need external evidence
                    if (verificationLevel === 'TRANSCRIPT_ONLY' || verificationLevel === 'NONE') {
                        // Check for recommended action with required evidence
                        if (issue.recommendedAction?.requiredEvidence) {
                            for (const evidence of issue.recommendedAction.requiredEvidence) {
                                const key = evidence.toLowerCase().trim();
                                if (!gapMap.has(key)) {
                                    gapMap.set(key, {
                                        count: 0,
                                        categories: new Set(),
                                        types: new Set(),
                                        examples: [],
                                    });
                                }
                                const gap = gapMap.get(key);
                                gap.count++;
                                if (issue.category)
                                    gap.categories.add(issue.category);
                                if (issue.type)
                                    gap.types.add(issue.type);
                                if (issue.what?.issueSummary && gap.examples.length < 3) {
                                    gap.examples.push(issue.what.issueSummary);
                                }
                            }
                        }
                        else {
                            // Infer evidence needs from category/type
                            let inferredEvidence = [];
                            const category = issue.category || '';
                            const type = issue.type || '';
                            if (category === 'billing' || type.includes('BILLING') || type.includes('FEE')) {
                                inferredEvidence.push('billing policy document');
                                inferredEvidence.push('billing ledger');
                            }
                            if (category === 'compliance' || type.includes('COMPLIANCE')) {
                                inferredEvidence.push('compliance policy document');
                            }
                            if (category === 'disclosure' || type.includes('DISCLOSURE')) {
                                inferredEvidence.push('disclosure policy document');
                            }
                            if (type.includes('CONTRADICTION')) {
                                inferredEvidence.push('source of truth document');
                            }
                            for (const evidence of inferredEvidence) {
                                const key = evidence.toLowerCase().trim();
                                if (!gapMap.has(key)) {
                                    gapMap.set(key, {
                                        count: 0,
                                        categories: new Set(),
                                        types: new Set(),
                                        examples: [],
                                    });
                                }
                                const gap = gapMap.get(key);
                                gap.count++;
                                if (issue.category)
                                    gap.categories.add(issue.category);
                                if (issue.type)
                                    gap.types.add(issue.type);
                                if (issue.what?.issueSummary && gap.examples.length < 3) {
                                    gap.examples.push(issue.what.issueSummary);
                                }
                            }
                        }
                    }
                }
            }
            // Convert to array and sort by count
            const gaps = Array.from(gapMap.entries())
                .map(([evidence, data]) => ({
                evidence,
                count: data.count,
                categories: Array.from(data.categories),
                types: Array.from(data.types),
                examples: data.examples,
                priority: data.count > 10 ? 'high' : data.count > 5 ? 'medium' : 'low',
            }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 20); // Top 20 gaps
            res.json({ gaps });
        }
        catch (e) {
            console.error('Get evidence gaps error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
