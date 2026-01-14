import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-onboarding-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './onboarding-modal.component.html',
  styleUrls: ['./onboarding-modal.component.scss']
})
export class OnboardingModalComponent implements OnInit {
  onboardingForm: FormGroup;
  loading = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private dialogRef: MatDialogRef<OnboardingModalComponent>
  ) {
    this.onboardingForm = this.fb.group({
      companyRole: [''],
      companyIndustry: ['', Validators.required],
      callOperation: ['', Validators.required],
      primaryUseCase: ['', Validators.required]
    });
  }

  ngOnInit() {
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

  async onDismiss() {
    // Mark onboarding as completed even if dismissed
    // This prevents the modal from showing again
    this.loading = true;
    try {
      // Close the dialog immediately, then update in the background
      // This prevents the modal from blocking and ensures it closes
      this.dialogRef.close(false);
      
      // Update onboarding status in the background
      const result = await this.authService.markOnboardingCompleted();
      if (result.error) {
        console.error('Error marking onboarding as completed:', result.error);
        // Error is logged but modal is already closed
      }
    } catch (err) {
      console.error('Error marking onboarding as completed:', err);
      // Error is logged but modal is already closed
    } finally {
      this.loading = false;
    }
  }

  async onSubmit() {
    if (this.onboardingForm.invalid) return;

    this.loading = true;
    this.errorMessage = '';

    try {
      // Update profile and mark onboarding as completed
      const result = await this.authService.updateProfile({
        ...this.onboardingForm.value,
        onboardingCompleted: true
      });
      
      if (result.error) {
        this.errorMessage = result.error.message || 'Failed to update profile';
      } else {
        // Close modal with success
        this.dialogRef.close(true);
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'An unexpected error occurred';
    } finally {
      this.loading = false;
    }
  }
}

