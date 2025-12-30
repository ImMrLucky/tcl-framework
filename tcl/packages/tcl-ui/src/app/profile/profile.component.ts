import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../auth.service';
import { LogoComponent } from '../shared/logo.component';
import { InviteModalComponent } from '../invite-modal/invite-modal.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    LogoComponent
  ],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit {
  profileForm: FormGroup;
  loading = false;
  errorMessage = '';
  currentUser: any = null;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {
    this.profileForm = this.fb.group({
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

    // Subscribe to user changes
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.profileForm.patchValue({
          companyRole: user.companyRole || '',
          companyIndustry: user.companyIndustry || '',
          callOperation: user.callOperation || '',
          primaryUseCase: user.primaryUseCase || ''
        });
      }
    });
  }

  async onSubmit() {
    if (this.profileForm.invalid) return;

    this.loading = true;
    this.errorMessage = '';

    try {
      // Update profile and mark onboarding as completed
      const result = await this.authService.updateProfile({
        ...this.profileForm.value,
        onboardingCompleted: true
      });
      
      if (result.error) {
        this.errorMessage = result.error.message || 'Failed to update profile';
      } else {
        this.snackBar.open('Profile updated successfully', 'Close', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'top'
        });
        // Optionally navigate back to dashboard
        setTimeout(() => {
          this.router.navigate(['/dashboard']);
        }, 1500);
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'An unexpected error occurred';
    } finally {
      this.loading = false;
    }
  }

  onCancel() {
    this.router.navigate(['/dashboard']);
  }

  openInviteModal() {
    const dialogRef = this.dialog.open(InviteModalComponent, {
      width: '700px',
      disableClose: false,
      autoFocus: true
    });

    dialogRef.afterClosed().subscribe((result: boolean) => {
      // Modal closed
    });
  }
}

