import { Component, OnInit, Input, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatListModule } from '@angular/material/list';
import { LogoComponent } from './logo.component';
import { AuthService, User } from '../auth.service';
import { PlanService, PlanTier } from '../plan.service';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subject } from 'rxjs';
import { takeUntil, distinctUntilChanged, debounceTime } from 'rxjs/operators';
import { FeatureService } from '../features/feature.service';
import { UpgradeService } from './upgrade.service';
import { EntitlementsService } from '../entitlements.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    MatListModule,
    MatChipsModule,
    MatProgressBarModule,
    LogoComponent
  ],
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.scss']
})
export class AppHeaderComponent implements OnInit, OnDestroy {
  @Input() pageTitle?: string;
  @Input() pageSubtitle?: string;
  @Input() showNavigation = true;
  @Input() showBackButton = false;
  @Input() backButtonRoute = '/dashboard';
  @Input() backButtonText = 'Back to Dashboard';
  
  currentUser: User | null = null;
  isAuthenticated = false;
  sidebarOpen = true; // Start with sidebar open
  isSuperuser = false;
  
  planTier: PlanTier | null = null;
  planContext$ = this.planService.planContext$;
  
  // Usage tracking
  usageInfo: {
    analyses: { used: number; limit: number; remaining: number };
    apiCalls: { used: number; limit: number; remaining: number };
    uploads: { used: number; limit: number; remaining: number };
  } | null = null;
  
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private planService: PlanService,
    private router: Router,
    private featureService: FeatureService,
    private upgradeService: UpgradeService,
    private entitlementsService: EntitlementsService
  ) {}

  ngOnInit() {
    // Initialize with current value synchronously to avoid flicker
    // Check localStorage directly for session token (more reliable than BehaviorSubject on initial load)
    const hasSessionToken = typeof window !== 'undefined' && window.localStorage 
      ? localStorage.getItem('sb-uqwcmkyaskyduxuluqrm-auth-token') !== null
      : false;
    
    // Also check sync method as fallback
    const isAuthSync = this.authService.isAuthenticatedSync && this.authService.isAuthenticatedSync();
    
    if (hasSessionToken || isAuthSync) {
      // Set authenticated immediately if session token exists, even if user object isn't loaded yet
      this.isAuthenticated = true;
      
      // Try to get current user value if accessible
      const currentUser = (this.authService as any).currentUserSubject?.value;
      if (currentUser) {
        this.currentUser = currentUser;
      }
      
      // Set up sidebar immediately if authenticated and navigation is enabled
      if (typeof document !== 'undefined' && this.showNavigation) {
        document.body.classList.add('has-sidebar');
        this.updateSidebarClass();
      }
    } else {
      // If not authenticated, ensure sidebar is hidden
      this.isAuthenticated = false;
      if (typeof document !== 'undefined') {
        document.body.classList.remove('has-sidebar', 'sidebar-collapsed');
      }
    }
    
    // Subscribe to user changes with debouncing and distinctUntilChanged to prevent flickering
    this.authService.currentUser$
      .pipe(
        distinctUntilChanged((prev, curr) => {
          // Consider it the same if both are null or both have the same id
          if (prev === null && curr === null) return true;
          if (prev?.id === curr?.id) return true;
          return false;
        }),
        debounceTime(50), // Small debounce to prevent rapid state changes
        takeUntil(this.destroy$)
      )
      .subscribe(user => {
        const wasAuthenticated = this.isAuthenticated;
        this.currentUser = user;
        
        // CRITICAL: Check localStorage directly for session token to avoid race conditions
        // This prevents sidebar from disappearing during page load/refresh when currentUser$ hasn't loaded yet
        const hasSessionToken = typeof window !== 'undefined' && window.localStorage 
          ? localStorage.getItem('sb-uqwcmkyaskyduxuluqrm-auth-token') !== null
          : false;
        
        // Use a more robust check: only set isAuthenticated to false if we're certain
        // Don't set to false on brief null emissions (which can happen during route changes or profile updates)
        if (user !== null) {
          this.isAuthenticated = true;
        } else {
          // If user is null, check if session token exists in localStorage
          // This handles the case where currentUser$ hasn't loaded yet but session exists
          if (hasSessionToken) {
            // Session exists in localStorage, keep authenticated state even if user object isn't loaded yet
            this.isAuthenticated = true;
          } else if (wasAuthenticated) {
            // Only set to false if we were previously authenticated AND no session token exists
            // This prevents flickering from temporary null emissions during profile updates
            this.isAuthenticated = false;
          }
          // If wasAuthenticated is false and no session token, keep isAuthenticated = false
        }
        
        // Always ensure sidebar visibility matches authentication and navigation state
        // Use session token check as the source of truth to prevent disappearing during load
        const shouldShowSidebar = (this.isAuthenticated || hasSessionToken) && this.showNavigation;
        if (typeof document !== 'undefined') {
          if (shouldShowSidebar) {
            if (!document.body.classList.contains('has-sidebar')) {
              document.body.classList.add('has-sidebar');
            }
            this.updateSidebarClass();
          } else {
            // Only remove sidebar if we're definitely not authenticated (no session token)
            if (!hasSessionToken) {
              document.body.classList.remove('has-sidebar', 'sidebar-collapsed');
            }
          }
        }
        
        // Load plan context when user is authenticated
        if (user) {
          this.planService.loadPlanContext();
          
          // Also load entitlements from cache immediately
          this.entitlementsService.loadFromCache();
          
          // Load entitlements if we have an org ID
          const activeOrgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
          if (activeOrgId) {
            this.entitlementsService.loadEntitlements(activeOrgId);
          }
        }
      });
    
    // Don't load plan context here if user subscription already loaded it
    // The user subscription above will handle loading when user is authenticated
    
    // Reload plan context on navigation to ensure it's fresh
    // This is especially important when navigating from admin page after switching orgs
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((event) => {
        // Check if we have an active org ID in localStorage (set by admin org switch)
        const activeOrgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
        if (activeOrgId && this.isAuthenticated) {
          console.log('[Header] Navigation detected, reloading plan context for org:', activeOrgId);
          // Clear and reload plan context to ensure it uses the active org
          // Use a small delay to ensure navigation is complete
          setTimeout(() => {
            this.planService.clearPlanContext();
            this.planService.loadPlanContext();
          }, 100);
        }
      });
    
    // Subscribe to plan context changes
    this.planContext$
      .pipe(takeUntil(this.destroy$))
      .subscribe(context => {
        const previousTier = this.planTier;
        const newTier = context?.tier ?? null;
        console.log('[Header] Plan context changed:', {
          previousTier,
          newTier,
          status: context?.status,
          hasContext: !!context,
          orgId: context ? 'loaded' : 'null'
        });
        this.planTier = newTier;
        
        // Force change detection if tier changed
        if (previousTier !== newTier) {
          console.log('[Header] Plan tier changed from', previousTier, 'to', newTier);
        }
        
        // Update usage info
        if (context) {
          const limits = context.limits;
          const remaining = context.remainingToday;
          
          // Calculate used amounts
          // Frontend PlanLimits uses analysisRunsPerDay, backend may use analysesPerDay
          const analysesLimit = (limits as any).analysisRunsPerDay ?? (limits as any).analysesPerDay ?? 0;
          const analysesRemaining = remaining.analysisRuns ?? 0;
          const analysesUsed = analysesLimit === -1 
            ? 0 
            : analysesLimit - analysesRemaining;
          const apiCallsUsed = limits.apiCallsPerDay === -1 
            ? 0 
            : limits.apiCallsPerDay - remaining.apiCalls;
          const uploadsUsed = limits.uploadsPerDay === -1 
            ? 0 
            : limits.uploadsPerDay - remaining.uploads;
          
          this.usageInfo = {
            analyses: {
              used: analysesUsed,
              limit: analysesLimit,
              remaining: analysesRemaining
            },
            apiCalls: {
              used: apiCallsUsed,
              limit: limits.apiCallsPerDay,
              remaining: remaining.apiCalls
            },
            uploads: {
              used: uploadsUsed,
              limit: limits.uploadsPerDay,
              remaining: remaining.uploads
            }
          };
        } else {
          this.usageInfo = null;
        }
      });

    // Subscribe to superuser status
    this.planService.isSuperuser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isSuperuser => {
        this.isSuperuser = isSuperuser;
      });
  }
  
  ngOnDestroy() {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('has-sidebar', 'sidebar-collapsed');
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  updateSidebarClass() {
    if (typeof document !== 'undefined') {
      if (this.sidebarOpen) {
        document.body.classList.remove('sidebar-collapsed');
      } else {
        document.body.classList.add('sidebar-collapsed');
      }
    }
  }

  signOut() {
    this.authService.signOut();
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    this.updateSidebarClass();
  }

  /**
   * Handle plan badge click
   */
  onPlanBadgeClick(): void {
    if (!this.planTier) return;
    
    // Use UpgradeService to show upgrade prompt or navigate
    switch (this.planTier) {
      case 'SANDBOX':
        this.router.navigate(['/account'], { queryParams: { upgrade: '1' } });
        break;
      case 'TEAM':
        this.router.navigate(['/account'], { queryParams: { manage: '1' } });
        break;
      case 'ENTERPRISE':
        // Could open contact modal or navigate to support
        window.open('mailto:support@protectqa.com?subject=Enterprise%20Support', '_blank');
        break;
    }
  }

  /**
   * Get plan tier display name
   */
  getPlanTierDisplay(): string {
    if (!this.planTier) return '';
    return this.planService.getPlanTierDisplay(this.planTier);
  }

  /**
   * Get plan tier color
   */
  getPlanTierColor(): string {
    if (!this.planTier) return '';
    return this.planService.getPlanTierColor(this.planTier);
  }

  /**
   * Get plan badge button text
   */
  getPlanBadgeText(): string {
    if (!this.planTier) return '';
    switch (this.planTier) {
      case 'SANDBOX':
        return 'Upgrade';
      case 'TEAM':
        return 'Manage Billing';
      case 'ENTERPRISE':
        return 'Contact Admin';
      default:
        return '';
    }
  }

  /**
   * Get primary usage metric for display (Evaluations/Analyses)
   */
  getPrimaryUsageDisplay(): string {
    if (!this.usageInfo) return '';
    
    const { used, limit, remaining } = this.usageInfo.analyses;
    
    if (limit === -1) {
      return `${used} Evaluations (Unlimited)`;
    }
    
    return `${used} of ${limit} Evaluations`;
  }

  /**
   * Get usage percentage for progress indicator
   */
  getUsagePercentage(): number {
    if (!this.usageInfo) return 0;
    
    const { used, limit } = this.usageInfo.analyses;
    if (limit === -1) return 0; // Unlimited
    
    return Math.min(100, (used / limit) * 100);
  }

  /**
   * Check if usage is near limit (>= 80%)
   */
  isUsageNearLimit(): boolean {
    if (!this.usageInfo) return false;
    
    const { used, limit } = this.usageInfo.analyses;
    if (limit === -1) return false; // Unlimited
    
    return (used / limit) >= 0.8;
  }

  /**
   * Check if usage is at limit
   */
  isUsageAtLimit(): boolean {
    if (!this.usageInfo) return false;
    
    const { remaining, limit } = this.usageInfo.analyses;
    if (limit === -1) return false; // Unlimited
    
    return remaining <= 0;
  }
}

