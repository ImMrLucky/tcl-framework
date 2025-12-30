import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuthService, User } from '../auth.service';
import { MemberService, Member, Role } from '../member.service';

@Component({
  selector: 'app-member-management',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatTooltipModule,
    MatDividerModule,
    AppHeaderComponent
  ],
  templateUrl: './member-management.component.html',
  styleUrls: ['./member-management.component.scss']
})
export class MemberManagementComponent implements OnInit {
  orgId: string | null = null;
  currentUser: User | null = null;
  currentUserId: string | null = null;
  currentUserRole: Role | null = null;
  members: Member[] = [];
  loading = false;
  inviteForm: FormGroup;
  showInviteForm = false;
  
  displayedColumns: string[] = ['email', 'fullName', 'role', 'createdAt', 'actions'];
  
  roles: Role[] = ['owner', 'admin', 'qa_reviewer', 'compliance', 'engineer', 'viewer'];
  roleLabels: Record<Role, string> = {
    owner: 'Owner',
    admin: 'Admin',
    qa_reviewer: 'QA Reviewer',
    compliance: 'Compliance',
    engineer: 'Engineer',
    viewer: 'Viewer'
  };

  getRoleLabel(role: string): string {
    return this.roleLabels[role as Role] || role;
  }

  constructor(
    private route: ActivatedRoute,
    private fb: FormBuilder,
    private authService: AuthService,
    private memberService: MemberService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {
    this.inviteForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      role: ['viewer', Validators.required]
    });
  }

  async ngOnInit() {
    // Get orgId from route
    this.orgId = this.route.snapshot.paramMap.get('orgId');
    
    if (!this.orgId) {
      this.snackBar.open('Organization ID is required', 'Close', { duration: 3000 });
      return;
    }

    // Get current user
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user?.id) {
        this.currentUserId = user.id;
        this.loadMembers();
        this.loadCurrentUserRole();
      }
    });
  }

  async loadCurrentUserRole() {
    if (!this.currentUserId || !this.orgId) return;
    
    try {
      const orgsResponse = await this.memberService.getUserOrgs(this.currentUserId).toPromise();
      const org = orgsResponse?.orgs.find(o => o.id === this.orgId);
      if (org) {
        this.currentUserRole = org.role as Role;
      }
    } catch (error) {
      console.error('Failed to load user role:', error);
    }
  }

  loadMembers() {
    if (!this.orgId || !this.currentUserId) return;
    
    this.loading = true;
    this.memberService.listMembers(this.orgId, this.currentUserId).subscribe({
      next: (response) => {
        this.members = response.members || [];
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to load members:', error);
        this.snackBar.open('Failed to load members: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        this.loading = false;
      }
    });
  }

  canManageMembers(): boolean {
    return this.currentUserRole === 'owner' || this.currentUserRole === 'admin';
  }

  toggleInviteForm() {
    this.showInviteForm = !this.showInviteForm;
    if (this.showInviteForm) {
      this.inviteForm.reset({ role: 'viewer' });
    }
  }

  onSubmitInvite() {
    if (this.inviteForm.invalid || !this.orgId || !this.currentUserId) return;

    const { email, role } = this.inviteForm.value;
    this.loading = true;

    this.memberService.inviteMember(this.orgId, this.currentUserId, email, role).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open(response.message || 'Member invited successfully', 'Close', { duration: 3000 });
          this.inviteForm.reset({ role: 'viewer' });
          this.showInviteForm = false;
          this.loadMembers();
        } else {
          this.snackBar.open(response.message || 'Failed to invite member', 'Close', { duration: 5000 });
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to invite member:', error);
        this.snackBar.open('Failed to invite member: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        this.loading = false;
      }
    });
  }

  updateRole(member: Member, newRole: Role) {
    if (!this.orgId || !this.currentUserId) return;
    if (member.role === newRole) return;

    this.loading = true;
    this.memberService.updateMemberRole(this.orgId, this.currentUserId, member.userId, newRole).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open(response.message || 'Role updated successfully', 'Close', { duration: 3000 });
          this.loadMembers();
        } else {
          this.snackBar.open(response.message || 'Failed to update role', 'Close', { duration: 5000 });
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to update role:', error);
        this.snackBar.open('Failed to update role: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        this.loading = false;
      }
    });
  }

  removeMember(member: Member) {
    if (!this.orgId || !this.currentUserId) return;
    
    if (!confirm(`Are you sure you want to remove ${member.email} from this organization?`)) {
      return;
    }

    this.loading = true;
    this.memberService.removeMember(this.orgId, this.currentUserId, member.userId).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open(response.message || 'Member removed successfully', 'Close', { duration: 3000 });
          this.loadMembers();
        } else {
          this.snackBar.open(response.message || 'Failed to remove member', 'Close', { duration: 5000 });
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to remove member:', error);
        this.snackBar.open('Failed to remove member: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        this.loading = false;
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }

  signOut() {
    this.authService.signOut();
  }
}

