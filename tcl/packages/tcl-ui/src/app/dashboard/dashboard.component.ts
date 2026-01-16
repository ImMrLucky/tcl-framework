import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuthService, User } from '../auth.service';
import { MemberService } from '../member.service';
import { PlanService } from '../plan.service';
import { OnboardingModalComponent } from '../onboarding-modal/onboarding-modal.component';
import { InviteModalComponent } from '../invite-modal/invite-modal.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    MatDialogModule,
    AppHeaderComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  currentUser: User | null = null;
  userOrgs: Array<{ id: string; name: string; slug: string; role: string }> = [];
  canInviteMembers: boolean = false;
  primaryOrgId: string = '';
  private onboardingModalShown = false; // Track if modal has been shown to prevent duplicates

  constructor(
    private authService: AuthService,
    private memberService: MemberService,
    private planService: PlanService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  async ngOnInit() {
    // Check authentication first
    const isAuth = await this.authService.isAuthenticated();
    if (!isAuth) {
      console.log('Not authenticated, redirecting to login');
      this.router.navigate(['/login']);
      return;
    }

    // Clear and reload plan context to ensure it uses the active org from localStorage
    // This is important when navigating from admin page after switching orgs
    this.planService.clearPlanContext();
    this.planService.loadPlanContext();

    // Subscribe to user changes
    this.authService.currentUser$.subscribe(user => {
      console.log('Dashboard: User changed:', user?.email);
      this.currentUser = user;
      if (user?.id) {
        this.loadUserOrgs(user.id);
        // Check if user needs onboarding (show modal if onboarding not completed)
        this.checkAndShowOnboarding(user);
      }
    });
  }

  checkAndShowOnboarding(user: User) {
    // Don't show if we've already shown the modal in this session
    if (this.onboardingModalShown) {
      return;
    }
    
    // Only show onboarding modal if:
    // 1. User hasn't completed onboarding (onboardingCompleted === false)
    // 2. User hasn't filled in required fields
    const hasCompletedOnboarding = user.onboardingCompleted === true;
    const needsOnboarding = !user.companyIndustry || !user.callOperation || !user.primaryUseCase;
    
    // Don't show if already completed or if user has all required fields
    if (hasCompletedOnboarding || !needsOnboarding) {
      return;
    }
    
    // Mark that we're showing the modal to prevent duplicates
    this.onboardingModalShown = true;
    
    // Show modal for new users who haven't completed onboarding
    setTimeout(() => {
      const dialogRef = this.dialog.open(OnboardingModalComponent, {
        width: '600px',
        disableClose: false, // Allow closing by clicking outside or ESC
        autoFocus: true
      });

      dialogRef.afterClosed().subscribe(async (result: boolean) => {
        // Always refresh user data after modal closes (whether dismissed or submitted)
        // The auth service's updateProfile/markOnboardingCompleted already calls loadUserProfile
        // which updates the currentUser$ observable, so the subscription above should handle it.
        // However, we add a small delay to ensure the profile update has completed and the
        // observable has emitted the new value before we check again.
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Get the updated user (should be updated via the currentUser$ subscription)
        const updatedUser = this.authService.getCurrentUser();
        if (updatedUser) {
          this.currentUser = updatedUser;
          // If onboarding is now completed, we can reset the flag for future sessions
          // but for this session, we keep it true to prevent showing again
          if (updatedUser.onboardingCompleted) {
            // User has completed onboarding, modal won't show again
            this.onboardingModalShown = true;
          }
        }
      });
    }, 500);
  }

  loadUserOrgs(userId: string) {
    this.memberService.getUserOrgs(userId).subscribe({
      next: (response) => {
        this.userOrgs = response.orgs || [];
        
        // Find primary org (where user is owner) or first org where they can manage members
        const ownerOrg = this.userOrgs.find(org => org.role === 'owner');
        const adminOrg = this.userOrgs.find(org => org.role === 'admin');
        
        // Primary org is the one they own, or first admin org, or first org
        this.primaryOrgId = ownerOrg?.id || adminOrg?.id || (this.userOrgs.length > 0 ? this.userOrgs[0].id : '');
        
        // User can invite if they're owner or admin in at least one org
        this.canInviteMembers = this.userOrgs.some(org => org.role === 'owner' || org.role === 'admin');
      },
      error: (err: any) => {
        console.error('Failed to load user orgs:', err);
        this.canInviteMembers = false;
        this.primaryOrgId = '';
      }
    });
  }

  getFirstOrgId(): string {
    return this.userOrgs.length > 0 ? this.userOrgs[0].id : '';
  }

  signOut() {
    this.authService.signOut();
  }

  openInviteModal() {
    if (!this.canInviteMembers || !this.primaryOrgId) {
      console.warn('User does not have permission to invite members');
      return;
    }

    // Only pass orgs where user can manage members (owner or admin)
    const manageableOrgs = this.userOrgs.filter(org => org.role === 'owner' || org.role === 'admin');
    
    const dialogRef = this.dialog.open(InviteModalComponent, {
      width: '700px',
      disableClose: false,
      autoFocus: true,
      data: {
        orgId: this.primaryOrgId,
        orgs: manageableOrgs
      } as any
    });

    dialogRef.afterClosed().subscribe((result: boolean) => {
      if (result) {
        // Refresh user orgs if needed
        const currentUser = this.authService.getCurrentUser();
        if (currentUser) {
          this.loadUserOrgs(currentUser.id);
        }
      }
    });
  }
}

