import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../auth.service';
import { LogoComponent } from '../shared/logo.component';
import type { AuthError } from '@supabase/supabase-js';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    LogoComponent
  ],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <mat-card-title>ProtectQA</mat-card-title>
          <mat-card-subtitle>{{ isSignUp ? 'Create Account' : 'Sign In' }}</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <form [formGroup]="authForm" (ngSubmit)="onSubmit()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Email</mat-label>
              <input matInput type="email" formControlName="email" required>
              <mat-icon matPrefix>email</mat-icon>
              <mat-error *ngIf="authForm.get('email')?.hasError('required')">
                Email is required
              </mat-error>
              <mat-error *ngIf="authForm.get('email')?.hasError('email')">
                Invalid email format
              </mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Password</mat-label>
              <input matInput [type]="hidePassword ? 'password' : 'text'" formControlName="password" required>
              <mat-icon matPrefix>lock</mat-icon>
              <button mat-icon-button matSuffix (click)="hidePassword = !hidePassword" type="button">
                <mat-icon>{{ hidePassword ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              <mat-error *ngIf="authForm.get('password')?.hasError('required')">
                Password is required
              </mat-error>
              <mat-error *ngIf="authForm.get('password')?.hasError('minlength')">
                Password must be at least 6 characters
              </mat-error>
            </mat-form-field>

            <div *ngIf="successMessage" class="success-message">
              <mat-icon>check_circle</mat-icon>
              {{ successMessage }}
            </div>

            <div *ngIf="errorMessage" class="error-message">
              <mat-icon>error</mat-icon>
              {{ errorMessage }}
            </div>

            <button 
              mat-raised-button 
              color="primary" 
              type="submit" 
              class="full-width submit-button"
              [disabled]="authForm.invalid || loading">
              <mat-spinner *ngIf="loading" diameter="20" class="inline-spinner"></mat-spinner>
              <span *ngIf="!loading">{{ isSignUp ? 'Sign Up' : 'Sign In' }}</span>
            </button>
          </form>

          <div class="switch-mode">
            <button mat-button type="button" (click)="toggleMode()">
              {{ isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up" }}
            </button>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      padding: 20px;
    }

    .login-card {
      width: 100%;
      max-width: 400px;
      padding: 24px;
    }

    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    .submit-button {
      margin-top: 8px;
      height: 48px;
    }

    .inline-spinner {
      display: inline-block;
      margin-right: 8px;
    }

    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #f44336;
      margin-bottom: 16px;
      padding: 12px;
      background: #ffebee;
      border-radius: 4px;
      font-size: 14px;
    }

    .success-message {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #2e7d32;
      margin-bottom: 16px;
      padding: 12px;
      background: #e8f5e9;
      border-radius: 4px;
      font-size: 14px;
    }

    .switch-mode {
      text-align: center;
      margin-top: 24px;
    }

    mat-card-header {
      text-align: center;
      margin-bottom: 24px;
    }

    mat-card-title {
      font-size: 28px;
      font-weight: 600;
      color: #1976d2;
    }
  `]
})
export class LoginComponent {
  authForm: FormGroup;
  isSignUp = false;
  hidePassword = true;
  loading = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.authForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  toggleMode() {
    this.isSignUp = !this.isSignUp;
    this.errorMessage = '';
    this.successMessage = '';
    this.authForm.reset();
  }

  async onSubmit() {
    if (this.authForm.invalid) return;

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const { email, password } = this.authForm.value;

    try {
      let result: { error: AuthError | null; duplicateAccount?: boolean };
      if (this.isSignUp) {
        result = await this.authService.signUp(email, password);
      } else {
        result = await this.authService.signIn(email, password);
      }

      if (result.error) {
        // Handle email confirmation required (not really an error)
        if ((result.error as any).name === 'EmailConfirmationRequired') {
          this.successMessage = result.error.message || 'Please check your email to confirm your account.';
          this.errorMessage = '';
          // Switch to login mode after showing the message
          this.isSignUp = false;
        }
        // Handle duplicate account case
        else if (result.duplicateAccount) {
          this.errorMessage = result.error.message || 'An account with this email already exists.';
          // Show option to go to login or reset password
          setTimeout(() => {
            if (confirm('Would you like to sign in instead? Click OK to sign in, or Cancel to reset your password.')) {
              this.isSignUp = false;
              this.errorMessage = '';
              this.authForm.patchValue({ email, password: '' });
            } else {
              // Redirect to password reset
              this.router.navigate(['/login'], { 
                queryParams: { 
                  resetPassword: 'true',
                  email: email 
                } 
              });
            }
          }, 100);
        } else {
          this.errorMessage = result.error.message || 'Authentication failed';
        }
      } else {
        // Success! Redirect to dashboard
        this.router.navigate(['/dashboard']);
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'An unexpected error occurred';
    } finally {
      this.loading = false;
    }
  }
}

