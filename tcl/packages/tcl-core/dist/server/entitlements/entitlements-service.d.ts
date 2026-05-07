export type EntitlementTier = 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
export type EntitlementFeature = 'enterpriseGovernance' | 'approvalsWorkflow' | 'auditPacksAdvanced' | 'legalHold' | 'issueDecisions' | 'reviewerSignoff' | 'cases' | 'integrations' | 'batchIngestion' | 'connectorsS3' | 'connectorsDropbox' | 'connectorsGDrive' | 'ssoSaml' | 'scim';
export interface OrgEntitlements {
    orgId: string;
    tier: EntitlementTier;
    features: Record<EntitlementFeature, boolean>;
}
/**
 * EntitlementsService - Authoritative source for org feature entitlements
 * Backend must enforce entitlements even if UI hides features
 */
export declare class EntitlementsService {
    /**
     * Get organization entitlements (with caching)
     */
    getOrgEntitlements(orgId: string): Promise<OrgEntitlements>;
    /**
     * Get entitlements for a specific tier (without org context)
     * Useful for emulation or tier comparison
     */
    getEntitlementsForTier(tier: EntitlementTier): Promise<OrgEntitlements>;
    /**
     * Get default entitlements for a tier
     */
    private getDefaultEntitlementsForTier;
    /**
     * Check if org has a specific feature entitlement
     */
    has(orgId: string, featureKey: EntitlementFeature): Promise<boolean>;
    /**
     * Require a feature entitlement (throws if not available)
     * Use this in middleware/route handlers
     */
    require(orgId: string, featureKey: EntitlementFeature): Promise<void>;
    /**
     * Clear cache for an org (call when entitlements are updated)
     */
    clearCache(orgId: string): void;
    /**
     * Clear all cache
     */
    clearAllCache(): void;
    /**
     * Normalize entitlements data from database
     */
    private normalizeEntitlements;
    /**
     * Cache entitlements with TTL
     */
    private cacheEntitlements;
}
export declare const entitlementsService: EntitlementsService;
