import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppHeaderComponent } from '../shared/app-header.component';
import { PoliciesService, PolicyDetail, PolicyVersion, IssuePolicyLink } from '../policies.service';

@Component({
  selector: 'app-policy-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTabsModule,
    MatTableModule,
    MatSnackBarModule,
    AppHeaderComponent
  ],
  templateUrl: './policy-detail.component.html',
  styleUrls: ['./policy-detail.component.scss']
})
export class PolicyDetailComponent implements OnInit {
  policyDetail: PolicyDetail | null = null;
  loading = false;

  versionColumns = ['version', 'status', 'createdAt', 'activatedAt'];
  issueColumns = ['issueId', 'linkType', 'section', 'createdAt'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private policiesService: PoliciesService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPolicy(id);
    }
  }

  async loadPolicy(id: string) {
    this.loading = true;
    try {
      const detail = await this.policiesService.getPolicy(id).toPromise();
      if (detail) {
        this.policyDetail = detail;
      }
    } catch (error: any) {
      console.error('Failed to load policy:', error);
      this.snackBar.open('Failed to load policy: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }

  async activatePolicy() {
    if (!this.policyDetail) return;

    try {
      await this.policiesService.activatePolicy(this.policyDetail.policy.id).toPromise();
      this.snackBar.open('Policy activated successfully', 'Close', { duration: 3000 });
      this.loadPolicy(this.policyDetail.policy.id);
    } catch (error: any) {
      console.error('Failed to activate policy:', error);
      this.snackBar.open('Failed to activate policy: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  async archivePolicy() {
    if (!this.policyDetail) return;

    if (!confirm(`Are you sure you want to archive "${this.policyDetail.policy.name}"?`)) {
      return;
    }

    try {
      await this.policiesService.archivePolicy(this.policyDetail.policy.id).toPromise();
      this.snackBar.open('Policy archived successfully', 'Close', { duration: 3000 });
      this.loadPolicy(this.policyDetail.policy.id);
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

  viewIssue(issueId: string) {
    // Navigate to issue detail (if issue detail page exists)
    // For now, just show a message
    this.snackBar.open(`Issue ID: ${issueId}`, 'Close', { duration: 3000 });
  }
}

