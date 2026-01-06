import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { FormsModule } from '@angular/forms';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuditService } from '../audit.service';

interface EvaluationSummary {
  id: string;
  conversation_id: string;
  created_at: string;
  env: string;
  scores: {
    spectral?: {
      coherenceScore: number;
      contradictionEnergy: number;
      circularityScore: number;
    };
    counts?: {
      claims: number;
      contradicted: number;
      ungrounded: number;
      supported: number;
    };
  };
  report?: {
    run?: {
      inputHash: string;
      configHash: string;
      engineVersion: string;
    };
    source?: {
      sourceTitle?: string;
    };
    issues?: any[];
  };
  latency_ms: number;
  engine_version: string;
}

export interface EvaluationSearchResult {
  evaluationId: string;
  createdAt: string;
  agent: string;
  totalIssues: number;
  highCriticalCount: number;
  verifiedPercent: number;
  topCategories: string[];
  conversationId: string;
  env: string;
  scores: any;
  report: {
    source?: {
      sourceTitle?: string;
    };
  };
}

@Component({
  selector: 'app-evaluations-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    AppHeaderComponent
  ],
  template: `
    <div class="evaluations-container">
      <app-header 
        pageTitle="Evaluation History" 
        pageSubtitle="Immutable audit records of all analyses"
        [showNavigation]="true"
        [showBackButton]="true"
        backButtonRoute="/dashboard"
        backButtonText="Back to Dashboard">
        <div headerActions>
          <button mat-raised-button color="primary" routerLink="/ingest">
            <mat-icon>add</mat-icon>
            New Evaluation
          </button>
        </div>
      </app-header>

      <div class="container">
        <!-- Filters -->
        <mat-card class="filters-card">
          <h3>Filters</h3>
          <div class="filters-grid">
            <mat-form-field appearance="outline" class="search-field">
              <mat-label>Search</mat-label>
              <input matInput [(ngModel)]="searchQuery" placeholder="Search by ID, text..." (keyup.enter)="applyFilters()">
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Date From</mat-label>
              <input matInput [matDatepicker]="fromPicker" [(ngModel)]="dateFrom" (dateChange)="applyFilters()">
              <mat-datepicker-toggle matSuffix [for]="fromPicker"></mat-datepicker-toggle>
              <mat-datepicker #fromPicker></mat-datepicker>
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Date To</mat-label>
              <input matInput [matDatepicker]="toPicker" [(ngModel)]="dateTo" (dateChange)="applyFilters()">
              <mat-datepicker-toggle matSuffix [for]="toPicker"></mat-datepicker-toggle>
              <mat-datepicker #toPicker></mat-datepicker>
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Severity Display</mat-label>
              <mat-select [(ngModel)]="severityDisplay" (selectionChange)="applyFilters()">
                <mat-option value="">All</mat-option>
                <mat-option value="low">Low</mat-option>
                <mat-option value="medium">Medium</mat-option>
                <mat-option value="high">High</mat-option>
              </mat-select>
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Verification</mat-label>
              <mat-select [(ngModel)]="verification" (selectionChange)="applyFilters()">
                <mat-option value="">All</mat-option>
                <mat-option value="EXTERNAL_VERIFIED">Verified</mat-option>
                <mat-option value="TRANSCRIPT_ONLY">Transcript-only</mat-option>
                <mat-option value="NONE">Unverified</mat-option>
              </mat-select>
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Category</mat-label>
              <input matInput [(ngModel)]="category" placeholder="e.g. billing" (keyup.enter)="applyFilters()">
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Type</mat-label>
              <input matInput [(ngModel)]="type" placeholder="e.g. CONTRADICTION" (keyup.enter)="applyFilters()">
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Agent</mat-label>
              <input matInput [(ngModel)]="agent" placeholder="Agent ID" (keyup.enter)="applyFilters()">
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Team</mat-label>
              <input matInput [(ngModel)]="team" placeholder="Team ID" (keyup.enter)="applyFilters()">
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Environment</mat-label>
              <mat-select [(ngModel)]="envFilter" (selectionChange)="applyFilters()">
                <mat-option value="">All</mat-option>
                <mat-option value="sandbox">Sandbox</mat-option>
                <mat-option value="production">Production</mat-option>
              </mat-select>
            </mat-form-field>
            
            <button mat-button (click)="clearFilters()">
              <mat-icon>clear</mat-icon>
              Clear Filters
            </button>
          </div>
        </mat-card>

        <!-- Loading -->
        <mat-card *ngIf="loading" class="loading-card">
          <mat-spinner diameter="40"></mat-spinner>
          <p>Loading evaluations...</p>
        </mat-card>

        <!-- Evaluations Table -->
        <mat-card *ngIf="!loading" class="table-card">
          <table mat-table [dataSource]="evaluations" matSort (matSortChange)="sortData($event)">
            
            <!-- Evaluation ID Column -->
            <ng-container matColumnDef="evaluationId">
              <th mat-header-cell *matHeaderCellDef>Evaluation ID</th>
              <td mat-cell *matCellDef="let ev">
                <div class="id-cell">
                  <span class="id-primary">{{ ev.evaluationId | slice:0:8 }}...</span>
                </div>
              </td>
            </ng-container>

            <!-- Created At Column -->
            <ng-container matColumnDef="createdAt">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Created</th>
              <td mat-cell *matCellDef="let ev">
                <div class="date-cell">
                  <span class="date-primary">{{ ev.createdAt | date:'MMM d, yyyy' }}</span>
                  <span class="date-secondary">{{ ev.createdAt | date:'h:mm a' }}</span>
                </div>
              </td>
            </ng-container>

            <!-- Agent Column -->
            <ng-container matColumnDef="agent">
              <th mat-header-cell *matHeaderCellDef>Agent</th>
              <td mat-cell *matCellDef="let ev">
                {{ ev.agent }}
              </td>
            </ng-container>

            <!-- Total Issues Column -->
            <ng-container matColumnDef="totalIssues">
              <th mat-header-cell *matHeaderCellDef>Total Issues</th>
              <td mat-cell *matCellDef="let ev">
                {{ ev.totalIssues }}
              </td>
            </ng-container>

            <!-- High/Critical Column -->
            <ng-container matColumnDef="highCritical">
              <th mat-header-cell *matHeaderCellDef>High/Critical</th>
              <td mat-cell *matCellDef="let ev">
                <mat-chip *ngIf="ev.highCriticalCount > 0" class="issue-chip critical">
                  {{ ev.highCriticalCount }}
                </mat-chip>
                <span *ngIf="ev.highCriticalCount === 0" class="no-issues">0</span>
              </td>
            </ng-container>

            <!-- Verified % Column -->
            <ng-container matColumnDef="verifiedPercent">
              <th mat-header-cell *matHeaderCellDef>Verified %</th>
              <td mat-cell *matCellDef="let ev">
                <div class="percent-cell">
                  {{ ev.verifiedPercent }}%
                </div>
              </td>
            </ng-container>

            <!-- Top Categories Column -->
            <ng-container matColumnDef="topCategories">
              <th mat-header-cell *matHeaderCellDef>Top Categories</th>
              <td mat-cell *matCellDef="let ev">
                <div class="categories-cell">
                  <mat-chip *ngFor="let cat of ev.topCategories" class="category-chip">
                    {{ cat }}
                  </mat-chip>
                  <span *ngIf="ev.topCategories.length === 0" class="no-data">-</span>
                </div>
              </td>
            </ng-container>

            <!-- Actions Column -->
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef>Actions</th>
              <td mat-cell *matCellDef="let ev">
                <button mat-button color="primary" (click)="viewEvaluation(ev.evaluationId); $event.stopPropagation()">
                  <mat-icon>visibility</mat-icon>
                  View
                </button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns" 
                class="evaluation-row"
                (click)="viewEvaluation(row.evaluationId)"></tr>
          </table>

          <!-- Empty State -->
          <div *ngIf="evaluations.length === 0" class="empty-state">
            <mat-icon>assessment</mat-icon>
            <h3>No evaluations found</h3>
            <p>No evaluations match your current filters.</p>
            <button mat-button (click)="clearFilters()">
              Clear Filters
            </button>
          </div>

          <!-- Paginator -->
          <mat-paginator
            *ngIf="evaluations.length > 0"
            [length]="totalEvaluations"
            [pageSize]="pageSize"
            [pageIndex]="pageIndex"
            [pageSizeOptions]="[10, 25, 50, 100]"
            (page)="onPageChange($event)"
            showFirstLastButtons>
          </mat-paginator>
        </mat-card>

      </div>
    </div>
  `,
  styles: [`
    .evaluations-container {
      min-height: 100vh;
      background: #f5f5f5;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }
    
    .filters-card {
      margin-bottom: 24px;
    }
    
    .filters-card h3 {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 500;
    }
    
    .filters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      align-items: center;
    }
    
    .search-field {
      grid-column: 1 / -1;
    }
    
    .loading-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px;
      gap: 16px;
    }
    
    .table-card {
      overflow: hidden;
    }
    
    table {
      width: 100%;
    }
    
    .evaluation-row {
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .evaluation-row:hover {
      background: rgba(0, 0, 0, 0.04);
    }
    
    .date-cell {
      display: flex;
      flex-direction: column;
    }
    
    .date-primary {
      font-weight: 500;
    }
    
    .date-secondary {
      font-size: 12px;
      color: #666;
    }
    
    .id-cell {
      font-family: monospace;
      font-size: 12px;
    }
    
    .id-primary {
      color: #666;
    }
    
    .percent-cell {
      font-weight: 500;
    }
    
    .categories-cell {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    
    .category-chip {
      font-size: 10px !important;
      min-height: 20px !important;
      background: #e3f2fd !important;
      color: #1565c0 !important;
    }
    
    .no-data {
      color: #999;
      font-style: italic;
    }
    
    .issue-chip {
      font-size: 11px !important;
      min-height: 24px !important;
    }
    
    .issue-chip.critical {
      background: #ffcdd2 !important;
      color: #c62828 !important;
    }
    
    .no-issues {
      color: #4caf50;
      font-size: 13px;
    }
    
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 64px;
      color: #666;
    }
    
    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    
    .empty-state h3 {
      margin: 0 0 8px;
    }
    
    .empty-state p {
      margin: 0 0 24px;
    }
    
    .stats-card {
      margin-top: 24px;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 24px;
    }
    
    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
      background: #f9f9f9;
      border-radius: 8px;
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: #1976d2;
    }
    
    .stat-label {
      font-size: 13px;
      color: #666;
      margin-top: 4px;
    }
    
    @media (max-width: 768px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
      
      .filters-row {
        flex-direction: column;
      }
      
      .search-field, .env-filter, .score-filter {
        width: 100%;
      }
    }
  `]
})
export class EvaluationsListComponent implements OnInit {
  evaluations: EvaluationSearchResult[] = [];
  loading = true;
  
