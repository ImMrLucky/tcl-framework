/**
 * Plan Configuration Loader
 * Loads and validates plan configurations from JSON
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Capability } from '../server/plans/capabilities.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Load plan configuration from JSON file
 */
export function loadPlanConfig() {
    try {
        const configPath = join(__dirname, 'plans.json');
        const configContent = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        // Validate configuration
        validatePlanConfig(config);
        return config;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Plan configuration file not found: ${join(__dirname, 'plans.json')}`);
        }
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in plan configuration: ${error.message}`);
        }
        throw error;
    }
}
/**
 * Validate plan configuration schema
 */
export function validatePlanConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('Plan configuration must be an object');
    }
    if (!config.plans || typeof config.plans !== 'object') {
        throw new Error('Plan configuration must have a "plans" object');
    }
    // Validate all required tiers are present
    const requiredTiers = ['SANDBOX', 'TEAM', 'ENTERPRISE'];
    for (const tier of requiredTiers) {
        if (!config.plans[tier]) {
            throw new Error(`Missing plan configuration for tier: ${tier}`);
        }
        const plan = config.plans[tier];
        // Validate capabilities
        if (!Array.isArray(plan.capabilities)) {
            throw new Error(`Plan ${tier}: capabilities must be an array`);
        }
        // Validate all capabilities are valid
        const validCapabilities = Object.values(Capability);
        for (const cap of plan.capabilities) {
            if (typeof cap !== 'string') {
                throw new Error(`Plan ${tier}: capability must be a string, got ${typeof cap}`);
            }
            if (!validCapabilities.includes(cap)) {
                throw new Error(`Plan ${tier}: invalid capability "${cap}". Valid capabilities: ${validCapabilities.join(', ')}`);
            }
        }
        // Validate limits
        if (!plan.limits || typeof plan.limits !== 'object') {
            throw new Error(`Plan ${tier}: limits must be an object`);
        }
        const requiredLimitFields = [
            'analysesPerDay',
            'apiCallsPerDay',
            'uploadsPerDay',
            'maxFilesPerAnalysis',
            'maxBytesPerFile',
        ];
        for (const field of requiredLimitFields) {
            if (!(field in plan.limits)) {
                throw new Error(`Plan ${tier}: missing limit field "${field}"`);
            }
            const value = plan.limits[field];
            if (typeof value !== 'number') {
                throw new Error(`Plan ${tier}: limit "${field}" must be a number, got ${typeof value}`);
            }
            // -1 means unlimited, otherwise must be non-negative
            if (value !== -1 && value < 0) {
                throw new Error(`Plan ${tier}: limit "${field}" must be -1 (unlimited) or >= 0, got ${value}`);
            }
        }
    }
    // Validate no extra tiers
    const tierKeys = Object.keys(config.plans);
    const invalidTiers = tierKeys.filter(tier => !requiredTiers.includes(tier));
    if (invalidTiers.length > 0) {
        throw new Error(`Invalid plan tiers found: ${invalidTiers.join(', ')}. Valid tiers: ${requiredTiers.join(', ')}`);
    }
}
/**
 * Get plan configuration for a specific tier
 */
export function getPlanConfig(tier) {
    const config = loadPlanConfig();
    return config.plans[tier];
}
/**
 * Get all capabilities for a tier
 */
export function getCapabilitiesForTier(tier) {
    const config = getPlanConfig(tier);
    return config.capabilities;
}
/**
 * Get all limits for a tier
 */
export function getLimitsForTier(tier) {
    const config = getPlanConfig(tier);
    return config.limits;
}
