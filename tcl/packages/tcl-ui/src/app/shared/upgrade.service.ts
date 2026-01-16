/**
 * Upgrade Service
 * Provides helper methods for showing upgrade prompts
 */

import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { UpgradePromptComponent, UpgradePromptData } from './upgrade-prompt.component';
import { FeatureService } from '../features/feature.service';
import { PlanService } from '../plan.service';

@Injectable({
  providedIn: 'root'
})
export class UpgradeService {
  constructor(
    private dialog: MatDialog,
    private featureService: FeatureService,
    private planService: PlanService
  ) {}

  /**
   * Show upgrade prompt for a feature
   */
  showFeatureUpgradePrompt(featureKey: string, featureName?: string): void {
    const requiredTier = this.featureService.getRequiredTier(featureKey as any);
    if (!requiredTier) return;

    const currentTier = this.planService.getPlanContext()?.tier || 'SANDBOX';
    
    const data: UpgradePromptData = {
      featureName: featureName || featureKey,
      requiredTier: requiredTier as 'TEAM' | 'ENTERPRISE',
      currentTier: currentTier as 'SANDBOX' | 'TEAM' | 'ENTERPRISE',
      reason: 'feature_blocked',
    };

    this.dialog.open(UpgradePromptComponent, {
      width: '500px',
      data,
    });
  }

  /**
   * Show upgrade prompt when limit is reached
   */
  showLimitUpgradePrompt(metric: string, used: number, limit: number): void {
    const currentTier = this.planService.getPlanContext()?.tier || 'SANDBOX';
    const requiredTier = currentTier === 'SANDBOX' ? 'TEAM' : 'ENTERPRISE';
    
    const data: UpgradePromptData = {
      featureName: metric,
      requiredTier,
      currentTier: currentTier as 'SANDBOX' | 'TEAM' | 'ENTERPRISE',
      reason: 'limit_reached',
      limitInfo: {
        metric,
        used,
        limit,
      },
    };

    this.dialog.open(UpgradePromptComponent, {
      width: '500px',
      data,
    });
  }

  /**
   * Check if upgrade is needed and show prompt
   */
  checkAndPromptUpgrade(featureKey: string, featureName?: string): boolean {
    if (this.featureService.hasFeature(featureKey as any)) {
      return true; // Feature is available
    }

    // Feature not available, show upgrade prompt
    this.showFeatureUpgradePrompt(featureKey, featureName);
    return false;
  }
}

