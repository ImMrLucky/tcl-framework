import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { LogoComponent } from '../shared/logo.component';
import { AuthService, User } from '../auth.service';
import { MemberService } from '../member.service';

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
    private memberService: MemberService
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
      }
    });
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
}

