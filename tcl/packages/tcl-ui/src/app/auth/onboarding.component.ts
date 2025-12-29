import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../auth.service';
import { LogoComponent } from '../shared/logo.component';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    LogoComponent
  ],
  template: `
    <div class="onboarding-container">
      <mat-card class="onboarding-card">
        <mat-card-header>
          <mat-card-title>Complete Your Profile</mat-card-title>
          <mat-card-subtitle>Help us customize your ProtectQA experience</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <form [formGroup]="onboardingForm" (ngSubmit)="onSubmit()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Company Role / Title</mat-label>
              <input matInput formControlName="companyRole" placeholder="e.g., QA Manager, Compliance Officer">
              <mat-icon matPrefix>badge</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Company Industry</mat-label>
              <mat-select formControlName="companyIndustry" required>
                <mat-option value="Financial Services / Banking">Financial Services / Banking</mat-option>
                <mat-option value="Insurance">Insurance</mat-option>
                <mat-option value="Healthcare">Healthcare</mat-option>
                <mat-option value="Telecommunications">Telecommunications</mat-option>
                <mat-option value="Retail / eCommerce">Retail / eCommerce</mat-option>
                <mat-option value="SaaS / Technology">SaaS / Technology</mat-option>
                <mat-option value="Travel / Hospitality">Travel / Hospitality</mat-option>
                <mat-option value="Utilities / Energy">Utilities / Energy</mat-option>
                <mat-option value="Government / Public Sector">Government / Public Sector</mat-option>
                <mat-option value="Other">Other</mat-option>
              </mat-select>
              <mat-icon matPrefix>business</mat-icon>
              <mat-error *ngIf="onboardingForm.get('companyIndustry')?.hasError('required')">
                Industry is required
              </mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>How do your calls operate?</mat-label>
              <mat-select formControlName="callOperation" required>
                <mat-option value="Inbound">Inbound</mat-option>
                <mat-option value="Outbound">Outbound</mat-option>
                <mat-option value="Both">Both</mat-option>
              </mat-select>
              <mat-icon matPrefix>phone</mat-icon>
              <mat-error *ngIf="onboardingForm.get('callOperation')?.hasError('required')">
                Call operation is required
              </mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Primary Use Case</mat-label>
              <mat-select formControlName="primaryUseCase" required>
                <mat-option value="Compliance / Risk Detection">Compliance / Risk Detection</mat-option>
                <mat-option value="QA Scoring & Audits">QA Scoring & Audits</mat-option>
                <mat-option value="Dispute Defense">Dispute Defense</mat-option>
                <mat-option value="Regulatory Readiness">Regulatory Readiness</mat-option>
                <mat-option value="Policy Drift Detection">Policy Drift Detection</mat-option>
                <mat-option value="Executive Reporting">Executive Reporting</mat-option>
              </mat-select>
              <mat-icon matPrefix>target</mat-icon>
              <mat-error *ngIf="onboardingForm.get('primaryUseCase')?.hasError('required')">
                Primary use case is required
              </mat-error>
            </mat-form-field>

            <div *ngIf="errorMessage" class="error-message">
              <mat-icon>error</mat-icon>
              {{ errorMessage }}
            </div>

            <button 
              mat-raised-button 
              color="primary" 
              type="submit" 
              class="full-width submit-button"
              [disabled]="onboardingForm.invalid || loading">
              <mat-spinner *ngIf="loading" diameter="20" class="inline-spinner"></mat-spinner>
              <span *ngIf="!loading">Continue</span>
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .onboarding-container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }

    .logo-wrapper {
      margin-bottom: 40px;
    }

    .onboarding-card {
      width: 100%;
      max-width: 500px;
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
export class OnboardingComponent implements OnInit {
  onboardingForm: FormGroup;
  loading = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.onboardingForm = this.fb.group({
      companyRole: [''],
      companyIndustry: ['', Validators.required],
      callOperation: ['', Validators.required],
      primaryUseCase: ['', Validators.required]
    });
  }

  async ngOnInit() {
    // Check if user is authenticated
    const isAuth = await this.authService.isAuthenticated();
    if (!isAuth) {
      this.router.navigate(['/login']);
      return;
    }

    // Pre-fill form if user already has some data
    const user = this.authService.getCurrentUser();
    if (user) {
      this.onboardingForm.patchValue({
        companyRole: user.companyRole || '',
        companyIndustry: user.companyIndustry || '',
        callOperation: user.callOperation || '',
        primaryUseCase: user.primaryUseCase || ''
      });
    }
  }

  async onSubmit() {
    if (this.onboardingForm.invalid) return;

    this.loading = true;
    this.errorMessage = '';

    try {
      const result = await this.authService.updateProfile(this.onboardingForm.value);
      
      if (result.error) {
        this.errorMessage = result.error.message || 'Failed to update profile';
      } else {
        this.router.navigate(['/dashboard']);
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'An unexpected error occurred';
    } finally {
      this.loading = false;
    }
  }
}

