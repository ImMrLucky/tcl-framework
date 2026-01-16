import { supabaseAdmin } from '../supabase.js';
import {
  Capability,
  PlanTier,
  PlanStatus,
  type PlanLimits,
} from './capabilities.js';
import { getCapabilitiesForTier, getLimitsForTier } from '../../config/plan-config.js';

export interface OrgPlanContext {
  tier: PlanTier;
  status: PlanStatus;
  capabilities: Capability[];
  limits: PlanLimits;
  remainingToday: {
    analysisRuns: number; // Frontend field name
    analyses?: number; // Backwards compatibility
    apiCalls: number;
    uploads: number;
  };
  // Emulation fields (only present when emulation is active)
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
export class PlanService {
  /**
   * Get organization plan context including capabilities, limits, and remaining quotas
   * Supports emulation for superusers
   */
  async getOrgPlanContext(
    orgId: string,
    emulation?: { enabled: boolean; planTier?: PlanTier }
  ): Promise<OrgPlanContext> {
    if (!supabaseAdmin) {
      throw new Error('Supabase not configured');
    }

    // Get org plan info
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('plan_tier, plan_status, features_override_json')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      throw new Error(`Organization not found: ${orgId}`);
    }

    const realTier = (org.plan_tier || 'SANDBOX') as PlanTier;
    const status = (org.plan_status || 'ACTIVE') as PlanStatus;

    // Check if emulation is active
    const isEmulated = emulation?.enabled === true && emulation?.planTier;
    const effectiveTier = isEmulated ? (emulation.planTier as PlanTier) : realTier;

    // Get base capabilities for effective tier from config
    let capabilities = [...getCapabilitiesForTier(effectiveTier)];

    // Apply features_override_json if present
    if (org.features_override_json) {
      const override = org.features_override_json as {
        enabled?: string[];
        disabled?: string[];
      };

      if (override.enabled) {
        // Add enabled capabilities
        for (const cap of override.enabled) {
          if (!capabilities.includes(cap as Capability)) {
            capabilities.push(cap as Capability);
          }
        }
      }

      if (override.disabled) {
        // Remove disabled capabilities
        capabilities = capabilities.filter(
          (cap) => !override.disabled!.includes(cap)
        );
      }
    }

    // Get limits for effective tier from config
    // Backend uses analysesPerDay, frontend expects analysisRunsPerDay
    const rawLimits = getLimitsForTier(effectiveTier);
    const limits: PlanLimits & { analysisRunsPerDay?: number } = {
      ...rawLimits,
      analysisRunsPerDay: rawLimits.analysesPerDay, // Frontend field name
    };

    // Get today's usage
    const { data: usage } = await supabaseAdmin!
      .from('org_usage_daily')
      .select('analysis_runs, api_calls, uploads_count')
      .eq('org_id', orgId)
      .eq('date', new Date().toISOString().split('T')[0])
      .single();

    const todayUsage = usage || {
      analysis_runs: 0,
      api_calls: 0,
      uploads_count: 0,
    };

    // Calculate remaining quotas
    // Frontend expects analysisRuns, but we also provide analyses for backwards compatibility
    const analysesRemaining = limits.analysesPerDay === -1
      ? -1
      : Math.max(0, limits.analysesPerDay - todayUsage.analysis_runs);
    const remainingToday = {
      analysisRuns: analysesRemaining, // Frontend field name
      analyses: analysesRemaining, // Backwards compatibility
      apiCalls:
        limits.apiCallsPerDay === -1
          ? -1
          : Math.max(0, limits.apiCallsPerDay - todayUsage.api_calls),
      uploads:
        limits.uploadsPerDay === -1
          ? -1
          : Math.max(0, limits.uploadsPerDay - todayUsage.uploads_count),
    };

    const result: OrgPlanContext = {
      tier: effectiveTier,
      status,
      capabilities,
      limits,
      remainingToday,
    };

    // Add emulation metadata if active
    if (isEmulated) {
      result.emulated = true;
      result.realPlanTier = realTier;
      result.effectivePlanTier = effectiveTier;
    }

    return result;
  }

