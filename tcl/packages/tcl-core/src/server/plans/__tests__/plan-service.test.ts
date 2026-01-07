import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanService } from '../plan-service.js';
import { Capability, TIER_CAPABILITIES, TIER_LIMITS } from '../capabilities.js';
import { supabaseAdmin } from '../../supabase.js';

// Mock supabase
vi.mock('../../supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('PlanService', () => {
  let planService: PlanService;
  const mockOrgId = 'test-org-id';

  beforeEach(() => {
    planService = new PlanService();
    vi.clearAllMocks();
  });

  describe('getOrgPlanContext', () => {
    it('should return SANDBOX plan context by default', async () => {
      const mockOrg = {
        plan_tier: 'SANDBOX',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 2,
        api_calls: 1,
        uploads_count: 3,
      };

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      const context = await planService.getOrgPlanContext(mockOrgId);

      expect(context.tier).toBe('SANDBOX');
      expect(context.status).toBe('ACTIVE');
      expect(context.capabilities).toEqual(TIER_CAPABILITIES.SANDBOX);
      expect(context.limits).toEqual(TIER_LIMITS.SANDBOX);
      expect(context.remainingToday.analyses).toBe(8); // 10 - 2
      expect(context.remainingToday.apiCalls).toBe(2); // 3 - 1
      expect(context.remainingToday.uploads).toBe(7); // 10 - 3
    });

    it('should return TEAM plan context with higher limits', async () => {
      const mockOrg = {
        plan_tier: 'TEAM',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 100,
        api_calls: 1000,
        uploads_count: 50,
      };

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      const context = await planService.getOrgPlanContext(mockOrgId);

      expect(context.tier).toBe('TEAM');
      expect(context.capabilities).toEqual(TIER_CAPABILITIES.TEAM);
      expect(context.limits).toEqual(TIER_LIMITS.TEAM);
      expect(context.remainingToday.analyses).toBe(400); // 500 - 100
    });

    it('should apply features_override_json to enable/disable capabilities', async () => {
      const mockOrg = {
        plan_tier: 'SANDBOX',
        plan_status: 'ACTIVE',
        features_override_json: {
          enabled: [Capability.API_ACCESS_PROD],
          disabled: [Capability.EXPORT_CSV],
        },
      };

      const mockUsage = {
        analysis_runs: 0,
        api_calls: 0,
        uploads_count: 0,
      };

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      const context = await planService.getOrgPlanContext(mockOrgId);

      // Should have API_ACCESS_PROD enabled (from override)
      expect(context.capabilities).toContain(Capability.API_ACCESS_PROD);
      // Should NOT have EXPORT_CSV (disabled by override)
      expect(context.capabilities).not.toContain(Capability.EXPORT_CSV);
    });

    it('should handle missing usage record (first day)', async () => {
      const mockOrg = {
        plan_tier: 'SANDBOX',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const context = await planService.getOrgPlanContext(mockOrgId);

      expect(context.remainingToday.analyses).toBe(10); // Full quota
      expect(context.remainingToday.apiCalls).toBe(3);
      expect(context.remainingToday.uploads).toBe(10);
    });
  });

  describe('consumeUsage', () => {
    it('should allow usage within limits', async () => {
      const mockOrg = {
        plan_tier: 'SANDBOX',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 5,
        api_calls: 1,
        uploads_count: 3,
      };

      // Mock getOrgPlanContext calls
      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      // Mock RPC call for get_or_create_usage_today
      (supabaseAdmin.rpc as any).mockResolvedValueOnce({
        data: mockUsage,
        error: null,
      });

      // Mock update call
      (supabaseAdmin.from as any).mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await planService.consumeUsage(mockOrgId, 'analysis_runs', 1);

      expect(result.remaining).toBe(4); // 10 - 5 - 1
      expect(result.limit).toBe(10);
    });

    it('should throw RateLimitError when limit exceeded', async () => {
      const mockOrg = {
        plan_tier: 'SANDBOX',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 10, // Already at limit
        api_calls: 0,
        uploads_count: 0,
      };

      // Mock getOrgPlanContext calls
      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      // Mock RPC call
      (supabaseAdmin.rpc as any).mockResolvedValueOnce({
        data: mockUsage,
        error: null,
      });

      await expect(
        planService.consumeUsage(mockOrgId, 'analysis_runs', 1)
      ).rejects.toMatchObject({
        error: 'RATE_LIMIT',
        metric: 'analysis_runs',
        limit: 10,
        remaining: 0,
        planTier: 'SANDBOX',
      });
    });

    it('should allow unlimited usage for ENTERPRISE tier', async () => {
      const mockOrg = {
        plan_tier: 'ENTERPRISE',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 1000,
        api_calls: 5000,
        uploads_count: 2000,
      };

      // Mock getOrgPlanContext calls
      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      // Mock RPC call
      (supabaseAdmin.rpc as any).mockResolvedValueOnce({
        data: mockUsage,
        error: null,
      });

      // Mock update call
      (supabaseAdmin.from as any).mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await planService.consumeUsage(mockOrgId, 'analysis_runs', 100);

      expect(result.remaining).toBe(-1); // Unlimited
      expect(result.limit).toBe(-1);
    });

    it('should reject usage if plan status is not ACTIVE', async () => {
      const mockOrg = {
        plan_tier: 'SANDBOX',
        plan_status: 'PAST_DUE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 0,
        api_calls: 0,
        uploads_count: 0,
      };

      // Mock getOrgPlanContext calls
      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      await expect(
        planService.consumeUsage(mockOrgId, 'analysis_runs', 1)
      ).rejects.toThrow('Plan status is PAST_DUE');
    });
  });

  describe('hasCapability', () => {
    it('should return true if org has capability', async () => {
      const mockOrg = {
        plan_tier: 'TEAM',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 0,
        api_calls: 0,
        uploads_count: 0,
      };

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      const hasCap = await planService.hasCapability(mockOrgId, Capability.API_ACCESS_PROD);
      expect(hasCap).toBe(true);
    });

    it('should return false if org does not have capability', async () => {
      const mockOrg = {
        plan_tier: 'SANDBOX',
        plan_status: 'ACTIVE',
        features_override_json: null,
      };

      const mockUsage = {
        analysis_runs: 0,
        api_calls: 0,
        uploads_count: 0,
      };

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
      });

      (supabaseAdmin.from as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockUsage, error: null }),
      });

      const hasCap = await planService.hasCapability(mockOrgId, Capability.API_ACCESS_PROD);
      expect(hasCap).toBe(false);
    });
  });
});

