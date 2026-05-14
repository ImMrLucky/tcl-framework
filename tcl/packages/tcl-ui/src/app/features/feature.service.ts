/**
 * Unified Feature Service
 * Checks both capabilities (from PlanService) and entitlements (from EntitlementsService)
 * Provides single source of truth for feature availability
 */

import { Injectable } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { PlanService, Capability, PlanTier } from '../plan.service';
import { EntitlementsService, EntitlementFeature } from '../entitlements.service';

export type FeatureKey = Capability | EntitlementFeature;

export interface FeatureInfo {
  key: FeatureKey;
  name: string;
  description: string;
  requiredTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
  type: 'capability' | 'entitlement';
}

/**
 * Feature definitions - single source of truth
 */
export const FEATURE_DEFINITIONS: Record<string, FeatureInfo> = {
  // Capabilities
  ANALYZE_MANUAL_UPLOAD: {
    key: 'ANALYZE_MANUAL_UPLOAD',
    name: 'Manual Analysis',
    description: 'Upload and analyze conversations manually',
    requiredTier: 'SANDBOX',
    type: 'capability',
  },
  API_ACCESS_SANDBOX: {
    key: 'API_ACCESS_SANDBOX',
    name: 'API Access (Sandbox)',
    description: 'Access API in sandbox/test mode',
    requiredTier: 'SANDBOX',
    type: 'capability',
  },
  API_ACCESS_PROD: {
    key: 'API_ACCESS_PROD',
    name: 'API Access (Production)',
    description: 'Access API in production mode',
    requiredTier: 'TEAM',
    type: 'capability',
  },
  WEBHOOKS_TEST: {
    key: 'WEBHOOKS_TEST',
    name: 'Webhooks (Test)',
    description: 'Test webhook integrations',
    requiredTier: 'SANDBOX',
    type: 'capability',
  },
  WEBHOOKS_PROD: {
    key: 'WEBHOOKS_PROD',
    name: 'Webhooks (Production)',
    description: 'Production webhook integrations',
    requiredTier: 'TEAM',
    type: 'capability',
  },
  BATCH_INGEST: {
    key: 'BATCH_INGEST',
    name: 'Batch Ingestion',
    description: 'Upload and process multiple files at once',
    requiredTier: 'TEAM',
    type: 'capability',
  },
  CLOUD_CONNECTORS: {
    key: 'CLOUD_CONNECTORS',
    name: 'Cloud Connectors',
    description: 'Connect to S3, Dropbox, Google Drive',
    requiredTier: 'ENTERPRISE',
    type: 'capability',
  },
  USAGE_DASHBOARD: {
    key: 'USAGE_DASHBOARD',
    name: 'Usage Dashboard',
    description: 'View detailed usage analytics',
    requiredTier: 'TEAM',
    type: 'capability',
  },
  TEMPLATE_CUSTOMIZATION: {
    key: 'TEMPLATE_CUSTOMIZATION',
    name: 'Template Customization',
    description: 'Customize evaluation templates',
    requiredTier: 'ENTERPRISE',
    type: 'capability',
  },
  // Entitlements
  issueDecisions: {
    key: 'issueDecisions',
    name: 'Issue Decisions',
    description: 'Create and manage issue dispositions',
    requiredTier: 'TEAM',
    type: 'entitlement',
  },
  cases: {
    key: 'cases',
    name: 'Case Management',
    description: 'Organize issues into cases',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  integrations: {
    key: 'integrations',
    name: 'Integrations',
    description: 'Jira, Webhooks, and other integrations',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  batchIngestion: {
    key: 'batchIngestion',
    name: 'Batch Ingestion',
    description: 'Bulk upload and process files',
    requiredTier: 'TEAM',
    type: 'entitlement',
  },
  legalHold: {
    key: 'legalHold',
    name: 'Legal Hold',
    description: 'Lock issues for legal/compliance',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  reviewerSignoff: {
    key: 'reviewerSignoff',
    name: 'Reviewer Signoffs',
    description: 'Require signoffs from reviewers',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  auditPacksAdvanced: {
    key: 'auditPacksAdvanced',
    name: 'Advanced Audit Packs',
    description: 'Generate comprehensive audit packs',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  enterpriseGovernance: {
    key: 'enterpriseGovernance',
    name: 'Enterprise Governance',
    description: 'Advanced role management and controls',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  connectorsS3: {
    key: 'connectorsS3',
    name: 'S3 Connector',
    description: 'Connect to Amazon S3',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  connectorsDropbox: {
    key: 'connectorsDropbox',
    name: 'Dropbox Connector',
    description: 'Connect to Dropbox',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  connectorsGDrive: {
    key: 'connectorsGDrive',
    name: 'Google Drive Connector',
    description: 'Connect to Google Drive',
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
  agentStudio: {
    key: 'agentStudio',
    name: 'Agent Studio',
    description: 'ProtectQA Agent Developer Platform — teams of AI agents, Kanban execution, BYOK, MCP, IDE',
    // Treated as its own product; not auto-unlocked by any TCL tier.
    // We tag it ENTERPRISE for sort/grouping purposes only.
    requiredTier: 'ENTERPRISE',
    type: 'entitlement',
  },
};

@Injectable({
  providedIn: 'root'
})
export class FeatureService {
  constructor(
    private planService: PlanService,
    private entitlementsService: EntitlementsService
  ) {}

  /**
   * Check if a feature is available (checks both capabilities and entitlements)
   */
  hasFeature(featureKey: FeatureKey): boolean {
    const feature = FEATURE_DEFINITIONS[featureKey];
    if (!feature) {
      console.warn(`Unknown feature: ${featureKey}`);
      return false;
    }

    if (feature.type === 'capability') {
      return this.planService.hasCapability(featureKey as Capability);
    } else {
      return this.entitlementsService.hasFeature(featureKey as EntitlementFeature);
    }
  }

  /**
   * Observable for feature availability
   */
  hasFeature$(featureKey: FeatureKey): Observable<boolean> {
    const feature = FEATURE_DEFINITIONS[featureKey];
    if (!feature) {
      return new Observable(observer => {
        observer.next(false);
        observer.complete();
      });
    }

    if (feature.type === 'capability') {
      return this.planService.planContext$.pipe(
        map(context => context?.capabilities.includes(featureKey as Capability) ?? false)
      );
    } else {
      return this.entitlementsService.hasFeature$(featureKey as EntitlementFeature);
    }
  }

  /**
   * Get feature info
   */
  getFeatureInfo(featureKey: FeatureKey): FeatureInfo | null {
    return FEATURE_DEFINITIONS[featureKey] || null;
  }

  /**
   * Get required tier for a feature
   */
  getRequiredTier(featureKey: FeatureKey): 'SANDBOX' | 'TEAM' | 'ENTERPRISE' | null {
    const feature = FEATURE_DEFINITIONS[featureKey];
    return feature?.requiredTier || null;
  }

  /**
   * Check if current tier has access to a feature
   */
  canAccessFeature(featureKey: FeatureKey): boolean {
    const requiredTier = this.getRequiredTier(featureKey);
    if (!requiredTier) return false;

    const currentTier = this.planService.getPlanContext()?.tier || 'SANDBOX';
    const tierHierarchy: ('SANDBOX' | 'TEAM' | 'ENTERPRISE')[] = ['SANDBOX', 'TEAM', 'ENTERPRISE'];
    
    const currentIndex = tierHierarchy.indexOf(currentTier);
    const requiredIndex = tierHierarchy.indexOf(requiredTier);
    
    // Must have tier access AND the feature enabled
    return currentIndex >= requiredIndex && this.hasFeature(featureKey);
  }

  /**
   * Get upgrade message for a feature
   */
  getUpgradeMessage(featureKey: FeatureKey): string {
    const requiredTier = this.getRequiredTier(featureKey);
    if (!requiredTier) return 'Feature not available';

    const feature = FEATURE_DEFINITIONS[featureKey];
    const tierName = requiredTier === 'TEAM' ? 'Team' : requiredTier === 'ENTERPRISE' ? 'Enterprise' : 'Sandbox';
    
    return `Upgrade to ${tierName} to unlock ${feature?.name || featureKey}`;
  }

  /**
   * Get all features available to current tier
   */
  getAvailableFeatures(): FeatureInfo[] {
    const currentTier = this.planService.getPlanContext()?.tier || 'SANDBOX';
    const tierHierarchy: ('SANDBOX' | 'TEAM' | 'ENTERPRISE')[] = ['SANDBOX', 'TEAM', 'ENTERPRISE'];
    const currentIndex = tierHierarchy.indexOf(currentTier);

    return Object.values(FEATURE_DEFINITIONS).filter(feature => {
      const requiredIndex = tierHierarchy.indexOf(feature.requiredTier);
      return currentIndex >= requiredIndex && this.hasFeature(feature.key);
    });
  }

  /**
   * Check if a specific tier has access to a feature (for comparison tables)
   */
  hasFeatureForTier(featureKey: FeatureKey, tier: PlanTier): boolean {
    const feature = FEATURE_DEFINITIONS[featureKey];
    if (!feature) return false;

    const tierHierarchy: ('SANDBOX' | 'TEAM' | 'ENTERPRISE')[] = ['SANDBOX', 'TEAM', 'ENTERPRISE'];
    const tierIndex = tierHierarchy.indexOf(tier);
    const requiredIndex = tierHierarchy.indexOf(feature.requiredTier);

    // Tier must be at or above required tier
    return tierIndex >= requiredIndex;
  }
}

