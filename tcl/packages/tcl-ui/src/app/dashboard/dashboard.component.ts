import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LogoComponent } from '../shared/logo.component';
import { AuthService, User } from '../auth.service';
import { MemberService } from '../member.service';
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
    LogoComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  currentUser: User | null = null;
  userOrgs: Array<{ id: string; name: string; slug: string; role: string }> = [];

  constructor(
    private authService: AuthService,
    private memberService: MemberService,
    private dialog: MatDialog
  ) {}

  async ngOnInit() {
    // Check authentication first
    const isAuth = await this.authService.isAuthenticated();
    if (!isAuth) {
      console.log('Not authenticated, redirecting to home');
      // Will be handled by router guard if we add one
      return;
    }

    // Subscribe to user changes
    this.authService.currentUser$.subscribe(user => {
      console.log('Dashboard: User changed:', user?.email);
      this.currentUser = user;
      if (!user) {
        console.log('Dashboard: User is null, but session exists - this might be a profile loading issue');
      } else if (user.id) {
        this.loadUserOrgs(user.id);
        // Check if user needs onboarding (show modal if onboarding not completed)
        this.checkAndShowOnboarding(user);
      }
    });
  }

  checkAndShowOnboarding(user: User) {
    // Only show onboarding modal if:
    // 1. User hasn't completed onboarding (onboardingCompleted === false)
    // 2. User hasn't filled in required fields
    const hasCompletedOnboarding = user.onboardingCompleted === true;
    const needsOnboarding = !user.companyIndustry || !user.callOperation || !user.primaryUseCase;
    
    // Don't show if already completed or if user has all required fields
    if (hasCompletedOnboarding || !needsOnboarding) {
      return;
    }
    
    // Show modal for new users who haven't completed onboarding
    setTimeout(() => {
      const dialogRef = this.dialog.open(OnboardingModalComponent, {
        width: '600px',
        disableClose: false, // Allow closing by clicking outside or ESC
        autoFocus: true
      });

      dialogRef.afterClosed().subscribe((result: boolean) => {
        if (result) {
          // User completed onboarding, refresh user data
          const currentUser = this.authService.getCurrentUser();
          if (currentUser) {
            this.currentUser = currentUser;
          }
        }
        // If result is false, user dismissed - onboarding_completed is already set to true
      });
    }, 500);
  }

  loadUserOrgs(userId: string) {
    this.memberService.getUserOrgs(userId).subscribe({
      next: (response) => {
        this.userOrgs = response.orgs || [];
      },
      error: (err: any) => {
        console.error('Failed to load user orgs:', err);
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
    const dialogRef = this.dialog.open(InviteModalComponent, {
      width: '700px',
      disableClose: false,
      autoFocus: true
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

