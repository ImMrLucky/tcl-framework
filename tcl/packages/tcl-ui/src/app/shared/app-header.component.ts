import { Component, OnInit, Input } from '@angular/core';
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
export class AppHeaderComponent implements OnInit {
  @Input() pageTitle?: string;
  @Input() pageSubtitle?: string;
  @Input() showNavigation = true;
  @Input() showBackButton = false;
  @Input() backButtonRoute = '/dashboard';
  @Input() backButtonText = 'Back to Dashboard';
  
  currentUser: User | null = null;
  isAuthenticated = false;
  sidebarOpen = true; // Start with sidebar open
  
  planTier: PlanTier | null = null;
  planContext$ = this.planService.planContext$;

  constructor(
    private authService: AuthService,
    private planService: PlanService,
    private router: Router
  ) {}

  ngOnInit() {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.isAuthenticated = user !== null;
      
      // Add/remove body class for sidebar
      if (typeof document !== 'undefined') {
        if (this.isAuthenticated && this.showNavigation) {
          document.body.classList.add('has-sidebar');
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

