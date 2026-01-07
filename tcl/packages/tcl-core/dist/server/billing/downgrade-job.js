/**
 * Daily Downgrade Job
 * Applies scheduled downgrades from TEAM to SANDBOX
 * Should be run daily via cron or scheduled task
 */
import { supabaseAdmin } from '../supabase.js';
/**
 * Apply scheduled downgrades
 * Call this function daily to downgrade organizations whose plan_downgrade_at has passed
 */
export async function applyScheduledDowngrades() {
    if (!supabaseAdmin) {
        console.warn('Supabase not configured, skipping downgrade job');
        return 0;
    }
    try {
        // Call the database function to apply downgrades
        const { data, error } = await supabaseAdmin.rpc('apply_scheduled_downgrades');
        if (error) {
            console.error('Error applying scheduled downgrades:', error);
            return 0;
        }
        const downgradeCount = data || 0;
        if (downgradeCount > 0) {
            console.log(`Applied ${downgradeCount} scheduled downgrades`);
        }
        return downgradeCount;
    }
    catch (error) {
        console.error('Error in downgrade job:', error);
        return 0;
    }
}
/**
 * Manual trigger endpoint (for testing/admin)
 * POST /api/admin/billing/apply-downgrades
 */
export function setupDowngradeJobRoute(app) {
    app.post('/api/admin/billing/apply-downgrades', async (req, res) => {
        try {
            const count = await applyScheduledDowngrades();
            res.json({
                success: true,
                downgradesApplied: count,
                message: `Applied ${count} scheduled downgrades`,
            });
        }
        catch (error) {
            console.error('Error in downgrade job endpoint:', error);
            res.status(500).json({
                error: error.message || 'Failed to apply downgrades',
            });
        }
    });
}
