import { Component, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginatorModule, PageEvent, MatPaginator } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { FormsModule, FormGroup, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTabsModule } from '@angular/material/tabs';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { AppHeaderComponent } from '../shared/app-header.component';
import { IssuesService, IssuePatternRow, IssuePatternDetail, QueueFilters } from '../issues.service';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-issues-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
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
    MatCheckboxModule,
    MatMenuModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatDialogModule,
    MatSnackBarModule,
    MatDividerModule,
    MatSidenavModule,
    MatTabsModule,
    AppHeaderComponent
  ],
  templateUrl: './issues-list.component.html',
  styleUrls: ['./issues-list.component.scss']
})
export class IssuesListComponent implements OnInit, OnDestroy {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild('drawer') drawer!: any; // MatDrawer from MatSidenavModule
  
  private destroy$ = new Subject<void>();
  
  dataSource = new MatTableDataSource<IssuePatternRow>([]);
  loading = false;
  total = 0;
  pageSize = 25;
  pageIndex = 0;
  
  // Filters (queue API format)
  filters!: FormGroup;
  
  // Selected patterns for bulk actions
  selectedPatterns = new Set<string>();
  selectAll = false;
  
  // Filter options
  statusOptions = ['all', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'];
  severityOptions = ['all', 'low', 'medium', 'high', 'critical'];
  verificationOptions = ['all', 'EXTERNAL_VERIFIED', 'TRANSCRIPT_ONLY', 'NONE'];
  categoryOptions: string[] = [];
  typeOptions: string[] = [];
  
  // Drawer state
  selectedPatternKey: string | null = null;
  patternDetail: IssuePatternDetail | null = null;
  drawerOpen = false;
  loadingDetail = false;
  
  displayedColumns = [
    'select',
    'status',
    'pattern',
    'impact',
    'severityDisplay',
    'verificationMix',
    'occurrences',
    'trend',
    'lastSeen',
    'assignee',
    'priorityScore',
    'actions'
  ];
  
  constructor(
    private issuesService: IssuesService,
    private authService: AuthService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}
  
  ngOnInit() {
    // Set default date range (last 7 days)
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    
    // Initialize form with default values
    this.filters = new FormGroup({
      dateRange: new FormControl('7d'),
      severity: new FormControl('all'),
      verification: new FormControl('all'),
      status: new FormControl('OPEN'),
      type: new FormControl('all'),
      category: new FormControl('all'),
      assignee: new FormControl('all'),
      q: new FormControl(''),
      from: new FormControl(from.toISOString().split('T')[0]),
      to: new FormControl(to.toISOString().split('T')[0]),
    });
    
    // Debounce search
    this.filters.get('q')?.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.pageIndex = 0;
        this.loadQueue();
      });
    