  /**
   * Consume usage quota and enforce limits
   * Returns remaining quota, or throws RateLimitError if exceeded
   */
  async consumeUsage(
    orgId: string,
    metric: 'analysis_runs' | 'api_calls' | 'uploads_count' | 'uploads_bytes' | 'webhook_deliveries',
    amount: number = 1
  ): Promise<{ remaining: number; limit: number }> {
    // Get plan context
    const context = await this.getOrgPlanContext(orgId);

    // Check if plan is active
    if (context.status !== 'ACTIVE') {
      throw new Error(`Plan status is ${context.status}. Usage not allowed.`);
    }

    // Get the limit for this metric
    let limit: number;
    switch (metric) {
      case 'analysis_runs':
        limit = context.limits.analysesPerDay;
        break;
      case 'api_calls':
        limit = context.limits.apiCallsPerDay;
        break;
      case 'uploads_count':
        limit = context.limits.uploadsPerDay;
        break;
      case 'uploads_bytes':
        limit = context.limits.maxBytesPerFile;
        break;
      case 'webhook_deliveries':
        // Webhooks are unlimited for now
        limit = -1;
        break;
      default:
        limit = -1;
    }

    // If unlimited, just record usage and return
    if (limit === -1) {
      await this.recordUsage(orgId, metric, amount);
      return { remaining: -1, limit: -1 };
    }

    if (!supabaseAdmin) {
      throw new Error('Supabase not configured');
    }

    // Get or create today's usage record
    const { data: usageRows, error: usageError } = await supabaseAdmin.rpc(
      'get_or_create_usage_today',
      { p_org_id: orgId }
    );

    if (usageError) {
      throw new Error(`Failed to get usage record: ${usageError.message}`);
    }

    // RPC returns an array, get first row
    const usage = Array.isArray(usageRows) ? usageRows[0] : usageRows;
    const currentUsage = (usage as any)?.[metric] || 0;
    const newUsage = currentUsage + amount;

    // Check if limit would be exceeded
    if (newUsage > limit) {
      const error: RateLimitError = {
        error: 'RATE_LIMIT',
        metric,
        limit,
        remaining: Math.max(0, limit - currentUsage),
        planTier: context.tier,
      };
      throw error;
    }

    // Update usage
    const { error: updateError } = await supabaseAdmin!
      .from('org_usage_daily')
      .update({
        [metric]: newUsage,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', orgId)
      .eq('date', new Date().toISOString().split('T')[0]);

    if (updateError) {
      throw new Error(`Failed to update usage: ${updateError.message}`);
    }

    return {
      remaining: limit - newUsage,
      limit,
    };
  }

  /**
   * Record usage without enforcing limits (for unlimited plans or internal tracking)
   */
  private async recordUsage(
    orgId: string,
    metric: 'analysis_runs' | 'api_calls' | 'uploads_count' | 'uploads_bytes' | 'webhook_deliveries',
    amount: number
  ): Promise<void> {
    if (!supabaseAdmin) {
      throw new Error('Supabase not configured');
    }

    if (!supabaseAdmin) {
      throw new Error('Supabase not configured');
    }

    // Get or create today's usage record
    const { data: usageRows, error: usageError } = await supabaseAdmin.rpc(
      'get_or_create_usage_today',
      { p_org_id: orgId }
    );

    if (usageError) {
      throw new Error(`Failed to get usage record: ${usageError.message}`);
    }

    // RPC returns an array, get first row
    const usage = Array.isArray(usageRows) ? usageRows[0] : usageRows;
    const currentUsage = (usage as any)?.[metric] || 0;
    const newUsage = currentUsage + amount;

    const { error: updateError } = await supabaseAdmin!
      .from('org_usage_daily')
      .update({
        [metric]: newUsage,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', orgId)
      .eq('date', new Date().toISOString().split('T')[0]);

    if (updateError) {
      throw new Error(`Failed to record usage: ${updateError.message}`);
    }
  }

  /**
   * Check if organization has a specific capability
   */
  async hasCapability(orgId: string, capability: Capability): Promise<boolean> {
    const context = await this.getOrgPlanContext(orgId);
    return context.capabilities.includes(capability);
  }
}

// Export singleton instance
export const planService = new PlanService();

