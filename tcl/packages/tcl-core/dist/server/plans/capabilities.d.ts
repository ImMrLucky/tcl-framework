/**
 * Capability constants for tiered plans
 * These define what features are available to each plan tier
 */
export declare enum Capability {
    ANALYZE_MANUAL_UPLOAD = "ANALYZE_MANUAL_UPLOAD",
    GRAPH_VIEW = "GRAPH_VIEW",
    SPECTRAL_SUMMARY = "SPECTRAL_SUMMARY",
    EXPORT_JSON = "EXPORT_JSON",
    EXPORT_CSV = "EXPORT_CSV",
    API_ACCESS_SANDBOX = "API_ACCESS_SANDBOX",
    API_ACCESS_PROD = "API_ACCESS_PROD",
    WEBHOOKS_TEST = "WEBHOOKS_TEST",
    WEBHOOKS_PROD = "WEBHOOKS_PROD",
    BATCH_INGEST = "BATCH_INGEST",
    CLOUD_CONNECTORS = "CLOUD_CONNECTORS",
    USAGE_DASHBOARD = "USAGE_DASHBOARD",
    TEMPLATE_CUSTOMIZATION = "TEMPLATE_CUSTOMIZATION"
}
export type PlanTier = 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
export type PlanStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
/**
 * Plan limits configuration
 */
export interface PlanLimits {
    analysesPerDay: number;
    apiCallsPerDay: number;
    uploadsPerDay: number;
    maxFilesPerAnalysis: number;
    maxBytesPerFile: number;
}
/**
 * @deprecated Use plan-config.ts loadPlanConfig() instead
 * These constants are kept for backwards compatibility but should not be used directly.
 * They will be removed in a future version.
 */
export declare const TIER_CAPABILITIES: Record<PlanTier, Capability[]>;
/**
 * @deprecated Use plan-config.ts loadPlanConfig() instead
 * These constants are kept for backwards compatibility but should not be used directly.
 * They will be removed in a future version.
 */
export declare const TIER_LIMITS: Record<PlanTier, PlanLimits>;
