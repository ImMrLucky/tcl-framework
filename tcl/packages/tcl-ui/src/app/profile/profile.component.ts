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
import { AppHeaderComponent } from '../shared/app-header.component';
import { InviteModalComponent } from '../invite-modal/invite-modal.component';
import { MemberService } from '../member.service';

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
    AppHeaderComponent
  ],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit {
  profileForm: FormGroup;
  loading = false;
  errorMessage = '';
  currentUser: any = null;
  canInviteMembers: boolean = false;
  primaryOrgId: string = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private memberService: MemberService
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
        
        // Load user's orgs to check permissions
        this.loadUserOrgs(user.id);
      }
    });
  }

  loadUserOrgs(userId: string) {
    this.memberService.getUserOrgs(userId).subscribe({
      next: (response) => {
        const orgs = response.orgs || [];
        
        // Find primary org (where user is owner) or first org where they can manage members
        const ownerOrg = orgs.find(org => org.role === 'owner');
        const adminOrg = orgs.find(org => org.role === 'admin');
        
        // Primary org is the one they own, or first admin org, or first org
        this.primaryOrgId = ownerOrg?.id || adminOrg?.id || (orgs.length > 0 ? orgs[0].id : '');
        
        // User can invite if they're owner or admin in at least one org
        this.canInviteMembers = orgs.some(org => org.role === 'owner' || org.role === 'admin');
      },
      error: (err: any) => {
        console.error('Failed to load user orgs:', err);
        this.canInviteMembers = false;
        this.primaryOrgId = '';
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
        const snackBarRef = this.snackBar.open('Profile updated successfully', 'Close', {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'top',
          panelClass: ['success-snackbar']
        });
        
        // Handle the action click
        snackBarRef.onAction().subscribe(() => {
          snackBarRef.dismiss();
        });
        
        // Navigate back to dashboard after a short delay
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
    if (!this.canInviteMembers || !this.primaryOrgId) {
      console.warn('User does not have permission to invite members');
      return;
    }

    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      return;
    }

    // Get orgs where user can manage members
    this.memberService.getUserOrgs(currentUser.id).subscribe({
      next: (orgResponse) => {
        const manageableOrgs = (orgResponse.orgs || []).filter(org => org.role === 'owner' || org.role === 'admin');
        
        const dialogRef = this.dialog.open(InviteModalComponent, {
          width: '700px',
          disableClose: false,
          autoFocus: true,
          data: {
            orgId: this.primaryOrgId,
            orgs: manageableOrgs
          } as any
        });

        dialogRef.afterClosed().subscribe((result: boolean) => {
          // Modal closed
        });
      },
      error: (err: any) => {
        console.error('Failed to load organizations:', err);
      }
    });
  }
}

