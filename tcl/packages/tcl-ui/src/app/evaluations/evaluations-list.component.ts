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
          <div class="filters-row">
            <mat-form-field appearance="outline" class="search-field">
              <mat-label>Search</mat-label>
              <input matInput [(ngModel)]="searchQuery" placeholder="Search by ID or title..." (keyup.enter)="applyFilters()">
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            
            <mat-form-field appearance="outline" class="env-filter">
              <mat-label>Environment</mat-label>
              <mat-select [(ngModel)]="envFilter" (selectionChange)="applyFilters()">
                <mat-option value="">All</mat-option>
                <mat-option value="sandbox">Sandbox</mat-option>
                <mat-option value="production">Production</mat-option>
              </mat-select>
            </mat-form-field>
            
            <mat-form-field appearance="outline" class="score-filter">
              <mat-label>Min Coherence</mat-label>
              <mat-select [(ngModel)]="minCoherence" (selectionChange)="applyFilters()">
                <mat-option [value]="0">Any</mat-option>
                <mat-option [value]="30">30+</mat-option>
                <mat-option [value]="50">50+</mat-option>
                <mat-option [value]="70">70+</mat-option>
                <mat-option [value]="90">90+</mat-option>
              </mat-select>
            </mat-form-field>
            
            <button mat-button (click)="clearFilters()">
              <mat-icon>clear</mat-icon>
              Clear
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
          <table mat-table [dataSource]="filteredEvaluations" matSort (matSortChange)="sortData($event)">
            
            <!-- Date Column -->
            <ng-container matColumnDef="date">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Date</th>
              <td mat-cell *matCellDef="let eval">
                <div class="date-cell">
                  <span class="date-primary">{{ eval.created_at | date:'MMM d, yyyy' }}</span>
                  <span class="date-secondary">{{ eval.created_at | date:'h:mm a' }}</span>
                </div>
              </td>
            </ng-container>

            <!-- Source Column -->
            <ng-container matColumnDef="source">
              <th mat-header-cell *matHeaderCellDef>Source</th>
              <td mat-cell *matCellDef="let eval">
                <div class="source-cell">
                  <span class="source-title">{{ getSourceTitle(eval) }}</span>
                  <span class="source-id">{{ eval.conversation_id | slice:0:8 }}...</span>
                </div>
              </td>
            </ng-container>

            <!-- Coherence Column -->
            <ng-container matColumnDef="coherence">
              <th mat-header-cell *matHeaderCellDef mat-sort-header>Coherence</th>
              <td mat-cell *matCellDef="let eval">
                <div class="score-cell" [class]="getScoreClass(eval.scores?.spectral?.coherenceScore)">
                  <span class="score-value">{{ eval.scores?.spectral?.coherenceScore ?? 'N/A' }}</span>
                </div>
              </td>
            </ng-container>

            <!-- Issues Column -->
            <ng-container matColumnDef="issues">
              <th mat-header-cell *matHeaderCellDef>Issues</th>
              <td mat-cell *matCellDef="let eval">
                <div class="issues-cell">
                  <mat-chip *ngIf="eval.scores?.counts?.contradicted > 0" class="issue-chip critical">
                    {{ eval.scores?.counts?.contradicted }} contradicted
                  </mat-chip>
                  <mat-chip *ngIf="eval.scores?.counts?.ungrounded > 0" class="issue-chip warning">
                    {{ eval.scores?.counts?.ungrounded }} ungrounded
                  </mat-chip>
                  <span *ngIf="!eval.scores?.counts?.contradicted && !eval.scores?.counts?.ungrounded" class="no-issues">
                    No issues
                  </span>
                </div>
              </td>
            </ng-container>

            <!-- Claims Column -->
            <ng-container matColumnDef="claims">
              <th mat-header-cell *matHeaderCellDef>Claims</th>
              <td mat-cell *matCellDef="let eval">
                {{ eval.scores?.counts?.claims ?? 0 }}
              </td>
            </ng-container>

            <!-- Mode Column -->
            <ng-container matColumnDef="mode">
              <th mat-header-cell *matHeaderCellDef>Mode</th>
              <td mat-cell *matCellDef="let eval">
                <mat-chip *ngIf="isSimulation(eval)" class="mode-chip simulation">
                  <mat-icon>science</mat-icon>
                  Simulation
                </mat-chip>
                <mat-chip *ngIf="!isSimulation(eval)" class="mode-chip evaluation">
                  <mat-icon>verified</mat-icon>
                  Evaluation
                </mat-chip>
              </td>
            </ng-container>

            <!-- Env Column -->
            <ng-container matColumnDef="env">
              <th mat-header-cell *matHeaderCellDef>Env</th>
              <td mat-cell *matCellDef="let eval">
                <mat-chip [class]="'env-chip ' + eval.env">
                  {{ eval.env }}
                </mat-chip>
              </td>
            </ng-container>

            <!-- Integrity Column -->
            <ng-container matColumnDef="integrity">
              <th mat-header-cell *matHeaderCellDef>Integrity</th>
              <td mat-cell *matCellDef="let eval">
                <div class="integrity-cell" [matTooltip]="getIntegrityTooltip(eval)">
                  <mat-icon class="integrity-icon">verified</mat-icon>
                  <span class="hash-preview">{{ getInputHashPreview(eval) }}</span>
                </div>
              </td>
            </ng-container>

            <!-- Actions Column -->
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef>Actions</th>
              <td mat-cell *matCellDef="let eval">
                <button mat-button color="primary" (click)="viewEvaluation(eval.id)">
                  <mat-icon>visibility</mat-icon>
                  View
                </button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns" 
                class="evaluation-row"
                (click)="viewEvaluation(row.id)"></tr>
          </table>

          <!-- Empty State -->
          <div *ngIf="filteredEvaluations.length === 0" class="empty-state">
            <mat-icon>assessment</mat-icon>
            <h3>No evaluations found</h3>
            <p>Run your first evaluation to see it here.</p>
            <button mat-raised-button color="primary" routerLink="/ingest">
              <mat-icon>add</mat-icon>
              New Evaluation
            </button>
          </div>

          <!-- Paginator -->
          <mat-paginator
            *ngIf="filteredEvaluations.length > 0"
            [length]="totalEvaluations"
            [pageSize]="pageSize"
            [pageIndex]="pageIndex"
            [pageSizeOptions]="[10, 25, 50, 100]"
            (page)="onPageChange($event)"
            showFirstLastButtons>
          </mat-paginator>
        </mat-card>

        <!-- Summary Stats -->
        <mat-card *ngIf="!loading && evaluations.length > 0" class="stats-card">
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-value">{{ evaluations.length }}</span>
              <span class="stat-label">Total Evaluations</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ getAverageCoherence() | number:'1.0-0' }}</span>
              <span class="stat-label">Avg Coherence</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ getTotalIssues() }}</span>
              <span class="stat-label">Total Issues Found</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ getProductionCount() }}</span>
              <span class="stat-label">Production Runs</span>
            </div>
          </div>
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
    
    .filters-row {
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .search-field {
      flex: 1;
      min-width: 250px;
    }
    
    .env-filter, .score-filter {
      width: 150px;
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
    
    .source-cell {
      display: flex;
      flex-direction: column;
    }
    
    .source-title {
      font-weight: 500;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .source-id {
      font-size: 12px;
      color: #666;
      font-family: monospace;
    }
    
    .score-cell {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 8px;
      font-weight: bold;
      font-size: 18px;
    }
    
    .score-cell.high {
      background: #e8f5e9;
      color: #2e7d32;
    }
    
    .score-cell.medium {
      background: #fff3e0;
      color: #ef6c00;
    }
    
    .score-cell.low {
      background: #ffebee;
      color: #c62828;
    }
    
    .issues-cell {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    
    .issue-chip {
      font-size: 11px !important;
      min-height: 24px !important;
    }
    
    .issue-chip.critical {
      background: #ffcdd2 !important;
      color: #c62828 !important;
    }
    
    .issue-chip.warning {
      background: #ffe0b2 !important;
      color: #ef6c00 !important;
    }
    
    .no-issues {
      color: #4caf50;
      font-size: 13px;
    }
    
    .env-chip {
      font-size: 11px !important;
      min-height: 24px !important;
    }
    
    .env-chip.sandbox {
      background: #e3f2fd !important;
      color: #1565c0 !important;
    }
    
    .env-chip.production {
      background: #fce4ec !important;
      color: #c2185b !important;
    }
    
    .mode-chip {
      font-size: 11px !important;
      min-height: 24px !important;
    }
    
    .mode-chip mat-icon {
      font-size: 14px !important;
      width: 14px !important;
      height: 14px !important;
      margin-right: 4px !important;
    }
    
    .mode-chip.simulation {
      background: #ede7f6 !important;
      color: #5e35b1 !important;
    }
    
    .mode-chip.evaluation {
      background: #e8f5e9 !important;
      color: #2e7d32 !important;
    }
    
    .integrity-cell {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: help;
    }
    
    .integrity-icon {
      color: #4caf50;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    
    .hash-preview {
      font-family: monospace;
      font-size: 11px;
      color: #666;
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
  evaluations: EvaluationSummary[] = [];
  filteredEvaluations: EvaluationSummary[] = [];
  loading = true;
  
  // Filters
  searchQuery = '';
  envFilter = '';
  minCoherence = 0;
  
  // Pagination
  pageSize = 25;
  pageIndex = 0;
  totalEvaluations = 0;
  
  displayedColumns = ['date', 'source', 'coherence', 'issues', 'claims', 'mode', 'env', 'integrity', 'actions'];

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
      const response = await this.auditService.getEvaluations(this.pageSize, this.pageIndex * this.pageSize).toPromise();
      if (response?.evaluations) {
        this.evaluations = response.evaluations;
        this.totalEvaluations = response.total || response.evaluations.length;
        this.applyFilters();
      }
    } catch (error) {
      console.error('Failed to load evaluations:', error);
    } finally {
      this.loading = false;
    }
  }

  applyFilters() {
    this.filteredEvaluations = this.evaluations.filter(eval => {
      // Search filter
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        const matchesId = eval.id.toLowerCase().includes(query);
        const matchesConvId = eval.conversation_id?.toLowerCase().includes(query);
        const matchesTitle = this.getSourceTitle(eval).toLowerCase().includes(query);
        if (!matchesId && !matchesConvId && !matchesTitle) {
          return false;
        }
      }
      
      // Env filter
      if (this.envFilter && eval.env !== this.envFilter) {
        return false;
      }
      
      // Coherence filter
      const coherence = eval.scores?.spectral?.coherenceScore ?? 0;
      if (coherence < this.minCoherence) {
        return false;
      }
      
      return true;
    });
  }

  clearFilters() {
    this.searchQuery = '';
    this.envFilter = '';
    this.minCoherence = 0;
    this.applyFilters();
  }

  sortData(sort: Sort) {
    if (!sort.active || sort.direction === '') {
      return;
    }

    this.filteredEvaluations = [...this.filteredEvaluations].sort((a, b) => {
      const isAsc = sort.direction === 'asc';
      switch (sort.active) {
        case 'date':
          return this.compare(new Date(a.created_at).getTime(), new Date(b.created_at).getTime(), isAsc);
        case 'coherence':
          return this.compare(
            a.scores?.spectral?.coherenceScore ?? 0,
            b.scores?.spectral?.coherenceScore ?? 0,
            isAsc
          );
        default:
          return 0;
      }
    });
  }

  compare(a: number, b: number, isAsc: boolean): number {
    return (a < b ? -1 : 1) * (isAsc ? 1 : -1);
  }

  onPageChange(event: PageEvent) {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.loadEvaluations();
  }

  viewEvaluation(id: string) {
    this.router.navigate(['/evaluations', id]);
  }

  getSourceTitle(eval: EvaluationSummary): string {
    return eval.report?.source?.sourceTitle || 
           eval.report?.run?.inputHash?.substring(0, 8) || 
           'Untitled';
  }

  getScoreClass(score: number | undefined): string {
    if (score === undefined) return '';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  getInputHashPreview(eval: EvaluationSummary): string {
    const hash = eval.report?.run?.inputHash;
    return hash ? hash.substring(0, 8) : 'N/A';
  }

  getIntegrityTooltip(eval: EvaluationSummary): string {
    const run = eval.report?.run;
    if (!run) return 'No integrity data';
    return `Input Hash: ${run.inputHash || 'N/A'}\nConfig Hash: ${run.configHash || 'N/A'}\nEngine: ${run.engineVersion || 'N/A'}`;
  }

  getAverageCoherence(): number {
    if (this.evaluations.length === 0) return 0;
    const sum = this.evaluations.reduce((acc, e) => acc + (e.scores?.spectral?.coherenceScore ?? 0), 0);
    return sum / this.evaluations.length;
  }

  getTotalIssues(): number {
    return this.evaluations.reduce((acc, e) => {
      const contradicted = e.scores?.counts?.contradicted ?? 0;
      const ungrounded = e.scores?.counts?.ungrounded ?? 0;
      return acc + contradicted + ungrounded;
    }, 0);
  }

  getProductionCount(): number {
    return this.evaluations.filter(e => e.env === 'production').length;
  }

  isSimulation(eval: EvaluationSummary): boolean {
    return eval.report?.mode === 'SIMULATION';
  }

  getSimulationCount(): number {
    return this.evaluations.filter(e => this.isSimulation(e)).length;
  }
}

