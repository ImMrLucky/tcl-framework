/**
 * Daily Downgrade Job
 * Applies scheduled downgrades from TEAM to SANDBOX
 * Should be run daily via cron or scheduled task
 */
/**
 * Apply scheduled downgrades
 * Call this function daily to downgrade organizations whose plan_downgrade_at has passed
 */
export declare function applyScheduledDowngrades(): Promise<number>;
import type { Application } from 'express';
/**
 * Manual trigger endpoint (for testing/admin)
 * POST /api/admin/billing/apply-downgrades
 */
export declare function setupDowngradeJobRoute(app: Application): void;
