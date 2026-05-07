import { Capability, PlanTier, PlanStatus, type PlanLimits } from './capabilities.js';
export interface OrgPlanContext {
    tier: PlanTier;
    status: PlanStatus;
    capabilities: Capability[];
    limits: PlanLimits;
    remainingToday: {
        analysisRuns: number;
        analyses?: number;
        apiCalls: number;
        uploads: number;
    };
    emulated?: boolean;
    realPlanTier?: PlanTier;
    effectivePlanTier?: PlanTier;
}
export interface UsageMetrics {
    analysis_runs: number;
    api_calls: number;
    uploads_count: number;
    uploads_bytes: number;
    webhook_deliveries: number;
}
export interface RateLimitError {
    error: 'RATE_LIMIT';
    metric: string;
    limit: number;
    remaining: number;
    planTier: PlanTier;
}
/**
 * PlanService - Centralized plan and capability management
 */
export declare class PlanService {
    /**
     * Get organization plan context including capabilities, limits, and remaining quotas
     * Supports emulation for superusers
     */
    getOrgPlanContext(orgId: string, emulation?: {
        enabled: boolean;
        planTier?: PlanTier;
    }): Promise<OrgPlanContext>;
    /**
     * Consume usage quota and enforce limits
     * Returns remaining quota, or throws RateLimitError if exceeded
     */
    consumeUsage(orgId: string, metric: 'analysis_runs' | 'api_calls' | 'uploads_count' | 'uploads_bytes' | 'webhook_deliveries', amount?: number): Promise<{
        remaining: number;
        limit: number;
    }>;
    /**
     * Record usage without enforcing limits (for unlimited plans or internal tracking)
     */
    private recordUsage;
    /**
     * Check if organization has a specific capability
     */
    hasCapability(orgId: string, capability: Capability): Promise<boolean>;
}
export declare const planService: PlanService;
