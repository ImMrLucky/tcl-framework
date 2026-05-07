import { entitlementsService } from './entitlements-service.js';
import { getOrgContext } from '../auth-context.js';
/**
 * Middleware to require a specific entitlement feature
 * Returns 403 if the org doesn't have the feature
 */
export function requireEntitlement(featureKey) {
    return async (req, res, next) => {
        try {
            const context = await getOrgContext(req);
            if (!context || context.error || !context.orgId) {
                return res.status(401).json({ error: context?.error || 'Authorization required' });
            }
            const hasFeature = await entitlementsService.has(context.orgId, featureKey);
            if (!hasFeature) {
                return res.status(403).json({
                    error: 'FEATURE_NOT_AVAILABLE',
                    message: `Feature '${featureKey}' is not available for this organization`,
                    featureKey,
                });
            }
            next();
        }
        catch (error) {
            console.error('Entitlement check error:', error);
            return res.status(500).json({
                error: 'ENTITLEMENT_CHECK_FAILED',
                message: error.message || 'Failed to check entitlement',
            });
        }
    };
}
/**
 * Middleware to check entitlement and attach to request (doesn't fail if missing)
 * Useful for conditional features
 */
export function checkEntitlement(featureKey) {
    return async (req, res, next) => {
        try {
            const context = await getOrgContext(req);
            if (context && context.orgId) {
                const hasFeature = await entitlementsService.has(context.orgId, featureKey);
                req.entitlements = req.entitlements || {};
                req.entitlements[featureKey] = hasFeature;
            }
            next();
        }
        catch (error) {
            // Don't fail the request, just log
            console.warn('Entitlement check warning:', error);
            req.entitlements = req.entitlements || {};
            req.entitlements[featureKey] = false;
            next();
        }
    };
}
