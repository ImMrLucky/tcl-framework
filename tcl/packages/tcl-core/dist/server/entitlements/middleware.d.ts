import { Request, Response, NextFunction } from 'express';
import { EntitlementFeature } from './entitlements-service.js';
/**
 * Middleware to require a specific entitlement feature
 * Returns 403 if the org doesn't have the feature
 */
export declare function requireEntitlement(featureKey: EntitlementFeature): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Middleware to check entitlement and attach to request (doesn't fail if missing)
 * Useful for conditional features
 */
export declare function checkEntitlement(featureKey: EntitlementFeature): (req: Request, res: Response, next: NextFunction) => Promise<void>;
