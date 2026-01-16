/**
 * Upgrade Prompt Component
 * Shows upgrade prompts when features are blocked or limits are hit
 */

import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { FeatureService } from '../features/feature.service';

export interface UpgradePromptData {
  featureName: string;
  requiredTier: 'TEAM' | 'ENTERPRISE';
  currentTier?: 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
  reason?: 'feature_blocked' | 'limit_reached' | 'capability_required';
  limitInfo?: {
    metric: string;
    used: number;
    limit: number;
  };
}

@Component({
  selector: 'app-upgrade-prompt',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>lock</mat-icon>
      Upgrade Required
    </h2>
    <mat-dialog-content>
      <div class="upgrade-content">
        <p class="upgrade-message">
          <ng-container *ngIf="data.reason === 'feature_blocked'">
            <strong>{{ data.featureName }}</strong> is only available on the <strong>{{ data.requiredTier }}</strong> plan.
          </ng-container>
          <ng-container *ngIf="data.reason === 'limit_reached' && data.limitInfo">
            You've reached your daily limit of <strong>{{ data.limitInfo.limit }} {{ data.limitInfo.metric }}</strong>.
            Upgrade to continue using this feature.
          </ng-container>
          <ng-container *ngIf="data.reason === 'capability_required'">
            This feature requires the <strong>{{ data.requiredTier }}</strong> plan.
          </ng-container>
        </p>
        
        <div class="tier-comparison" *ngIf="data.currentTier">
          <div class="tier-badge current">
            <span>Current: {{ data.currentTier }}</span>
          </div>
          <mat-icon>arrow_forward</mat-icon>
          <div class="tier-badge required">
            <span>Required: {{ data.requiredTier }}</span>
          </div>
        </div>
        
        <div class="upgrade-benefits" *ngIf="data.requiredTier === 'TEAM'">
          <h3>Upgrade to Team and get:</h3>
          <ul>
            <li>500 evaluations per day (vs 10)</li>
            <li>5,000 API calls per day (vs 3)</li>
            <li>Production API access</li>
            <li>Production webhooks</li>
            <li>Batch ingestion</li>
            <li>Issue decisions</li>
            <li>Usage dashboard</li>
          </ul>
        </div>
        
        <div class="upgrade-benefits" *ngIf="data.requiredTier === 'ENTERPRISE'">
          <h3>Upgrade to Enterprise and get:</h3>
          <ul>
            <li>Unlimited usage</li>
            <li>Cloud connectors (S3, Dropbox, Google Drive)</li>
            <li>Case management</li>
            <li>Integrations (Jira, Webhooks)</li>
            <li>Legal hold & snapshots</li>
            <li>Reviewer signoffs</li>
            <li>Advanced audit packs</li>
            <li>Enterprise governance</li>
            <li>Template customization</li>
          </ul>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Maybe Later</button>
      <button mat-raised-button color="primary" (click)="onUpgrade()">
        <mat-icon>arrow_upward</mat-icon>
        Upgrade to {{ data.requiredTier }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .upgrade-content {
      padding: 16px 0;
    }
    
    .upgrade-message {
      font-size: 16px;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    
    .tier-comparison {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 24px 0;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    
    .tier-badge {
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 500;
      
      &.current {
        background: #fff3cd;
        color: #856404;
      }
      
      &.required {
        background: #d1ecf1;
        color: #0c5460;
      }
    }
    
    .upgrade-benefits {
      margin-top: 24px;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 8px;
      
      h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
        color: #333;
      }
      
      ul {
        margin: 0;
        padding-left: 20px;
        
        li {
          margin: 8px 0;
          color: #666;
        }
      }
    }
    
    mat-dialog-actions {
      padding: 16px 24px;
      border-top: 1px solid #e0e0e0;
    }
  `]
})
export class UpgradePromptComponent {
  constructor(
    public dialogRef: MatDialogRef<UpgradePromptComponent>,
    @Inject(MAT_DIALOG_DATA) public data: UpgradePromptData,
    private router: Router
  ) {}

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onUpgrade(): void {
    this.dialogRef.close(true);
    if (this.data.requiredTier === 'TEAM') {
      this.router.navigate(['/account'], { queryParams: { upgrade: '1' } });
    } else {
      // Enterprise - contact sales
      window.open('mailto:sales@protectqa.com?subject=Enterprise%20Plan%20Inquiry', '_blank');
    }
  }
}

