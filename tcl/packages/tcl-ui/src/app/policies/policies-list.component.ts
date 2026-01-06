import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppHeaderComponent } from '../shared/app-header.component';
import { PoliciesService, Policy } from '../policies.service';
import { PolicyUploadDialogComponent } from './policy-upload-dialog.component';

@Component({
  selector: 'app-policies-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    AppHeaderComponent
  ],
  templateUrl: './policies-list.component.html',
  styleUrls: ['./policies-list.component.scss']
})
export class PoliciesListComponent implements OnInit {
  policies: Policy[] = [];
  loading = false;
  
  // Filters
  statusFilter: string = '';
  nameFilter: string = '';

  displayedColumns = ['name', 'version', 'status', 'createdAt', 'actions'];

  constructor(
    private policiesService: PoliciesService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.loadPolicies();
  }

  async loadPolicies() {
    this.loading = true;
    try {
      const filters: any = {};
      if (this.statusFilter) filters.status = this.statusFilter;
      if (this.nameFilter) filters.name = this.nameFilter;

      const response = await this.policiesService.getPolicies(filters).toPromise();
      if (response) {
        this.policies = response.policies;
      }
    } catch (error: any) {
      console.error('Failed to load policies:', error);
      this.snackBar.open('Failed to load policies: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }

  applyFilters() {
    this.loadPolicies();
  }

  clearFilters() {
    this.statusFilter = '';
    this.nameFilter = '';
    this.loadPolicies();
  }

  openUploadDialog() {
    const dialogRef = this.dialog.open(PolicyUploadDialogComponent, {
      width: '600px',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.loadPolicies();
      }
    });
  }

  viewPolicy(policy: Policy) {
    this.router.navigate(['/policies', policy.id]);
  }

  async activatePolicy(policy: Policy) {
    try {
      await this.policiesService.activatePolicy(policy.id).toPromise();
      this.snackBar.open('Policy activated successfully', 'Close', { duration: 3000 });
      this.loadPolicies();
    } catch (error: any) {
      console.error('Failed to activate policy:', error);
      this.snackBar.open('Failed to activate policy: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  async archivePolicy(policy: Policy) {
    if (!confirm(`Are you sure you want to archive "${policy.name}"?`)) {
      return;
    }

    try {
      await this.policiesService.archivePolicy(policy.id).toPromise();
      this.snackBar.open('Policy archived successfully', 'Close', { duration: 3000 });
      this.loadPolicies();
    } catch (error: any) {
      console.error('Failed to archive policy:', error);
      this.snackBar.open('Failed to archive policy: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  getStatusClass(status: string): string {
    return `status-${status}`;
  }
}

