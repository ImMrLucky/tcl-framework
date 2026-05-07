/**
 * Export Routes
 * Handles audit pack generation and status checking
 */
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { generateAuditPack } from './audit-pack.js';
import { requireCapability } from '../plans/capability-middleware.js';
import { Capability } from '../plans/capabilities.js';
// Store pack status in memory (in production, use Redis or database)
const packStatus = new Map();
export function setupExportRoutes(app) {
    // ============================================================================
    // POST /api/exports/audit-pack - Generate audit pack
    // ============================================================================
    // Requires EXPORT_JSON capability (audit pack includes JSON)
    app.post('/api/exports/audit-pack', requireCapability(Capability.EXPORT_JSON), async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const options = {
                evaluationId: req.body.evaluationId,
                dateFrom: req.body.dateFrom,
                dateTo: req.body.dateTo,
                projectId: req.body.projectId || context.projectId,
                env: req.body.env || context.env,
                includeAllIssues: req.body.includeAllIssues !== false, // Default true
                preset: req.body.preset || 'CUSTOM', // Default to CUSTOM if not specified
            };
            // Validate options
            if (!options.evaluationId && (!options.dateFrom || !options.dateTo)) {
                return res.status(400).json({ error: 'Either evaluationId or dateFrom/dateTo must be provided' });
            }
            // Generate pack ID immediately
            const packId = `pack-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            // Set status to processing
            packStatus.set(packId, { status: 'processing' });
            // Generate pack asynchronously
            generateAuditPack(options, context.orgId, supabaseAdmin)
                .then(async (result) => {
                packStatus.set(packId, { status: 'completed', result });
                // Record export in ledger
                try {
                    if (!supabaseAdmin) {
                        throw new Error('Supabase not configured');
                    }
                    await supabaseAdmin.from('exports').insert({
                        org_id: context.orgId,
                        project_id: options.projectId || context.projectId || null,
                        export_type: 'AUDIT_PACK',
                        target_id: packId,
                        format: 'ZIP',
                        preset: options.preset || 'CUSTOM',
                        filename: `audit-pack-${packId}.zip`,
                        checksum: result.checksums.zip || result.checksums.combined,
                        item_count: result.summary?.totalIssues || 0,
                        summary_json: {
                            totalEvaluations: result.summary?.totalEvaluations || 0,
                            totalIssues: result.summary?.totalIssues || 0,
                            preset: options.preset || 'CUSTOM',
                        },
                        created_by_user_id: context.userId,
                    });
                }
                catch (ledgerError) {
                    console.error('Failed to record export in ledger:', ledgerError);
                    // Don't fail the export if ledger recording fails
                }
            })
                .catch((error) => {
                console.error('Audit pack generation error:', error);
                packStatus.set(packId, { status: 'failed', error: error.message });
            });
            // Return pack ID immediately
            res.json({
                packId,
                status: 'processing',
                message: 'Audit pack generation started. Use GET /api/exports/audit-pack/:packId/status to check progress.',
            });
        }
        catch (e) {
            console.error('Create audit pack error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/exports/audit-pack/:packId/status - Check pack generation status
    // ============================================================================
    app.get('/api/exports/audit-pack/:packId/status', async (req, res) => {
        try {
            const { packId } = req.params;
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const status = packStatus.get(packId);
            if (!status) {
                return res.status(404).json({ error: 'Pack not found' });
            }
            if (status.status === 'completed' && status.result) {
                res.json({
                    packId,
                    status: 'completed',
                    pdfUrl: status.result.pdfUrl,
                    jsonUrl: status.result.jsonUrl,
                    csvUrl: status.result.csvUrl,
                    zipUrl: status.result.zipUrl,
                    checksums: status.result.checksums,
                });
            }
            else if (status.status === 'failed') {
                res.json({
                    packId,
                    status: 'failed',
                    error: status.error,
                });
            }
            else {
                res.json({
                    packId,
                    status: 'processing',
                    message: 'Pack generation in progress...',
                });
            }
        }
        catch (e) {
            console.error('Get pack status error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
