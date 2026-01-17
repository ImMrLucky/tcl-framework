import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService, User } from '../auth.service';
import { LogoComponent } from '../shared/logo.component';
import { PermissionService, Permission } from '../permissions/permission.service';
import { FeatureService } from '../features/feature.service';
import { filter } from 'rxjs/operators';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  permission?: string; // Can be Permission (role-based) or FeatureKey (capability/entitlement)
  adminOnly?: boolean; // Legacy: use permission instead
}

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    LogoComponent
  ],
  template: `
    <mat-sidenav-container class="layout-container">
      <mat-sidenav 
        #sidenav 
        mode="side" 
        [opened]="!isMobile || sidebarOpen"
        [mode]="isMobile ? 'over' : 'side'"
        class="sidebar"
        [class.collapsed]="collapsed && !isMobile">
        <div class="sidebar-header">
          <div *ngIf="!collapsed || isMobile" class="logo-section">
            <app-logo></app-logo>
          </div>
          <button mat-icon-button (click)="toggleCollapse()" class="collapse-button" *ngIf="!isMobile">
            <mat-icon>{{ collapsed ? 'chevron_right' : 'chevron_left' }}</mat-icon>
          </button>
          <button mat-icon-button (click)="closeSidebar()" class="close-button" *ngIf="isMobile">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        
        <mat-nav-list class="nav-list">
          <a 
            *ngFor="let item of visibleNavItems" 
            mat-list-item 
            [routerLink]="item.route"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{exact: false}"
            [matTooltip]="(collapsed && !isMobile) ? item.label : ''"
            [class.collapsed-item]="collapsed && !isMobile"
            (click)="isMobile && closeSidebar()">
            <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
            <span *ngIf="!collapsed || isMobile" matListItemTitle>{{ item.label }}</span>
          </a>
        </mat-nav-list>
        
        <div class="sidebar-footer" *ngIf="(!collapsed || isMobile) && currentUser">
          <div class="user-info">
            <button mat-icon-button [matMenuTriggerFor]="userMenu">
              <mat-icon>account_circle</mat-icon>
            </button>
            <div *ngIf="!collapsed || isMobile" class="user-details">
              <div class="user-email">{{ currentUser.email }}</div>
              <div class="user-role" *ngIf="currentUser.companyRole">{{ currentUser.companyRole }}</div>
            </div>
          </div>
          <mat-menu #userMenu="matMenu">
            <button mat-menu-item routerLink="/profile">
              <mat-icon>settings</mat-icon>
              <span>Profile Settings</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="signOut()">
              <mat-icon>logout</mat-icon>
              <span>Sign Out</span>
            </button>
          </mat-menu>
        </div>
      </mat-sidenav>
      
      <mat-sidenav-content class="main-content">
        <div class="top-bar" *ngIf="isMobile">
          <button mat-icon-button (click)="openSidebar()">
            <mat-icon>menu</mat-icon>
          </button>
          <app-logo></app-logo>
        </div>
        <ng-content></ng-content>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .layout-container {
      height: 100vh;
      display: flex;
    }
    
    .sidebar {
      width: 240px;
      transition: width 0.3s ease;
      background: #fff;
      box-shadow: 2px 0 4px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
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
      min-height: 64px;
    }
    
    .logo-section {
      flex: 1;
    }
    
    .collapse-button,
    .close-button {
      margin-left: auto;
    }
    
    .nav-list {
      padding: 8px 0;
      flex: 1;
      overflow-y: auto;
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
      padding-left: 0;
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
      flex: 1;
      overflow-y: auto;
      background: #f5f5f5;
    }
    
    .top-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 16px;
      background: #fff;
      border-bottom: 1px solid #e0e0e0;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    
    @media (max-width: 768px) {
      .sidebar {
        width: 240px;
      }
      
      .sidebar.collapsed {
        width: 240px;
      }
    }
  `]
})
export class MainLayoutComponent implements OnInit {
  collapsed = false;
  sidebarOpen = false;
  isMobile = false;
  currentUser: User | null = null;
  isAdmin = false;
  currentRoute = '';
  
  navItems: NavItem[] = [
    { label: 'Issues (Triage)', route: '/issues', icon: 'assignment', permission: 'view_issues' },
    { label: 'Compliance Dashboard', route: '/compliance', icon: 'dashboard', permission: 'view_evaluations' },
    { label: 'Evaluations', route: '/evaluations', icon: 'assessment', permission: 'view_evaluations' },
    { label: 'Audit Packs', route: '/audit-packs', icon: 'folder', permission: 'view_audit_packs' },
    { label: 'Policies', route: '/policies', icon: 'description', permission: 'view_evidence' },
    { label: 'Evidence', route: '/evidence', icon: 'verified', permission: 'view_evidence' },
    { label: 'Cases', route: '/cases', icon: 'folder_special', permission: 'view_cases' },
    { label: 'Integrations', route: '/integrations', icon: 'link', permission: 'view_integrations' },
    { label: 'Bulk Ingestion', route: '/bulk-ingest', icon: 'upload_file', permission: 'batchIngestion' },
    { label: 'Admin → Scoring', route: '/admin/scoring', icon: 'tune', adminOnly: true },
  ];

  constructor(
    private authService: AuthService,
    private router: Router,
    private permissionService: PermissionService,
    private featureService: FeatureService
  ) {}

  ngOnInit() {
    // Check if mobile
    this.isMobile = window.innerWidth < 768;
    window.addEventListener('resize', () => {
      this.isMobile = window.innerWidth < 768;
    });

    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      // Check if user is admin based on role
      this.permissionService.currentRole.subscribe(role => {
        this.isAdmin = role === 'ADMIN' || role === 'OWNER';
      });
    });
    
    // Track current route
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        this.currentRoute = event.url;
      });
  }

  toggleCollapse() {
    if (!this.isMobile) {
      this.collapsed = !this.collapsed;
    }
  }

  openSidebar() {
    this.sidebarOpen = true;
  }

  closeSidebar() {
    this.sidebarOpen = false;
  }

  signOut() {
    this.authService.signOut();
  }

  get visibleNavItems(): NavItem[] {
    return this.navItems.filter(item => {
      // Legacy adminOnly check
      if (item.adminOnly && !this.isAdmin) {
        return false;
      }
      
      // Permission-based check (for role-based permissions like view_issues, create_cases)
      if (item.permission) {
        // Check if it's a role-based permission (starts with view_, create_, etc.)
        if (item.permission.startsWith('view_') || item.permission.startsWith('create_') || 
            item.permission.startsWith('update_') || item.permission.startsWith('delete_') ||
            item.permission.startsWith('manage_') || item.permission.startsWith('export_')) {
          if (!this.permissionService.hasPermission(item.permission as Permission)) {
            return false;
          }
        } else {
          // Check if it's a feature (capability or entitlement)
          // Try as feature key first
          if (!this.featureService.hasFeature(item.permission as any)) {
            return false;
          }
        }
      }
      
      return true;
    });
  }
}

