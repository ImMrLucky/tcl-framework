import { getOrgContext } from '../auth-context.js';
import { planService } from './plan-service.js';
/**
 * Middleware to require a specific capability
 * Returns 403 with structured error if capability is missing
 */
export function requireCapability(capability) {
    return async (req, res, next) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({
                    error: context?.error || 'Authorization required'
                });
            }
            // Check if org has the required capability
            const hasCap = await planService.hasCapability(context.orgId, capability);
            if (!hasCap) {
                // Get plan context to return current tier
                const planContext = await planService.getOrgPlanContext(context.orgId);
                const errorResponse = {
                    error: 'UPGRADE_REQUIRED',
                    requiredCapability: capability,
                    currentPlan: planContext.tier,
                    message: `This feature requires ${capability}. Your current plan (${planContext.tier}) does not include this capability.`,
                };
                return res.status(403).json(errorResponse);
            }
            // Capability check passed, continue
            next();
        }
        catch (error) {
            console.error('Capability check error:', error);
            return res.status(500).json({
                error: error?.message || 'Failed to check capability'
            });
        }
    };
}
