import { supabaseAdmin } from '../supabase.js';

export type EntitlementTier = 'SANDBOX' | 'TEAM' | 'ENTERPRISE';

export type EntitlementFeature =
  | 'enterpriseGovernance'
  | 'approvalsWorkflow'
  | 'auditPacksAdvanced'
  | 'legalHold'
  | 'issueDecisions'
  | 'reviewerSignoff'
  | 'cases'
  | 'integrations'
  | 'batchIngestion'
  | 'connectorsS3'
  | 'connectorsDropbox'
  | 'connectorsGDrive'
  | 'ssoSaml'
  | 'scim';

export interface OrgEntitlements {
  orgId: string;
  tier: EntitlementTier;
  features: Record<EntitlementFeature, boolean>;
}

// In-memory cache with TTL (5 minutes)
interface CachedEntitlements {
  entitlements: OrgEntitlements;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CachedEntitlements>();

/**
 * EntitlementsService - Authoritative source for org feature entitlements
 * Backend must enforce entitlements even if UI hides features
 */
export class EntitlementsService {
  /**
   * Get organization entitlements (with caching)
   */
  async getOrgEntitlements(orgId: string): Promise<OrgEntitlements> {
    if (!supabaseAdmin) {
      throw new Error('Supabase not configured');
    }

    // Check cache first
    const cached = cache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entitlements;
    }

    // Fetch from database
    const { data, error } = await supabaseAdmin.rpc('get_org_entitlements', {
      p_org_id: orgId,
    });

    if (error) {
      // If RPC fails, try direct query
      const { data: directData, error: directError } = await supabaseAdmin
        .from('org_entitlements')
        .select('org_id, tier, features')
        .eq('org_id', orgId)
        .maybeSingle();

      if (directError || !directData) {
        // If no entitlements exist, initialize from org's plan_tier
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('plan_tier')
          .eq('id', orgId)
          .maybeSingle();

        if (!org) {
          throw new Error(`Organization not found: ${orgId}`);
        }

        // Initialize entitlements
        await supabaseAdmin.rpc('init_org_entitlements', {
          p_org_id: orgId,
          p_tier: org.plan_tier || 'SANDBOX',
        });

        // Retry fetch
        const { data: retryData, error: retryError } = await supabaseAdmin
          .from('org_entitlements')
          .select('org_id, tier, features')
          .eq('org_id', orgId)
          .single();

        if (retryError || !retryData) {
          throw new Error(`Failed to initialize entitlements: ${retryError?.message || 'Unknown error'}`);
        }

        const entitlements = this.normalizeEntitlements(retryData);
        this.cacheEntitlements(orgId, entitlements);
        return entitlements;
      }

      const entitlements = this.normalizeEntitlements(directData);
      this.cacheEntitlements(orgId, entitlements);
      return entitlements;
    }

    if (!data || data.length === 0) {
      // Initialize entitlements
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('plan_tier')
        .eq('id', orgId)
        .maybeSingle();

      if (!org) {
        throw new Error(`Organization not found: ${orgId}`);
      }

      await supabaseAdmin.rpc('init_org_entitlements', {
        p_org_id: orgId,
        p_tier: org.plan_tier || 'SANDBOX',
      });

      // Retry fetch
      const { data: retryData } = await supabaseAdmin.rpc('get_org_entitlements', {
        p_org_id: orgId,
      });

      if (!retryData || retryData.length === 0) {
        throw new Error('Failed to initialize entitlements');
      }

      const entitlements = this.normalizeEntitlements(retryData[0]);
      this.cacheEntitlements(orgId, entitlements);
      return entitlements;
    }

    const entitlements = this.normalizeEntitlements(data[0]);
    this.cacheEntitlements(orgId, entitlements);
    return entitlements;
  }

  /**
   * Get entitlements for a specific tier (without org context)
   * Useful for emulation or tier comparison
   */
  async getEntitlementsForTier(tier: EntitlementTier): Promise<OrgEntitlements> {
    // Use the default entitlements based on tier
    return this.getDefaultEntitlementsForTier(tier);
  }

