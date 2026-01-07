/**
 * Capability constants for tiered plans
 * These define what features are available to each plan tier
 */
export var Capability;
(function (Capability) {
    // Analysis & Upload
    Capability["ANALYZE_MANUAL_UPLOAD"] = "ANALYZE_MANUAL_UPLOAD";
    Capability["GRAPH_VIEW"] = "GRAPH_VIEW";
    Capability["SPECTRAL_SUMMARY"] = "SPECTRAL_SUMMARY";
    // Exports
    Capability["EXPORT_JSON"] = "EXPORT_JSON";
    Capability["EXPORT_CSV"] = "EXPORT_CSV";
    // API Access
    Capability["API_ACCESS_SANDBOX"] = "API_ACCESS_SANDBOX";
    Capability["API_ACCESS_PROD"] = "API_ACCESS_PROD";
    // Webhooks
    Capability["WEBHOOKS_TEST"] = "WEBHOOKS_TEST";
    Capability["WEBHOOKS_PROD"] = "WEBHOOKS_PROD";
    // Advanced Features
    Capability["BATCH_INGEST"] = "BATCH_INGEST";
    Capability["CLOUD_CONNECTORS"] = "CLOUD_CONNECTORS";
    // Management
    Capability["USAGE_DASHBOARD"] = "USAGE_DASHBOARD";
    Capability["TEMPLATE_CUSTOMIZATION"] = "TEMPLATE_CUSTOMIZATION";
})(Capability || (Capability = {}));
/**
 * @deprecated Use plan-config.ts loadPlanConfig() instead
 * These constants are kept for backwards compatibility but should not be used directly.
 * They will be removed in a future version.
 */
export const TIER_CAPABILITIES = {
    SANDBOX: [],
    TEAM: [],
    ENTERPRISE: [],
};
/**
 * @deprecated Use plan-config.ts loadPlanConfig() instead
 * These constants are kept for backwards compatibility but should not be used directly.
 * They will be removed in a future version.
 */
export const TIER_LIMITS = {
    SANDBOX: {
        analysesPerDay: 0,
        apiCallsPerDay: 0,
        uploadsPerDay: 0,
        maxFilesPerAnalysis: 0,
        maxBytesPerFile: 0,
    },
    TEAM: {
        analysesPerDay: 0,
        apiCallsPerDay: 0,
        uploadsPerDay: 0,
        maxFilesPerAnalysis: 0,
        maxBytesPerFile: 0,
    },
    ENTERPRISE: {
        analysesPerDay: 0,
        apiCallsPerDay: 0,
        uploadsPerDay: 0,
        maxFilesPerAnalysis: 0,
        maxBytesPerFile: 0,
    },
};
