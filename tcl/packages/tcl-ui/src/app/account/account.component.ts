import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTableModule } from '@angular/material/table';
import { AppHeaderComponent } from '../shared/app-header.component';
import { PlanService, PlanContext, PlanTier } from '../plan.service';
import { BillingService } from '../billing.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressBarModule,
    MatDividerModule,
    MatTableModule,
    MatSnackBarModule,
    AppHeaderComponent
  ],
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss']
})
export class AccountComponent implements OnInit {
  planContext: PlanContext | null = null;
  loading = false;
  showUpgrade = false;

  constructor(
    public planService: PlanService, // Public for template access
    private route: ActivatedRoute,
    private billingService: BillingService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    // Check query params for upgrade flag and checkout status
    this.route.queryParams.subscribe(params => {
      this.showUpgrade = params['upgrade'] === '1' || params['manage'] === '1';
      
      // Handle checkout success/cancel
      if (params['checkout'] === 'success') {
        const snackBarRef = this.snackBar.open(
          'Subscription activated! Your plan has been upgraded to Team.',
          'Close',
          { duration: 5000 }
        );
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        
        // Reload plan context
        this.planService.loadPlanContext();
      } else if (params['checkout'] === 'canceled') {
        const snackBarRef = this.snackBar.open(
          'Checkout canceled. No changes were made.',
          'Close',
          { duration: 3000 }
        );
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    });

    // Subscribe to plan context
    this.planService.planContext$.subscribe(context => {
      this.planContext = context;
    });

    this.planService.loading$.subscribe(loading => {
      this.loading = loading;
    });

    // Load plan context if not already loaded
    if (!this.planContext) {
      this.planService.loadPlanContext();
    }
  }

  getPlanTierDisplay(tier: PlanTier): string {
    return this.planService.getPlanTierDisplay(tier);
  }

  getPlanTierColor(tier: PlanTier): string {
    return this.planService.getPlanTierColor(tier);
  }

  getRemainingPercentage(metric: 'analysisRuns' | 'apiCalls' | 'uploads'): number {
    if (!this.planContext) return 0;
    
    const limit = this.planService.getLimit(
      metric === 'analysisRuns' ? 'analysisRunsPerDay' :
      metric === 'apiCalls' ? 'apiCallsPerDay' : 'uploadsPerDay'
    );
    
    if (limit === -1) return 100; // Unlimited
    
    const remaining = this.planContext.remainingToday[metric];
    return Math.max(0, Math.min(100, (remaining / limit) * 100));
  }

  formatBytes(bytes: number): string {
    if (bytes === -1) return 'Unlimited';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  onUpgradeClick(): void {
    // TODO: Implement upgrade flow (Stripe checkout, etc.)
    window.open('https://protectqa.com/pricing', '_blank');
  }

  onManageBillingClick(): void {
    // TODO: Implement billing management (Stripe customer portal, etc.)
    window.open('https://protectqa.com/billing', '_blank');
  }

  onContactAdminClick(): void {
    window.open('mailto:support@protectqa.com?subject=Enterprise%20Support', '_blank');
  }
}

