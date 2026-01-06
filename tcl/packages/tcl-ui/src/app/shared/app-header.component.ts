import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { LogoComponent } from './logo.component';
import { AuthService, User } from '../auth.service';

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
    MatSidenavModule,
    MatListModule,
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

  constructor(private authService: AuthService) {}

  ngOnInit() {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.isAuthenticated = user !== null;
    });
  }

  signOut() {
    this.authService.signOut();
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }
}

