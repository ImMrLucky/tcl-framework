import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { LogoComponent } from '../shared/logo.component';
import { AuthService, User } from '../auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    LogoComponent
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  isAuthenticated = false;
  currentUser: User | null = null;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    // Check if user is authenticated and redirect to dashboard
    const isAuth = await this.authService.isAuthenticated();
    if (isAuth) {
      console.log('[Home] User is authenticated, redirecting to dashboard');
      this.router.navigate(['/dashboard']);
      return;
    }

    // Subscribe to user changes (for UI updates)
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.isAuthenticated = user !== null;
      
      // If user becomes authenticated while on home page, redirect
      if (user !== null && this.router.url === '/home') {
        console.log('[Home] User logged in, redirecting to dashboard');
        this.router.navigate(['/dashboard']);
      }
    });
  }

  goToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  goToProfile() {
    this.router.navigate(['/profile']);
  }

  signOut() {
    this.authService.signOut();
  }
}
