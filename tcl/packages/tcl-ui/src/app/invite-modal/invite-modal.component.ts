import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormArray, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MemberService, Role } from '../member.service';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-invite-modal',
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
    MatProgressSpinnerModule,
    MatChipsModule,
    MatSnackBarModule
  ],
  templateUrl: './invite-modal.component.html',
  styleUrls: ['./invite-modal.component.scss']
})
export class InviteModalComponent implements OnInit {
  inviteForm: FormGroup;
  loading = false;
  errorMessage = '';
  successCount = 0;
  errorCount = 0;
  results: Array<{ email: string; success: boolean; message: string }> = [];

  roles: Role[] = ['owner', 'admin', 'qa_reviewer', 'compliance', 'engineer', 'viewer'];
  roleLabels: Record<Role, string> = {
    owner: 'Owner',
    admin: 'Admin',
    qa_reviewer: 'QA Reviewer',
    compliance: 'Compliance',
    engineer: 'Engineer',
    viewer: 'Viewer'
  };

  constructor(
    private fb: FormBuilder,
    private memberService: MemberService,
    private authService: AuthService,
    private dialogRef: MatDialogRef<InviteModalComponent>,
    private snackBar: MatSnackBar
  ) {
    this.inviteForm = this.fb.group({
      invites: this.fb.array([this.createInviteGroup()])
    });
  }

  ngOnInit() {
    // Component initialized
  }

  createInviteGroup(): FormGroup {
    return this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      role: ['viewer', Validators.required]
    });
  }

  get invites(): FormArray {
    return this.inviteForm.get('invites') as FormArray;
  }

  addInvite() {
    this.invites.push(this.createInviteGroup());
  }

  removeInvite(index: number) {
    if (this.invites.length > 1) {
      this.invites.removeAt(index);
    }
  }

  onCancel() {
    this.dialogRef.close();
  }

  async onSubmit() {
    if (this.inviteForm.invalid) {
      // Mark all fields as touched to show errors
      this.invites.controls.forEach(control => {
        control.get('email')?.markAsTouched();
        control.get('role')?.markAsTouched();
      });
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.results = [];
    this.successCount = 0;
    this.errorCount = 0;

    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      this.errorMessage = 'You must be logged in to invite members';
      this.loading = false;
      return;
    }

    // Get first org ID (assuming user has at least one org)
    // In a real scenario, you might want to pass orgId as input to the modal
    this.memberService.getUserOrgs(currentUser.id).subscribe({
      next: async (orgResponse) => {
        if (!orgResponse.orgs || orgResponse.orgs.length === 0) {
          this.errorMessage = 'You must be part of an organization to invite members';
          this.loading = false;
          return;
        }

        const orgId = orgResponse.orgs[0].id;
        const inviteValues = this.invites.value;

        // Invite each user
        for (const invite of inviteValues) {
          try {
            const result = await this.memberService.inviteMember(
              orgId,
              currentUser.id,
              invite.email,
              invite.role
            ).toPromise();

            if (result?.success) {
              this.successCount++;
              this.results.push({
                email: invite.email,
                success: true,
                message: result.message || 'Invited successfully'
              });
            } else {
              this.errorCount++;
              this.results.push({
                email: invite.email,
                success: false,
                message: result?.message || 'Failed to invite'
              });
            }
          } catch (error: any) {
            this.errorCount++;
            this.results.push({
              email: invite.email,
              success: false,
              message: error?.message || 'Error sending invitation'
            });
          }
        }

        this.loading = false;

        // Show summary
        if (this.successCount > 0) {
          this.snackBar.open(
            `Successfully invited ${this.successCount} user(s)`,
            'Close',
            { duration: 5000 }
          );
        }

        if (this.errorCount > 0) {
          this.errorMessage = `${this.errorCount} invitation(s) failed. See details below.`;
        }

        // Close modal if all succeeded
        if (this.errorCount === 0) {
          setTimeout(() => {
            this.dialogRef.close(true);
          }, 2000);
        }
      },
      error: (err) => {
        this.errorMessage = 'Failed to load organization information';
        this.loading = false;
      }
    });
  }
}

