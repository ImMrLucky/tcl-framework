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
  template: `
    <header>
      <div class="container">
        <div class="header-content">
          <app-logo></app-logo>
          <div class="header-actions">
            <button mat-button routerLink="/call-center-qa">
              <mat-icon>phone</mat-icon>
              Call Center QA
            </button>
            <button mat-button routerLink="/original-qa">
              <mat-icon>description</mat-icon>
              Original QA
            </button>
            <button mat-icon-button [matMenuTriggerFor]="userMenu">
              <mat-icon>account_circle</mat-icon>
            </button>
            <mat-menu #userMenu="matMenu">
              <div class="user-menu-header">
                <div class="user-email">{{ currentUser?.email }}</div>
                <div class="user-role" *ngIf="currentUser?.companyRole">{{ currentUser?.companyRole }}</div>
              </div>
              <mat-divider></mat-divider>
              <button mat-menu-item routerLink="/onboarding">
                <mat-icon>settings</mat-icon>
                <span>Profile Settings</span>
              </button>
              <button mat-menu-item (click)="signOut()">
                <mat-icon>logout</mat-icon>
                <span>Sign Out</span>
              </button>
            </mat-menu>
          </div>
        </div>
      </div>
    </header>

    <div class="dashboard-container">
      <div class="container">
        <div class="welcome-section">
          <h1>Welcome to ProtectQA</h1>
          <p class="welcome-subtitle">Choose how you'd like to get started</p>
        </div>

        <div class="dashboard-grid">
          <mat-card class="dashboard-card" routerLink="/call-center-qa">
            <mat-card-header>
              <mat-icon class="card-icon">phone</mat-icon>
              <mat-card-title>Call Center QA</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p>Analyze call transcripts for compliance, risk detection, and policy adherence.</p>
            </mat-card-content>
            <mat-card-actions>
              <button mat-button color="primary">Get Started</button>
            </mat-card-actions>
          </mat-card>

          <mat-card class="dashboard-card" routerLink="/original-qa">
            <mat-card-header>
              <mat-icon class="card-icon">description</mat-icon>
              <mat-card-title>Original QA</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p>Validate question-answer pairs with evidence sources and custom rules.</p>
            </mat-card-content>
            <mat-card-actions>
              <button mat-button color="primary">Get Started</button>
            </mat-card-actions>
          </mat-card>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dashboard-container {
      min-height: calc(100vh - 80px);
      padding: 60px 0;
    }

    .welcome-section {
      text-align: center;
      margin-bottom: 60px;
    }

    .welcome-section h1 {
      font-size: 48px;
      font-weight: 700;
      margin-bottom: 16px;
      color: #1a1a1a;
    }

    .welcome-subtitle {
      font-size: 20px;
      color: #475569;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 32px;
      max-width: 800px;
      margin: 0 auto;
    }

    .dashboard-card {
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .dashboard-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
    }

    .card-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #3b82f6;
      margin-bottom: 16px;
    }

    mat-card-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 24px 24px 0;
    }

    mat-card-title {
      font-size: 24px;
      font-weight: 600;
    }

    mat-card-content {
      flex: 1;
      padding: 16px 24px;
    }

    mat-card-content p {
      color: #475569;
      line-height: 1.6;
    }

    mat-card-actions {
      padding: 16px 24px 24px;
      display: flex;
      justify-content: center;
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .user-menu-header {
      padding: 16px;
      min-width: 200px;
    }

    .user-email {
      font-weight: 500;
      margin-bottom: 4px;
    }

    .user-role {
      font-size: 0.875rem;
      color: #666;
    }
  `]
})
export class DashboardComponent implements OnInit {
  currentUser: User | null = null;

  constructor(private authService: AuthService) {}

  ngOnInit() {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (!user) {
        // Redirect to home if not authenticated
        // This will be handled by auth guard if we add one
      }
    });
  }

  signOut() {
    this.authService.signOut();
  }
}