  /**
   * Get default entitlements for a tier
   */
  private getDefaultEntitlementsForTier(tier: EntitlementTier): OrgEntitlements {
    const defaultFeatures: Record<EntitlementFeature, boolean> = {
      enterpriseGovernance: tier === 'ENTERPRISE',
      approvalsWorkflow: tier === 'ENTERPRISE',
      auditPacksAdvanced: tier === 'ENTERPRISE',
      legalHold: tier === 'ENTERPRISE',
      issueDecisions: tier === 'TEAM' || tier === 'ENTERPRISE',
      reviewerSignoff: tier === 'ENTERPRISE',
      cases: tier === 'ENTERPRISE',
      integrations: tier === 'ENTERPRISE',
      batchIngestion: tier === 'TEAM' || tier === 'ENTERPRISE',
      connectorsS3: tier === 'ENTERPRISE',
      connectorsDropbox: tier === 'ENTERPRISE',
      connectorsGDrive: tier === 'ENTERPRISE',
      ssoSaml: false,
      scim: false,
    };

    return {
      orgId: '00000000-0000-0000-0000-000000000000', // Dummy org ID for tier-based entitlements
      tier,
      features: defaultFeatures,
    };
  }

  /**
   * Check if org has a specific feature entitlement
   */
  async has(orgId: string, featureKey: EntitlementFeature): Promise<boolean> {
    if (!supabaseAdmin) {
      return false;
    }
    
    try {
      const { data, error } = await supabaseAdmin.rpc('has_entitlement', {
        p_org_id: orgId,
        p_feature_key: featureKey,
      });

      if (error) {
        // Fallback to full entitlements fetch
        const entitlements = await this.getOrgEntitlements(orgId);
        return entitlements.features[featureKey] || false;
      }

      return data || false;
    } catch (error) {
      console.error(`Error checking entitlement ${featureKey} for org ${orgId}:`, error);
      // Fail closed - deny access if check fails
      return false;
    }
  }

  /**
   * Require a feature entitlement (throws if not available)
   * Use this in middleware/route handlers
   */
  async require(orgId: string, featureKey: EntitlementFeature): Promise<void> {
    const hasFeature = await this.has(orgId, featureKey);
    if (!hasFeature) {
      throw new Error(`Feature '${featureKey}' is not available for this organization`);
    }
  }

  /**
   * Clear cache for an org (call when entitlements are updated)
   */
  clearCache(orgId: string): void {
    cache.delete(orgId);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    cache.clear();
  }

  /**
   * Normalize entitlements data from database
   */
  private normalizeEntitlements(data: any): OrgEntitlements {
    const features = data.features || {};
    
    // Ensure all features are present with defaults
    const normalizedFeatures: Record<EntitlementFeature, boolean> = {
      enterpriseGovernance: features.enterpriseGovernance || false,
      approvalsWorkflow: features.approvalsWorkflow || false,
      auditPacksAdvanced: features.auditPacksAdvanced || false,
      legalHold: features.legalHold || false,
      issueDecisions: features.issueDecisions || false,
      reviewerSignoff: features.reviewerSignoff || false,
      cases: features.cases || false,
      integrations: features.integrations || false,
      batchIngestion: features.batchIngestion || false,
      connectorsS3: features.connectorsS3 || false,
      connectorsDropbox: features.connectorsDropbox || false,
      connectorsGDrive: features.connectorsGDrive || false,
      ssoSaml: features.ssoSaml || false,
      scim: features.scim || false,
    };

    return {
      orgId: data.org_id,
      tier: (data.tier || 'SANDBOX') as EntitlementTier,
      features: normalizedFeatures,
    };
  }

  /**
   * Cache entitlements with TTL
   */
  private cacheEntitlements(orgId: string, entitlements: OrgEntitlements): void {
    cache.set(orgId, {
      entitlements,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
}

// Export singleton instance
export const entitlementsService = new EntitlementsService();

