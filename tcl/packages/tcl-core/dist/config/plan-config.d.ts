/**
 * Plan Configuration Loader
 * Loads and validates plan configurations from JSON
 */
import { Capability, PlanTier, type PlanLimits } from '../server/plans/capabilities.js';
export interface PlanConfig {
    capabilities: Capability[];
    limits: PlanLimits;
}
export interface PlansConfig {
    plans: Record<PlanTier, PlanConfig>;
}
/**
 * Load plan configuration from JSON file
 */
export declare function loadPlanConfig(): PlansConfig;
/**
 * Validate plan configuration schema
 */
export declare function validatePlanConfig(config: any): asserts config is PlansConfig;
/**
 * Get plan configuration for a specific tier
 */
export declare function getPlanConfig(tier: PlanTier): PlanConfig;
/**
 * Get all capabilities for a tier
 */
export declare function getCapabilitiesForTier(tier: PlanTier): Capability[];
/**
 * Get all limits for a tier
 */
export declare function getLimitsForTier(tier: PlanTier): PlanLimits;
