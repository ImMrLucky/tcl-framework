/**
 * Batch Import Results Component
 * 
 * Displays results from a batch upload import with per-file status
 * and drilldown links to conversations/evaluations
 */

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AppHeaderComponent } from '../shared/app-header.component';
import { BatchUploadService, ImportDetail, ImportItem } from './batch-upload.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-batch-import-results',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTabsModule,
    FormsModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatSelectModule,
    AppHeaderComponent,
  ],
  templateUrl: './batch-import-results.component.html',
  styleUrls: ['./batch-import-results.component.scss']
})
export class BatchImportResultsComponent implements OnInit, OnDestroy {
  importId: string | null = null;
  importDetail: ImportDetail | null = null;
  importItems: ImportItem[] = [];
  loading = true;
  
  // Pagination
  pageSize = 50;
  pageIndex = 0;
  totalItems = 0;
  
  // Filtering
  statusFilter: string | null = null;
  
  // Table columns
  displayedColumns = ['source_name', 'status', 'conversation_id', 'evaluation_id', 'error', 'actions'];
  
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private batchUploadService: BatchUploadService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.route.params
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        this.importId = params['importId'];
        if (this.importId) {
          this.loadImport();
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadImport() {
    if (!this.importId) return;
    
    this.loading = true;
    try {
      // Load import detail
      const detailResponse = await firstValueFrom(this.batchUploadService.getImport(this.importId));
      this.importDetail = detailResponse.import;
      
      // Load items
      await this.loadItems();
    } catch (error: any) {
      this.snackBar.open('Failed to load import: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }

  async loadItems(cursor?: string) {
    if (!this.importId) return;
    
    try {
      const response = await firstValueFrom(
        this.batchUploadService.getImportItems(this.importId, cursor, this.pageSize)
      );
      
      this.importItems = response.items;
      this.totalItems = response.total;
    } catch (error: any) {
      this.snackBar.open('Failed to load items: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  onPageChange(event: PageEvent) {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    const cursor = String(this.pageIndex * this.pageSize);
    this.loadItems(cursor);
  }

  onStatusFilterChange() {
    this.pageIndex = 0;
    // TODO: Implement status filtering in API
    this.loadItems();
  }

  getStatusColor(status: string): 'primary' | 'accent' | 'warn' {
    switch (status) {
      case 'PARSED':
      case 'ANALYZED':
        return 'primary';
      case 'QUEUED_FOR_ANALYSIS':
        return 'accent';
      case 'FAILED':
        return 'warn';
      default:
        return 'accent';
    }
  }

  navigateToConversation(conversationId: string) {
    this.router.navigate(['/conversations', conversationId]);
  }

  navigateToEvaluation(evaluationId: string) {
    this.router.navigate(['/evaluations', evaluationId]);
  }

  getProgressPercentage(): number {
    if (!this.importDetail) return 0;
    const total = this.importDetail.total_files;
    if (total === 0) return 0;
    const completed = this.importDetail.parsed_transcripts + this.importDetail.failed_items;
    return Math.round((completed / total) * 100);
  }
}

