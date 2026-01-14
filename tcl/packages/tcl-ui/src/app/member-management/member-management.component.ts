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
import { HttpClient } from '@angular/common/http';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuthService, User } from '../auth.service';
import { MemberService, Member, Role } from '../member.service';
import { firstValueFrom } from 'rxjs';
import { AdminRecoveryDialogComponent } from './admin-recovery-dialog.component';

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
  hasAdmins = true; // Track if org has admins
  recoveryRequestStatus: { status: string; message?: string } | null = null;
  
  displayedColumns: string[] = ['email', 'fullName', 'role', 'createdAt', 'actions'];
  
  roles: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'];
  roleLabels: Record<Role, string> = {
    OWNER: 'Owner',
    ADMIN: 'Admin',
    MANAGER: 'Manager',
    ANALYST: 'Analyst',
    VIEWER: 'Viewer'
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
    private dialog: MatDialog,
    private http: HttpClient
  ) {
    this.inviteForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      role: ['VIEWER', Validators.required]
    });
  }

  async ngOnInit() {
    // Get orgId from route
    this.orgId = this.route.snapshot.paramMap.get('orgId');
    
    if (!this.orgId) {
      const snackBarRef = this.snackBar.open('Organization ID is required', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
        this.checkAdminStatus();
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to load members:', error);
        const snackBarRef = this.snackBar.open('Failed to load members: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        this.loading = false;
      }
    });
  }

  canManageMembers(): boolean {
    return this.currentUserRole === 'OWNER' || this.currentUserRole === 'ADMIN';
  }

  toggleInviteForm() {
    this.showInviteForm = !this.showInviteForm;
    if (this.showInviteForm) {
      this.inviteForm.reset({ role: 'VIEWER' });
    }
  }

  onSubmitInvite() {
    if (this.inviteForm.invalid || !this.orgId || !this.currentUserId) return;

    const { email, role } = this.inviteForm.value;
    this.loading = true;

    this.memberService.inviteMember(this.orgId, this.currentUserId, email, role).subscribe({
      next: (response) => {
        if (response.success) {
          const snackBarRef = this.snackBar.open(response.message || 'Member invited successfully', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
          this.inviteForm.reset({ role: 'VIEWER' });
          this.showInviteForm = false;
          this.loadMembers();
        } else {
          const snackBarRef = this.snackBar.open(response.message || 'Failed to invite member', 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to invite member:', error);
        const snackBarRef = this.snackBar.open('Failed to invite member: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
          const snackBarRef = this.snackBar.open(response.message || 'Role updated successfully', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
          this.loadMembers();
        } else {
          const snackBarRef = this.snackBar.open(response.message || 'Failed to update role', 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to update role:', error);
        const snackBarRef = this.snackBar.open('Failed to update role: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        this.loading = false;
      }
    });
  }

  removeMember(member: Member) {
    if (!this.orgId || !this.currentUserId) return;
    
    // Guardrail: Prevent removing owner
    if (member.role === 'OWNER') {
      this.snackBar.open('Cannot remove owner. Use ownership transfer instead.', 'Close', { duration: 5000 });
      return;
    }

    // Guardrail: Prevent removing last admin
    if (member.role === 'ADMIN') {
      const adminCount = this.members.filter(m => (m.role === 'ADMIN' || m.role === 'OWNER') && m.userId !== member.userId).length;
      if (adminCount === 0) {
        this.snackBar.open('Cannot remove the last admin. Please promote another member to admin first.', 'Close', { duration: 5000 });
        return;
      }
    }
    
    if (!confirm(`Are you sure you want to remove ${member.email} from this organization?`)) {
      return;
    }

    this.loading = true;
    this.memberService.removeMember(this.orgId, this.currentUserId, member.userId).subscribe({
      next: (response) => {
        if (response.success) {
          const snackBarRef = this.snackBar.open(response.message || 'Member removed successfully', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
          this.loadMembers();
        } else {
          const snackBarRef = this.snackBar.open(response.message || 'Failed to remove member', 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to remove member:', error);
        const snackBarRef = this.snackBar.open('Failed to remove member: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        this.loading = false;
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }

  canTransferOwnership(): boolean {
    return this.currentUserRole === 'OWNER';
  }

  async transferOwnership(member: Member) {
    if (!this.orgId || !this.currentUserId) return;
    
    if (member.role !== 'ADMIN') {
      this.snackBar.open('New owner must be an ADMIN. Please promote this member to admin first.', 'Close', { duration: 5000 });
      return;
    }

    if (!confirm(`Are you sure you want to transfer ownership to ${member.email}? You will become an ADMIN.`)) {
      return;
    }

    this.loading = true;
    try {
      const apiBase = (this.memberService as any).apiBase || '/api';
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; message?: string; error?: string }>(
          `${apiBase}/orgs/${this.orgId}/transfer-ownership`,
          { newOwnerUserId: member.userId }
        )
      );
      
      if (response?.success) {
        this.snackBar.open('Ownership transferred successfully', 'Close', { duration: 3000 });
        this.loadMembers();
        this.loadCurrentUserRole();
      } else {
        this.snackBar.open(response?.error || 'Failed to transfer ownership', 'Close', { duration: 5000 });
      }
    } catch (error: any) {
      console.error('Failed to transfer ownership:', error);
      this.snackBar.open('Failed to transfer ownership: ' + (error.error?.error || error.message || 'Unknown error'), 'Close', { duration: 5000 });
    } finally {
      this.loading = false;
    }
  }

  checkAdminStatus() {
    // Check if org has at least one OWNER or ADMIN
    this.hasAdmins = this.members.some(m => m.role === 'OWNER' || m.role === 'ADMIN');
    
    // If no admins, check for recovery request status
    if (!this.hasAdmins && this.orgId) {
      this.loadRecoveryRequestStatus();
    }
  }

  async loadRecoveryRequestStatus() {
    if (!this.orgId) return;
    try {
      const apiBase = (this.memberService as any).apiBase || '/api';
      const response = await firstValueFrom(
        this.http.get<{ request: { status: string; reason?: string; resolutionNotes?: string; createdAt?: string; resolvedAt?: string } | null }>(
          `${apiBase}/orgs/${this.orgId}/admin-recovery`
        )
      );
      
      if (response.request) {
        this.recoveryRequestStatus = {
          status: response.request.status,
          message: response.request.status === 'PENDING' 
            ? 'Recovery request is pending review'
            : response.request.status === 'APPROVED'
            ? 'Recovery request has been approved'
            : response.request.status === 'REJECTED'
            ? 'Recovery request was rejected'
            : 'Recovery request status: ' + response.request.status
        };
      }
    } catch (error) {
      console.error('Failed to load recovery request status:', error);
    }
  }

  openAdminRecoveryDialog() {
    if (!this.orgId) return;
    
    const dialogRef = this.dialog.open(AdminRecoveryDialogComponent, {
      width: '600px',
      data: { orgId: this.orgId }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.success) {
        this.snackBar.open(result.message || 'Recovery request submitted successfully', 'Close', { duration: 5000 });
        this.loadRecoveryRequestStatus();
      }
    });
  }

  signOut() {
    this.authService.signOut();
  }
}

