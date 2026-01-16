import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
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
  issueCount?: number;
}

interface CasesResponse {
  cases: Case[];
  total: number;
  limit: number;
  offset: number;
}

@Component({
  selector: 'app-cases-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatPaginatorModule,
    MatSnackBarModule,
    AppHeaderComponent,
  ],
  template: `
    <app-header 
      pageTitle="Cases" 
      pageSubtitle="Group and manage related issues"
      [showNavigation]="true"
      [showBackButton]="true"
      backButtonRoute="/dashboard"
      backButtonText="Back to Dashboard">
    </app-header>

    <div class="container">
      <div style="margin-bottom: 16px; display: flex; justify-content: flex-end; gap: 8px;">
        <button mat-raised-button color="primary" (click)="createCase()" [disabled]="loading">
          <mat-icon>add</mat-icon>
          New Case
        </button>
      </div>

      <mat-card *ngIf="loading" class="loading-card">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading cases...</p>
      </mat-card>

      <mat-card *ngIf="!loading" class="table-card">
        <table mat-table [dataSource]="cases" class="cases-table">
          <!-- Title Column -->
          <ng-container matColumnDef="title">
            <th mat-header-cell *matHeaderCellDef>Title</th>
            <td mat-cell *matCellDef="let case_">
              <a [routerLink]="['/cases', case_.id]" class="case-link">{{ case_.title }}</a>
            </td>
          </ng-container>

          <!-- Status Column -->
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let case_">
              <mat-chip [class]="'status-' + case_.status.toLowerCase()">{{ case_.status }}</mat-chip>
            </td>
          </ng-container>

          <!-- Issue Count Column -->
          <ng-container matColumnDef="issueCount">
            <th mat-header-cell *matHeaderCellDef>Issues</th>
            <td mat-cell *matCellDef="let case_">{{ case_.issueCount || 0 }}</td>
          </ng-container>

          <!-- Created At Column -->
          <ng-container matColumnDef="createdAt">
            <th mat-header-cell *matHeaderCellDef>Created</th>
            <td mat-cell *matCellDef="let case_">{{ formatDate(case_.created_at) }}</td>
          </ng-container>

          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let case_">
              <button mat-icon-button [routerLink]="['/cases', case_.id]" matTooltip="View Case">
                <mat-icon>visibility</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
        </table>

        <mat-paginator
          [length]="total"
          [pageSize]="pageSize"
          [pageIndex]="pageIndex"
          [pageSizeOptions]="[10, 25, 50, 100]"
          (page)="onPageChange($event)">
        </mat-paginator>
      </mat-card>
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
    .table-card {
      padding: 0;
    }
    .cases-table {
      width: 100%;
    }
    .case-link {
      color: #1976d2;
      text-decoration: none;
      font-weight: 500;
    }
    .case-link:hover {
      text-decoration: underline;
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
export class CasesListComponent implements OnInit {
  cases: Case[] = [];
  loading = false;
  total = 0;
  pageSize = 25;
  pageIndex = 0;
  
  displayedColumns = ['title', 'status', 'issueCount', 'createdAt', 'actions'];

  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(
    private http: HttpClient,
    private router: Router,
    private snackBar: MatSnackBar,
    private entitlementsService: EntitlementsService
  ) {}

  async ngOnInit() {
    // Check entitlement
    if (!this.entitlementsService.hasFeature('cases')) {
      this.snackBar.open('Cases feature is not available for your plan', 'Close', { duration: 5000 });
      this.router.navigate(['/dashboard']);
      return;
    }
    
    await this.loadCases();
  }

  async loadCases() {
    this.loading = true;
    try {
      const response = await firstValueFrom(
        this.http.get<CasesResponse>(`${this.apiUrl}/api/cases`, {
          params: {
            limit: this.pageSize.toString(),
            offset: (this.pageIndex * this.pageSize).toString(),
          }
        })
      );
      
      this.cases = response.cases || [];
      this.total = response.total || 0;
    } catch (error: any) {
      console.error('Failed to load cases:', error);
      this.snackBar.open('Failed to load cases: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }

  onPageChange(event: PageEvent) {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.loadCases();
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString();
  }

  createCase() {
    const title = prompt('Enter case title:');
    if (!title) return;
    
    const description = prompt('Enter case description (optional):');
    
    this.loading = true;
    firstValueFrom(
      this.http.post<{ success: boolean; case: Case }>(`${this.apiUrl}/api/cases`, {
        title,
        description: description || null,
      })
    ).then(response => {
      if (response.success) {
        this.router.navigate(['/cases', response.case.id]);
      }
    }).catch(error => {
      console.error('Failed to create case:', error);
      this.snackBar.open('Failed to create case: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      this.loading = false;
    });
  }
}

