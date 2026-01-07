/**
 * Capability constants for tiered plans
 * These define what features are available to each plan tier
 */

export enum Capability {
  // Analysis & Upload
  ANALYZE_MANUAL_UPLOAD = 'ANALYZE_MANUAL_UPLOAD',
  GRAPH_VIEW = 'GRAPH_VIEW',
  SPECTRAL_SUMMARY = 'SPECTRAL_SUMMARY',
  
  // Exports
  EXPORT_JSON = 'EXPORT_JSON',
  EXPORT_CSV = 'EXPORT_CSV',
  
  // API Access
  API_ACCESS_SANDBOX = 'API_ACCESS_SANDBOX',
  API_ACCESS_PROD = 'API_ACCESS_PROD',
  
  // Webhooks
  WEBHOOKS_TEST = 'WEBHOOKS_TEST',
  WEBHOOKS_PROD = 'WEBHOOKS_PROD',
  
  // Advanced Features
  BATCH_INGEST = 'BATCH_INGEST',
  CLOUD_CONNECTORS = 'CLOUD_CONNECTORS',
  
  // Management
  USAGE_DASHBOARD = 'USAGE_DASHBOARD',
  TEMPLATE_CUSTOMIZATION = 'TEMPLATE_CUSTOMIZATION',
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
  maxBytesPerFile: number; // in bytes
}

/**
 * @deprecated Use plan-config.ts loadPlanConfig() instead
 * These constants are kept for backwards compatibility but should not be used directly.
 * They will be removed in a future version.
 */
export const TIER_CAPABILITIES: Record<PlanTier, Capability[]> = {
  SANDBOX: [],
  TEAM: [],
  ENTERPRISE: [],
};

/**
 * @deprecated Use plan-config.ts loadPlanConfig() instead
 * These constants are kept for backwards compatibility but should not be used directly.
 * They will be removed in a future version.
 */
export const TIER_LIMITS: Record<PlanTier, PlanLimits> = {
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

