import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AppHeaderComponent } from '../shared/app-header.component';
import { EntitlementsService } from '../entitlements.service';

interface Case {
  id: string;
  org_id: string;
  project_id?: string;
  title: string;
  description?: string;
  status: 'OPEN' | 'IN_REVIEW' | 'CLOSED';
  owner_user_id?: string;
  created_at: string;
  updated_at: string;
}

interface CaseIssue {
  id: string;
  case_id: string;
  issue_id: string;
  evaluation_id?: string;
  added_by_user_id: string;
  added_at: string;
}

interface CaseDetailResponse {
  case: Case;
  issues: CaseIssue[];
  issueCount: number;
}

@Component({
  selector: 'app-case-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
    MatSnackBarModule,
    AppHeaderComponent,
  ],
  template: `
    <app-header 
      [pageTitle]="case_?.title || 'Case Details'"
      pageSubtitle="Manage case issues and details"
      [showNavigation]="true"
      [showBackButton]="true"
      backButtonRoute="/cases"
      backButtonText="Back to Cases">
    </app-header>

    <div class="container">
      <mat-card *ngIf="loading" class="loading-card">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading case...</p>
      </mat-card>

      <div *ngIf="!loading && case_" class="case-detail">
        <!-- Case Info -->
        <mat-card class="case-info-card">
          <mat-card-header>
            <mat-card-title>{{ case_.title }}</mat-card-title>
            <mat-card-subtitle>
              <mat-chip [class]="'status-' + case_.status.toLowerCase()">{{ case_.status }}</mat-chip>
              <span class="meta">Created: {{ formatDate(case_.created_at) }}</span>
            </mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div *ngIf="case_.description" class="description">
              <strong>Description:</strong>
              <p>{{ case_.description }}</p>
            </div>
            
            <div class="case-actions">
              <mat-form-field appearance="outline">
                <mat-label>Status</mat-label>
                <mat-select [(ngModel)]="case_.status" (selectionChange)="updateCase()">
                  <mat-option value="OPEN">Open</mat-option>
                  <mat-option value="IN_REVIEW">In Review</mat-option>
                  <mat-option value="CLOSED">Closed</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Case Issues -->
        <mat-card class="issues-card">
          <mat-card-header>
            <mat-card-title>Issues ({{ issues.length }})</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div *ngIf="issues.length === 0" class="no-issues">
              <p>No issues in this case yet.</p>
              <p class="hint">Add issues from the Issues page by clicking "Add to Case".</p>
            </div>
            <div *ngFor="let issue of issues" class="issue-item">
              <div class="issue-info">
                <strong>Issue ID:</strong> {{ issue.issue_id }}
                <span *ngIf="issue.evaluation_id" class="evaluation-id">
                  (Evaluation: {{ issue.evaluation_id.substring(0, 8) }}...)
                </span>
              </div>
              <div class="issue-meta">
                Added: {{ formatDate(issue.added_at) }}
              </div>
              <button mat-icon-button (click)="removeIssue(issue.issue_id, issue.evaluation_id)" color="warn">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .loading-card {
      padding: 40px;
      text-align: center;
    }
    .case-detail {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .case-info-card {
      margin-bottom: 20px;
    }
    .meta {
      margin-left: 10px;
      color: #666;
      font-size: 0.9em;
    }
    .description {
      margin: 16px 0;
    }
    .case-actions {
      margin-top: 16px;
    }
    .issues-card {
      margin-top: 20px;
    }
    .no-issues {
      padding: 40px;
      text-align: center;
      color: #999;
    }
    .hint {
      font-size: 0.9em;
      margin-top: 10px;
    }
    .issue-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      margin-bottom: 8px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .issue-info {
      flex: 1;
    }
    .evaluation-id {
      color: #666;
      font-size: 0.9em;
      margin-left: 8px;
    }
    .issue-meta {
      color: #666;
      font-size: 0.85em;
      margin-right: 10px;
    }
    .status-open {
      background: #e3f2fd;
      color: #1976d2;
    }
    .status-in_review {
      background: #fff3e0;
      color: #f57c00;
    }
    .status-closed {
      background: #e8f5e9;
      color: #388e3c;
    }
  `]
})
export class CaseDetailComponent implements OnInit {
  case_: Case | null = null;
  issues: CaseIssue[] = [];
  loading = false;

  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private entitlementsService: EntitlementsService
  ) {}

  async ngOnInit() {
    // Check entitlement
    if (!this.entitlementsService.hasFeature('cases')) {
      this.snackBar.open('Cases feature is not available for your plan', 'Close', { duration: 5000 });
      this.router.navigate(['/cases']);
      return;
    }
    
    const caseId = this.route.snapshot.paramMap.get('id');
    if (caseId) {
      await this.loadCase(caseId);
    }
  }

  async loadCase(caseId: string) {
    this.loading = true;
    try {
      const response = await firstValueFrom(
        this.http.get<CaseDetailResponse>(`${this.apiUrl}/api/cases/${caseId}`)
      );
      
      this.case_ = response.case;
      this.issues = response.issues || [];
    } catch (error: any) {
      console.error('Failed to load case:', error);
      this.snackBar.open('Failed to load case: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      this.router.navigate(['/cases']);
    } finally {
      this.loading = false;
    }
  }

  async updateCase() {
    if (!this.case_) return;
    
    try {
      const response = await firstValueFrom(
        this.http.patch<{ success: boolean; case: Case }>(
          `${this.apiUrl}/api/cases/${this.case_.id}`,
          { status: this.case_.status }
        )
      );
      
      if (response.success) {
        this.case_ = response.case;
        this.snackBar.open('Case updated successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Failed to update case:', error);
      this.snackBar.open('Failed to update case: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  async removeIssue(issueId: string, evaluationId?: string) {
    if (!this.case_) return;
    if (!confirm('Remove this issue from the case?')) return;
    
    try {
      const params: any = {};
      if (evaluationId) {
        params.evaluationId = evaluationId;
      }
      
      const response = await firstValueFrom(
        this.http.delete<{ success: boolean }>(
          `${this.apiUrl}/api/cases/${this.case_.id}/issues/${issueId}`,
          { params }
        )
      );
      
      if (response.success) {
        this.snackBar.open('Issue removed from case', 'Close', { duration: 3000 });
        await this.loadCase(this.case_.id);
      }
    } catch (error: any) {
      console.error('Failed to remove issue:', error);
      this.snackBar.open('Failed to remove issue: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleString();
  }
}

