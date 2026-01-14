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
import { Router } from '@angular/router';
import { MatChipsModule } from '@angular/material/chips';
import { Subject } from 'rxjs';
import { takeUntil, distinctUntilChanged, debounceTime } from 'rxjs/operators';

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
  
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private planService: PlanService,
    private router: Router
  ) {}

  ngOnInit() {
    // Initialize with current value synchronously to avoid flicker
    // Check if user is authenticated using the sync method
    const isAuthSync = this.authService.isAuthenticatedSync && this.authService.isAuthenticatedSync();
    if (isAuthSync) {
      // Set authenticated immediately if sync check passes, even if user object isn't loaded yet
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
        
        // Use a more robust check: only set isAuthenticated to false if we're certain
        // Don't set to false on brief null emissions (which can happen during route changes or profile updates)
        if (user !== null) {
          this.isAuthenticated = true;
        } else {
          // Only set to false if we were previously authenticated and now we're definitely not
          // This prevents flickering from temporary null emissions during profile updates
          if (wasAuthenticated) {
            // Double-check with sync method before removing auth state
            // Don't change isAuthenticated if sync method says we're still authenticated
            // This handles cases where the observable emits null but session still exists
            if (this.authService.isAuthenticatedSync && !this.authService.isAuthenticatedSync()) {
              this.isAuthenticated = false;
            } else {
              // Keep isAuthenticated = true if sync check says we're still authenticated
              // This prevents sidebar from disappearing during profile updates
              this.isAuthenticated = true;
            }
          }
        }
        
        // Always ensure sidebar visibility matches authentication and navigation state
        // This handles both initial load and state changes
        if (typeof document !== 'undefined') {
          if (this.isAuthenticated && this.showNavigation) {
            if (!document.body.classList.contains('has-sidebar')) {
              document.body.classList.add('has-sidebar');
            }
            this.updateSidebarClass();
          } else {
            document.body.classList.remove('has-sidebar', 'sidebar-collapsed');
          }
        }
        
        // Load plan context when user is authenticated
        if (user) {
          this.planService.loadPlanContext();
        }
      });
    
    // Subscribe to plan context changes
    this.planContext$.subscribe(context => {
      this.planTier = context?.tier ?? null;
    });

    // Subscribe to superuser status
    this.planService.isSuperuser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isSuperuser => {
        this.isSuperuser = isSuperuser;
      });
  }
  
  ngOnDestroy() {
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
}

