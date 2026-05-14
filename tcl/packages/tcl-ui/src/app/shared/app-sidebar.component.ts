import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService, User } from '../auth.service';
import { LogoComponent } from './logo.component';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  adminOnly?: boolean;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    LogoComponent
  ],
  template: `
    <mat-sidenav-container class="sidebar-container">
      <mat-sidenav 
        #sidenav 
        mode="side" 
        opened="true"
        class="sidebar"
        [class.collapsed]="collapsed">
        <div class="sidebar-header">
          <app-logo *ngIf="!collapsed"></app-logo>
          <button mat-icon-button (click)="toggleCollapse()" class="collapse-button">
            <mat-icon>{{ collapsed ? 'chevron_right' : 'chevron_left' }}</mat-icon>
          </button>
        </div>
        
        <mat-nav-list class="nav-list">
          <a 
            *ngFor="let item of visibleNavItems" 
            mat-list-item 
            [routerLink]="item.route"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{exact: false}"
            [matTooltip]="collapsed ? item.label : ''"
            [class.collapsed-item]="collapsed">
            <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
            <span *ngIf="!collapsed" matListItemTitle>{{ item.label }}</span>
          </a>
        </mat-nav-list>
        
        <div class="sidebar-footer" *ngIf="!collapsed && currentUser">
          <div class="user-info">
            <mat-icon>account_circle</mat-icon>
            <div class="user-details">
              <div class="user-email">{{ currentUser.email }}</div>
              <div class="user-role" *ngIf="currentUser.companyRole">{{ currentUser.companyRole }}</div>
            </div>
          </div>
        </div>
      </mat-sidenav>
      
      <mat-sidenav-content class="main-content">
        <ng-content></ng-content>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .sidebar-container {
      height: 100vh;
    }
    
    .sidebar {
      width: 240px;
      transition: width 0.3s ease;
      background: #fff;
      box-shadow: 2px 0 4px rgba(0,0,0,0.1);
    }
    
    .sidebar.collapsed {
      width: 64px;
    }
    
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .collapse-button {
      margin-left: auto;
    }
    
    .nav-list {
      padding: 8px 0;
      flex: 1;
    }
    
    .nav-list a {
      color: #666;
      text-decoration: none;
      transition: background 0.2s;
    }
    
    .nav-list a:hover {
      background: rgba(0, 0, 0, 0.04);
    }
    
    .nav-list a.active {
      background: #e3f2fd;
      color: #1976d2;
      border-left: 4px solid #1976d2;
    }
    
    .nav-list a.collapsed-item {
      justify-content: center;
    }
    
    .sidebar-footer {
      padding: 16px;
      border-top: 1px solid #e0e0e0;
      margin-top: auto;
    }
    
    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .user-info mat-icon {
      color: #666;
    }
    
    .user-details {
      flex: 1;
      min-width: 0;
    }
    
    .user-email {
      font-size: 14px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .user-role {
      font-size: 12px;
      color: #666;
    }
    
    .main-content {
      padding: 0;
      background: #f5f5f5;
    }
    
    @media (max-width: 768px) {
      .sidebar {
        width: 64px;
      }
      
      .sidebar:not(.collapsed) {
        width: 240px;
        position: fixed;
        z-index: 1000;
      }
    }
  `]
})
export class AppSidebarComponent implements OnInit {
  collapsed = false;
  currentUser: User | null = null;
  isAdmin = false;
  
  navItems: NavItem[] = [
    { label: 'Issues (Triage)', route: '/issues', icon: 'assignment' },
    { label: 'Compliance Dashboard', route: '/compliance', icon: 'dashboard' },
    { label: 'Evaluations', route: '/evaluations', icon: 'assessment' },
    { label: 'Audit Packs', route: '/audit-packs', icon: 'folder' },
    { label: 'Policies', route: '/policies', icon: 'description' },
    { label: 'Evidence', route: '/evidence', icon: 'verified' },
    { label: 'Agent Studio', route: '/agent-studio', icon: 'smart_toy' },
    { label: 'Scoring', route: '/admin/scoring', icon: 'tune', adminOnly: true },
  ];

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      // Check if user is admin (you may need to add role checking to AuthService)
      // For now, we'll show admin items to all authenticated users
      this.isAdmin = true; // TODO: Check actual role
    });
    
    // Auto-collapse on mobile
    if (window.innerWidth < 768) {
      this.collapsed = true;
    }
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
  }

  get visibleNavItems(): NavItem[] {
    return this.navItems.filter(item => {
      if (item.adminOnly && !this.isAdmin) {
        return false;
      }
      return true;
    });
  }
}

