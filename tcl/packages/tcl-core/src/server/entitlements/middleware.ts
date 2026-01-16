import { Request, Response, NextFunction } from 'express';
import { entitlementsService, EntitlementFeature } from './entitlements-service.js';
import { getOrgContext } from '../auth-context.js';

/**
 * Middleware to require a specific entitlement feature
 * Returns 403 if the org doesn't have the feature
 */
export function requireEntitlement(featureKey: EntitlementFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
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
    } catch (error: any) {
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
export function checkEntitlement(featureKey: EntitlementFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await getOrgContext(req);
      
      if (context && context.orgId) {
        const hasFeature = await entitlementsService.has(context.orgId, featureKey);
        (req as any).entitlements = (req as any).entitlements || {};
        (req as any).entitlements[featureKey] = hasFeature;
      }

      next();
    } catch (error: any) {
      // Don't fail the request, just log
      console.warn('Entitlement check warning:', error);
      (req as any).entitlements = (req as any).entitlements || {};
      (req as any).entitlements[featureKey] = false;
      next();
    }
  };
}