    // Watch other filter changes
    this.filters.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.filters.get('q')?.value === '') {
          this.pageIndex = 0;
          this.loadQueue();
        }
      });
    
    this.loadQueue();
  }
  
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  async loadQueue() {
    this.loading = true;
    try {
      const filterValues = this.filters.value;
      const dateRange = filterValues.dateRange || '7d';
      
      // Calculate date range
      let from: string | undefined;
      let to: string | undefined;
      if (dateRange === '7d') {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 7);
        from = fromDate.toISOString().split('T')[0];
        to = toDate.toISOString().split('T')[0];
      } else if (dateRange === '30d') {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        from = fromDate.toISOString().split('T')[0];
        to = toDate.toISOString().split('T')[0];
      } else if (dateRange === 'custom' && filterValues.from && filterValues.to) {
        from = filterValues.from;
        to = filterValues.to;
      }
      
      const queueFilters: QueueFilters = {
        from,
        to,
        severity: filterValues.severity === 'all' ? undefined : filterValues.severity,
        verification: filterValues.verification === 'all' ? undefined : filterValues.verification,
        status: filterValues.status === 'all' ? undefined : filterValues.status,
        type: filterValues.type === 'all' ? undefined : filterValues.type,
        category: filterValues.category === 'all' ? undefined : filterValues.category,
        assignee: filterValues.assignee === 'all' ? undefined : filterValues.assignee,
        q: filterValues.q || undefined,
        page: this.pageIndex + 1,
        pageSize: this.pageSize,
      };
      
      const response = await this.issuesService.getIssueQueue(queueFilters).toPromise();
      
      if (response) {
        this.dataSource.data = response.rows;
        this.total = response.total;
        
        // Extract unique categories and types for filter options
        const categories = new Set<string>();
        const types = new Set<string>();
        response.rows.forEach(row => {
          if (row.category) categories.add(row.category);
          if (row.type) types.add(row.type);
        });
        this.categoryOptions = Array.from(categories).sort();
        this.typeOptions = Array.from(types).sort();
      }
    } catch (error: any) {
      console.error('Failed to load issue queue:', error);
      this.snackBar.open('Failed to load issue queue: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }
  
  applyFilters() {
    this.pageIndex = 0;
    this.loadQueue();
  }
  
  clearFilters() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    this.filters.patchValue({
      dateRange: '7d',
      severity: 'all',
      verification: 'all',
      status: 'OPEN',
      type: 'all',
      category: 'all',
      assignee: 'all',
      q: '',
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
    });
    this.applyFilters();
  }
  
  onPageChange(event: PageEvent) {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.loadQueue();
  }
  
  toggleSelectAll() {
    if (this.selectAll) {
      this.selectedPatterns.clear();
    } else {
      this.dataSource.data.forEach(pattern => {
        this.selectedPatterns.add(pattern.patternKey);
      });
    }
    this.selectAll = !this.selectAll;
  }
  
  toggleSelect(patternKey: string) {
    if (this.selectedPatterns.has(patternKey)) {
      this.selectedPatterns.delete(patternKey);
    } else {
      this.selectedPatterns.add(patternKey);
    }
    this.selectAll = this.selectedPatterns.size === this.dataSource.data.length;
  }
  
  isSelected(patternKey: string): boolean {
    return this.selectedPatterns.has(patternKey);
  }
  
  async bulkUpdateStatus(status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE') {
    if (this.selectedPatterns.size === 0) {
      this.snackBar.open('Please select at least one pattern', 'Close', { duration: 3000 });
      return;
    }
    
    try {
      const updates = Array.from(this.selectedPatterns).map(patternKey =>
        this.issuesService.updatePattern(patternKey, { status }).toPromise()
      );
      await Promise.all(updates);
      
      this.snackBar.open(`Updated ${this.selectedPatterns.size} patterns`, 'Close', { duration: 3000 });
      this.selectedPatterns.clear();
      this.selectAll = false;
      this.loadQueue();
    } catch (error: any) {
      console.error('Bulk update failed:', error);
      this.snackBar.open('Failed to update patterns: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  async bulkAssign(assigneeUserId: string | null) {
    if (this.selectedPatterns.size === 0) {
      this.snackBar.open('Please select at least one pattern', 'Close', { duration: 3000 });
      return;
    }
    
    try {
      const updates = Array.from(this.selectedPatterns).map(patternKey =>
        this.issuesService.updatePattern(patternKey, { assignee: assigneeUserId || null }).toPromise()
      );
      await Promise.all(updates);
      
      this.snackBar.open(`Assigned ${this.selectedPatterns.size} patterns`, 'Close', { duration: 3000 });
      this.selectedPatterns.clear();
      this.selectAll = false;
      this.loadQueue();
    } catch (error: any) {
      console.error('Bulk assign failed:', error);
      this.snackBar.open('Failed to assign patterns: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  async viewPattern(pattern: IssuePatternRow) {
    this.selectedPatternKey = pattern.patternKey;
    this.drawerOpen = true;
    this.loadingDetail = true;
    
    try {
      this.patternDetail = await this.issuesService.getPatternDetail(pattern.patternKey).toPromise() || null;
    } catch (error: any) {
      console.error('Failed to load pattern detail:', error);
      this.snackBar.open('Failed to load pattern detail: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loadingDetail = false;
    }
    
    // Open drawer if not already open
    if (this.drawer && !this.drawer.opened) {
      this.drawer.open();
    }
  }
  
  closeDrawer() {
    this.drawerOpen = false;
    if (this.drawer) {
      this.drawer.close();
    }
    this.selectedPatternKey = null;
    this.patternDetail = null;
  }
  
  async updatePatternStatus(status: string) {
    if (!this.selectedPatternKey) return;
    
    try {
      await this.issuesService.updatePattern(this.selectedPatternKey, { status }).toPromise();
      this.snackBar.open('Pattern status updated', 'Close', { duration: 3000 });
      this.loadQueue();
      if (this.patternDetail) {
        this.patternDetail.status = status as any;
      }
    } catch (error: any) {
      console.error('Failed to update pattern status:', error);
      this.snackBar.open('Failed to update status: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  viewEvaluation(evaluationId: string) {
    this.router.navigate(['/evaluations', evaluationId]);
  }
  
  getSeverityColor(severity: string | undefined): string {
    if (!severity) return '';
    switch (severity.toLowerCase()) {
      case 'critical': return 'critical';
      case 'high': return 'high';
      case 'medium': return 'medium';
      case 'low': return 'low';
      default: return '';
    }
  }
  
  getVerificationLabel(level: string): string {
    if (level === 'TRANSCRIPT_ONLY') return 'Transcript-only';
    if (level === 'EXTERNAL_VERIFIED') return 'Verified';
    return 'Unverified';
  }
  
  getVerificationTooltip(level: string): string {
    if (level === 'TRANSCRIPT_ONLY') {
      return 'This issue is based on transcript content only and has not been verified against external evidence (policies, system records, etc.).';
    }
    if (level === 'EXTERNAL_VERIFIED') {
      return 'This issue has been verified against external evidence sources (policies, documents, system records).';
    }
    return 'This issue has no grounding evidence and requires investigation.';
  }
  
  getStatusColor(status: string | undefined): string {
    if (!status) return '';
    switch (status) {
      case 'OPEN': return 'open';
      case 'ACKNOWLEDGED': return 'acknowledged';
      case 'RESOLVED': return 'resolved';
      case 'FALSE_POSITIVE': return 'false-positive';
      default: return '';
    }
  }
  
  formatDate(date: string | undefined): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString() + ' ' + new Date(date).toLocaleTimeString();
  }
  
  getScore(pattern: IssuePatternRow): number {
    return Math.round(pattern.avgRiskScore * 100);
  }
  
  getTrendIcon(trend: IssuePatternRow['trend']): string {
    if (trend.direction === 'up') return 'trending_up';
    if (trend.direction === 'down') return 'trending_down';
    return 'trending_flat';
  }
  
  getTrendColor(trend: IssuePatternRow['trend']): string {
    if (trend.direction === 'up') return 'trend-up';
    if (trend.direction === 'down') return 'trend-down';
    return 'trend-flat';
  }
  
  formatRelativeTime(date: string): string {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return then.toLocaleDateString();
  }
  
  getVerificationMixLabel(counts: IssuePatternRow['verificationCounts']): string {
    const total = counts.EXTERNAL_VERIFIED + counts.TRANSCRIPT_ONLY + counts.NONE;
    if (total === 0) return 'N/A';
    const verified = counts.EXTERNAL_VERIFIED;
    const transcript = counts.TRANSCRIPT_ONLY;
    const parts: string[] = [];
    if (verified > 0) parts.push(`${verified}V`);
    if (transcript > 0) parts.push(`${transcript}T`);
    if (counts.NONE > 0) parts.push(`${counts.NONE}U`);
    return parts.join('/');
  }
  
  exportQueue(format: 'csv' | 'json') {
    const filterValues = this.filters.value;
    const dateRange = filterValues.dateRange || '7d';
    
    let from: string | undefined;
    let to: string | undefined;
    if (dateRange === '7d') {
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      from = fromDate.toISOString().split('T')[0];
      to = toDate.toISOString().split('T')[0];
    } else if (dateRange === '30d') {
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      from = fromDate.toISOString().split('T')[0];
      to = toDate.toISOString().split('T')[0];
    } else if (dateRange === 'custom' && filterValues.from && filterValues.to) {
      from = filterValues.from;
      to = filterValues.to;
    }
    
    const queueFilters: QueueFilters = {
      from,
      to,
      severity: filterValues.severity === 'all' ? undefined : filterValues.severity,
      verification: filterValues.verification === 'all' ? undefined : filterValues.verification,
      status: filterValues.status === 'all' ? undefined : filterValues.status,
      type: filterValues.type === 'all' ? undefined : filterValues.type,
      category: filterValues.category === 'all' ? undefined : filterValues.category,
      assignee: filterValues.assignee === 'all' ? undefined : filterValues.assignee,
      q: filterValues.q || undefined,
    };
    
    const url = this.issuesService.exportQueue(format, queueFilters);
    window.open(url, '_blank');
    this.snackBar.open(`Exporting queue as ${format.toUpperCase()}...`, 'Close', { duration: 2000 });
  }
  
  exportSelected(format: 'csv' | 'json') {
    if (this.selectedPatterns.size === 0) {
      this.snackBar.open('Please select at least one pattern', 'Close', { duration: 3000 });
      return;
    }
    
    const selectedPatterns = this.dataSource.data.filter(p => this.selectedPatterns.has(p.patternKey));
    
    if (format === 'json') {
      const dataStr = JSON.stringify(selectedPatterns, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `issue-patterns-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.snackBar.open(`Exported ${selectedPatterns.length} patterns as JSON`, 'Close', { duration: 2000 });
    } else if (format === 'csv') {
      const headers = ['Pattern Key', 'Title', 'Category', 'Type', 'Occurrences', 'Avg Risk', 'Priority Score', 'Status', 'Last Seen'];
      const rows = selectedPatterns.map(p => [
        p.patternKey,
        p.title,
        p.category,
        p.type,
        p.occurrences.toString(),
        p.avgRiskScore.toFixed(2),
        p.priorityScore.toString(),
        p.status,
        p.lastSeenAt
      ]);
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      
      const dataBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `issue-patterns-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      this.snackBar.open(`Exported ${selectedPatterns.length} patterns as CSV`, 'Close', { duration: 2000 });
    }
  }
}