  // Filters
  searchQuery = '';
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  severityDisplay: string = '';
  verification: string = '';
  category: string = '';
  type: string = '';
  agent: string = '';
  team: string = '';
  envFilter = '';
  
  // Pagination
  pageSize = 25;
  pageIndex = 0;
  totalEvaluations = 0;
  
  displayedColumns = ['evaluationId', 'createdAt', 'agent', 'totalIssues', 'highCritical', 'verifiedPercent', 'topCategories', 'actions'];

  constructor(
    private auditService: AuditService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadEvaluations();
  }

  async loadEvaluations() {
    this.loading = true;
    try {
      const filters: any = {
        limit: this.pageSize,
        offset: this.pageIndex * this.pageSize,
      };

      if (this.searchQuery) {
        filters.textContains = this.searchQuery;
      }
      if (this.dateFrom) {
        filters.dateFrom = this.dateFrom.toISOString().split('T')[0];
      }
      if (this.dateTo) {
        filters.dateTo = this.dateTo.toISOString().split('T')[0];
      }
      if (this.severityDisplay) {
        filters.severityDisplay = this.severityDisplay;
      }
      if (this.verification) {
        filters.verification = this.verification;
      }
      if (this.category) {
        filters.category = this.category;
      }
      if (this.type) {
        filters.type = this.type;
      }
      if (this.agent) {
        filters.agent = this.agent;
      }
      if (this.team) {
        filters.team = this.team;
      }
      if (this.envFilter) {
        filters.env = this.envFilter;
      }

      const response = await this.auditService.searchEvaluations(filters).toPromise();
      if (response) {
        this.evaluations = response.evaluations;
        this.totalEvaluations = response.total;
      }
    } catch (error) {
      console.error('Failed to load evaluations:', error);
    } finally {
      this.loading = false;
    }
  }

  applyFilters() {
    this.pageIndex = 0;
    this.loadEvaluations();
  }

  clearFilters() {
    this.searchQuery = '';
    this.dateFrom = null;
    this.dateTo = null;
    this.severityDisplay = '';
    this.verification = '';
    this.category = '';
    this.type = '';
    this.agent = '';
    this.team = '';
    this.envFilter = '';
    this.applyFilters();
  }

  sortData(sort: Sort) {
    // Server-side sorting is handled by the API
    // Client-side sorting could be added here if needed
  }

  onPageChange(event: PageEvent) {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.loadEvaluations();
  }

  viewEvaluation(evaluationId: string) {
    this.router.navigate(['/evaluations', evaluationId]);
  }

}

