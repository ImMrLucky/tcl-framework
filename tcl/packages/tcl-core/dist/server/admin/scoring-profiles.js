/**
 * Scoring Profiles Routes
 * Admin-only routes for managing scoring configuration profiles
 */
import { createHash } from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { validateRiskRankingConfig } from '../../config/risk-ranking.js';
/**
 * Validate scoring config bundle
 */
function validateScoringConfig(riskRankingConfig, issueScoringConfig) {
    const errors = [];
    // Validate risk ranking config
    try {
        validateRiskRankingConfig(riskRankingConfig);
    }
    catch (error) {
        errors.push(`Risk ranking config: ${error.message}`);
    }
    // Validate issue scoring config structure
    if (!issueScoringConfig || typeof issueScoringConfig !== 'object') {
        errors.push('Issue scoring config must be an object');
    }
    else {
        // Check baseWeights sum to ~1.0
        if (issueScoringConfig.weights?.baseWeights) {
            const weights = issueScoringConfig.weights.baseWeights;
            const sum = (weights.impact || 0) + (weights.verification || 0) + (weights.confidence || 0);
            if (Math.abs(sum - 1.0) > 0.001) {
                errors.push(`Issue scoring baseWeights must sum to 1.0 (got ${sum.toFixed(3)})`);
            }
        }
        // Check severity thresholds are monotonic
        if (riskRankingConfig.severityThresholds) {
            const thresholds = riskRankingConfig.severityThresholds;
            if (thresholds.low >= thresholds.medium ||
                thresholds.medium >= thresholds.high ||
                thresholds.high >= thresholds.critical) {
                errors.push('Severity thresholds must be strictly increasing (low < medium < high < critical)');
            }
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
/**
 * Compute config hash from config bundle
 */
export function computeConfigHash(riskRankingConfig, issueScoringConfig) {
    const configBundle = JSON.stringify({
        riskRanking: riskRankingConfig,
        issueScoring: issueScoringConfig,
    }, Object.keys({ riskRanking: riskRankingConfig, issueScoring: issueScoringConfig }).sort());
    return createHash('sha256').update(configBundle).digest('hex').substring(0, 16);
}
/**
 * Get active scoring profile for an org
 */
export async function getActiveScoringProfile(orgId) {
    if (!supabaseAdmin) {
        return null;
    }
    const { data: profile, error } = await supabaseAdmin
        .from('scoring_profiles')
        .select('risk_ranking_config, issue_scoring_config, config_hash')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .maybeSingle();
    if (error || !profile) {
        return null;
    }
    return {
        riskRankingConfig: profile.risk_ranking_config,
        issueScoringConfig: profile.issue_scoring_config,
        configHash: profile.config_hash,
    };
}
export function setupScoringProfilesRoutes(app) {
    // ============================================================================
    // GET /api/admin/scoring-profiles - List scoring profiles
    // ============================================================================
    app.get('/api/admin/scoring-profiles', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            // Check admin role (normalize to lowercase for comparison)
            const normalizedRole = context.role?.toLowerCase();
            if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { data: profiles, error } = await supabaseAdmin
                .from('scoring_profiles')
                .select('*')
                .eq('org_id', context.orgId)
                .order('created_at', { ascending: false });
            if (error) {
                console.error('List scoring profiles error:', error);
                return res.status(500).json({ error: error.message });
            }
            res.json({ profiles: profiles || [] });
        }
        catch (e) {
            console.error('List scoring profiles error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/admin/scoring-profiles - Create a new scoring profile
    // ============================================================================
    app.post('/api/admin/scoring-profiles', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            // Check admin role (normalize to lowercase for comparison)
            const normalizedRole = context.role?.toLowerCase();
            if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { name, description, riskRankingConfig, issueScoringConfig, version } = req.body;
            if (!name || !riskRankingConfig || !issueScoringConfig) {
                return res.status(400).json({ error: 'Name, riskRankingConfig, and issueScoringConfig are required' });
            }
            // Validate configs
            const validation = validateScoringConfig(riskRankingConfig, issueScoringConfig);
            if (!validation.valid) {
                return res.status(400).json({
                    error: 'Invalid scoring configuration',
                    errors: validation.errors,
                });
            }
            // Compute config hash
            const configHash = computeConfigHash(riskRankingConfig, issueScoringConfig);
            // Check for duplicate name
            const { data: existing } = await supabaseAdmin
                .from('scoring_profiles')
                .select('id')
                .eq('org_id', context.orgId)
                .eq('name', name)
                .maybeSingle();
            if (existing) {
                return res.status(400).json({ error: 'A profile with this name already exists' });
            }
            // Create profile
            const { data: profile, error } = await supabaseAdmin
                .from('scoring_profiles')
                .insert({
                org_id: context.orgId,
                name,
                description: description || null,
                risk_ranking_config: riskRankingConfig,
                issue_scoring_config: issueScoringConfig,
                config_hash: configHash,
                version: version || '1.0.0',
                is_active: false,
                created_by: context.userId || null,
            })
                .select()
                .single();
            if (error) {
                console.error('Create scoring profile error:', error);
                return res.status(500).json({ error: error.message });
            }
            res.json({ profile });
        }
        catch (e) {
            console.error('Create scoring profile error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // POST /api/admin/scoring-profiles/:id/activate - Activate a scoring profile
    // ============================================================================
    app.post('/api/admin/scoring-profiles/:id/activate', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            // Check admin role (normalize to lowercase for comparison)
            const normalizedRole = context.role?.toLowerCase();
            if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { id } = req.params;
            // Get the profile
            const { data: profile, error: profileError } = await supabaseAdmin
                .from('scoring_profiles')
                .select('*')
                .eq('id', id)
                .eq('org_id', context.orgId)
                .single();
            if (profileError || !profile) {
                return res.status(404).json({ error: 'Scoring profile not found' });
            }
            // Deactivate other active profiles
            await supabaseAdmin
                .from('scoring_profiles')
                .update({
                is_active: false,
            })
                .eq('org_id', context.orgId)
                .eq('is_active', true);
            // Activate this profile
            const { data: updatedProfile, error: updateError } = await supabaseAdmin
                .from('scoring_profiles')
                .update({
                is_active: true,
                activated_at: new Date().toISOString(),
            })
                .eq('id', id)
                .select()
                .single();
            if (updateError) {
                console.error('Activate scoring profile error:', updateError);
                return res.status(500).json({ error: updateError.message });
            }
            res.json({
                profile: updatedProfile,
                message: 'Profile activated. New evaluations will use this configuration.',
                configHash: updatedProfile.config_hash,
            });
        }
        catch (e) {
            console.error('Activate scoring profile error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
    // ============================================================================
    // GET /api/admin/scoring-profiles/active - Get active profile
    // ============================================================================
    app.get('/api/admin/scoring-profiles/active', async (req, res) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            // Check admin role (normalize to lowercase for comparison)
            const normalizedRole = context.role?.toLowerCase();
            if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
            if (!supabaseAdmin) {
                return res.status(503).json({ error: 'Supabase not configured' });
            }
            const { data: profile, error } = await supabaseAdmin
                .from('scoring_profiles')
                .select('*')
                .eq('org_id', context.orgId)
                .eq('is_active', true)
                .maybeSingle();
            if (error) {
                console.error('Get active scoring profile error:', error);
                return res.status(500).json({ error: error.message });
            }
            res.json({ profile: profile || null });
        }
        catch (e) {
            console.error('Get active scoring profile error:', e);
            res.status(500).json({ error: e?.message ?? 'unknown error' });
        }
    });
}
