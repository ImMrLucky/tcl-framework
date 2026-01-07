import { Request, Response, NextFunction } from 'express';
import { Capability, PlanTier } from './capabilities.js';
export interface UpgradeRequiredError {
    error: 'UPGRADE_REQUIRED';
    requiredCapability: string;
    currentPlan: PlanTier;
    message?: string;
}
/**
 * Middleware to require a specific capability
 * Returns 403 with structured error if capability is missing
 */
export declare function requireCapability(capability: Capability): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
