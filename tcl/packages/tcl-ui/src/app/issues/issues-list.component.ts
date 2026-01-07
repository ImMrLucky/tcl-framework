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
import { MatSidenavModule, MatDrawer } from '@angular/material/sidenav';
import { MatTabsModule } from '@angular/material/tabs';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { ActivatedRoute, Params } from '@angular/router';
import { AppHeaderComponent } from '../shared/app-header.component';
import { IssuesService, IssuePatternRow, IssuePatternDetail, QueueFilters } from '../issues.service';
import { IssuePatternOccurrence } from './issue.model';
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
  @ViewChild('drawer') drawer!: MatDrawer;
  
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
    private auditService: AuditService,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}
  
  ngOnInit() {
    // Set default date range (last 7 days)
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    
    // Load filters from query params or use defaults
    this.route.queryParams.subscribe(params => {
      const filterValues = {
        dateRange: params['dateRange'] || '7d',
        severity: params['severity'] || 'all',
        verification: params['verification'] || 'all',
        status: params['status'] || 'OPEN',
        type: params['type'] || 'all',
        category: params['category'] || 'all',
        assignee: params['assignee'] || 'all',
        q: params['q'] || '',
        from: params['from'] || from.toISOString().split('T')[0],
        to: params['to'] || to.toISOString().split('T')[0],
        hideResolved: params['hideResolved'] === 'true',
      };
      
      this.pageIndex = parseInt(params['page'] || '0');
      this.pageSize = parseInt(params['pageSize'] || '25');
      
      // Initialize form with values from query params
      this.filters = new FormGroup({
        dateRange: new FormControl(filterValues.dateRange),
        severity: new FormControl(filterValues.severity),
        verification: new FormControl(filterValues.verification),
        status: new FormControl(filterValues.status),
        type: new FormControl(filterValues.type),
        category: new FormControl(filterValues.category),
        assignee: new FormControl(filterValues.assignee),
        q: new FormControl(filterValues.q),
        from: new FormControl(filterValues.from),
        to: new FormControl(filterValues.to),
        hideResolved: new FormControl(filterValues.hideResolved),
      });
      
      // Debounce search (250ms as per spec)
      this.filters.get('q')?.valueChanges
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          this.pageIndex = 0;
          this.updateQueryParams();
          this.loadQueue();
        });
      
      // Watch other filter changes
      this.filters.valueChanges
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          if (this.filters.get('q')?.value === '') {
            this.pageIndex = 0;
            this.updateQueryParams();
            this.loadQueue();
          }
        });
      
      this.loadQueue();
    });
  }
  
  updateQueryParams() {
    const filterValues = this.filters.value;
    const params: Params = {};
    
    if (filterValues.dateRange !== '7d') params['dateRange'] = filterValues.dateRange;
    if (filterValues.severity !== 'all') params['severity'] = filterValues.severity;
    if (filterValues.verification !== 'all') params['verification'] = filterValues.verification;
    if (filterValues.status !== 'OPEN') params['status'] = filterValues.status;
    if (filterValues.type !== 'all') params['type'] = filterValues.type;
    if (filterValues.category !== 'all') params['category'] = filterValues.category;
    if (filterValues.assignee !== 'all') params['assignee'] = filterValues.assignee;
    if (filterValues.q) params['q'] = filterValues.q;
    if (filterValues.from) params['from'] = filterValues.from;
    if (filterValues.to) params['to'] = filterValues.to;
    if (filterValues.hideResolved) params['hideResolved'] = 'true';
    if (this.pageIndex > 0) params['page'] = this.pageIndex.toString();
    if (this.pageSize !== 25) params['pageSize'] = this.pageSize.toString();
    
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      replaceUrl: true
    });
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
        // Set end date to end of day (23:59:59) to include all records from that day
        toDate.setHours(23, 59, 59, 999);
        to = toDate.toISOString();
      } else if (dateRange === '30d') {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        from = fromDate.toISOString().split('T')[0];
        // Set end date to end of day (23:59:59) to include all records from that day
        toDate.setHours(23, 59, 59, 999);
        to = toDate.toISOString();
      } else if (dateRange === 'custom' && filterValues.from && filterValues.to) {
        from = filterValues.from;
        // For custom dates, if 'to' is just a date (YYYY-MM-DD), set it to end of day
        if (filterValues.to.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const toDate = new Date(filterValues.to + 'T23:59:59.999Z');
          to = toDate.toISOString();
        } else {
          to = filterValues.to;
        }
      }
      
      // Apply "Hide Resolved" filter
      let statusFilter = filterValues.status === 'all' ? undefined : filterValues.status;
      if (filterValues.hideResolved && !statusFilter) {
        statusFilter = 'OPEN'; // Default to OPEN if hiding resolved
      }
      
      const queueFilters: QueueFilters = {
        from,
        to,
        severity: filterValues.severity === 'all' ? undefined : filterValues.severity,
        verification: filterValues.verification === 'all' ? undefined : filterValues.verification,
        status: statusFilter,
        type: filterValues.type === 'all' ? undefined : filterValues.type,
        category: filterValues.category === 'all' ? undefined : filterValues.category,
        assignee: filterValues.assignee === 'all' ? undefined : filterValues.assignee,
        q: filterValues.q || undefined,
        page: this.pageIndex + 1,
        pageSize: this.pageSize,
      };
      
      // Use AuditService as per spec
      const response = await this.auditService.getIssueQueue(queueFilters).toPromise();
      
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
      const snackBarRef = this.snackBar.open('Failed to load issue queue: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }
  
  applyFilters() {
    this.pageIndex = 0;
    this.updateQueryParams();
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
    this.updateQueryParams();
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
      const snackBarRef = this.snackBar.open('Please select at least one pattern', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      return;
    }
    
    try {
      const updates = Array.from(this.selectedPatterns).map(patternKey =>
        this.issuesService.updatePattern(patternKey, { status }).toPromise()
      );
      await Promise.all(updates);
      
      const snackBarRef = this.snackBar.open(`Updated ${this.selectedPatterns.size} patterns`, 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.selectedPatterns.clear();
      this.selectAll = false;
      this.loadQueue();
    } catch (error: any) {
      console.error('Bulk update failed:', error);
      const snackBarRef = this.snackBar.open('Failed to update patterns: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }
  
  async bulkAssign(assigneeUserId: string | null) {
    if (this.selectedPatterns.size === 0) {
      const snackBarRef = this.snackBar.open('Please select at least one pattern', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      return;
    }
    
    try {
      const updates = Array.from(this.selectedPatterns).map(patternKey =>
        this.issuesService.updatePattern(patternKey, { assignee: assigneeUserId || null }).toPromise()
      );
      await Promise.all(updates);
      
      const snackBarRef = this.snackBar.open(`Assigned ${this.selectedPatterns.size} patterns`, 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.selectedPatterns.clear();
      this.selectAll = false;
      this.loadQueue();
    } catch (error: any) {
      console.error('Bulk assign failed:', error);
      const snackBarRef = this.snackBar.open('Failed to assign patterns: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }
  
  async viewPattern(pattern: IssuePatternRow) {
    console.log('viewPattern called with:', pattern);
    
    // Set the selected pattern key first
    this.selectedPatternKey = pattern.patternKey;
    
    // Open drawer immediately (two-way binding will handle it)
    this.drawerOpen = true;
    this.loadingDetail = true;
    
    // Use ChangeDetectorRef to ensure Angular detects the change
    // Force drawer to open using ViewChild reference after change detection
    setTimeout(() => {
      if (this.drawer) {
        console.log('Opening drawer via ViewChild, current state:', this.drawer.opened);
        if (!this.drawer.opened) {
          this.drawer.open();
        }
      } else {
        console.warn('Drawer ViewChild not found');
      }
    }, 100);
    
    try {
      // Load pattern detail from API
      console.log('Loading pattern detail for:', pattern.patternKey);
      const detail = await this.issuesService.getPatternDetail(pattern.patternKey).toPromise();
      console.log('Pattern detail loaded:', detail);
      console.log('Detail type:', typeof detail);
      console.log('Detail keys:', detail ? Object.keys(detail) : 'null');
      
      if (!detail) {
        console.error('Pattern detail is null or undefined');
        const snackBarRef = this.snackBar.open('Failed to load pattern detail: No data returned', 'Close', {
          duration: 5000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        this.loadingDetail = false;
        return;
      }
      
      // Ensure required fields are present (fallback to pattern row data if missing)
      this.patternDetail = {
        patternKey: detail.patternKey || pattern.patternKey,
        title: detail.title || pattern.title || 'Untitled Pattern',
        summary: detail.summary || pattern.summary || '',
        occurrences: detail.occurrences || pattern.occurrences || 0,
        verificationCounts: detail.verificationCounts || pattern.verificationCounts || {
          EXTERNAL_VERIFIED: 0,
          TRANSCRIPT_ONLY: 0,
          NONE: 0,
        },
        status: detail.status || pattern.status || 'OPEN',
        assignee: detail.assignee || pattern.assignee || null,
        firstSeenAt: detail.firstSeenAt || pattern.firstSeenAt || new Date().toISOString(),
        lastSeenAt: detail.lastSeenAt || pattern.lastSeenAt || new Date().toISOString(),
        occurrencesList: detail.occurrencesList || [],
        traceability: detail.traceability,
        scoring: detail.scoring,
        severityDisplay: detail.severityDisplay || pattern.severityDisplay || 'medium',
        priorityScore: detail.priorityScore || pattern.priorityScore || 0,
      } as IssuePatternDetail;
      
      console.log('Pattern detail after merge:', this.patternDetail);
      console.log('Has occurrencesList:', !!this.patternDetail.occurrencesList);
      console.log('OccurrencesList length:', this.patternDetail.occurrencesList?.length || 0);
    } catch (error: any) {
      console.error('Failed to load pattern detail:', error);
      const snackBarRef = this.snackBar.open('Failed to load pattern detail: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.patternDetail = null;
    } finally {
      this.loadingDetail = false;
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
      // Use AuditService as per spec
      await this.auditService.updatePattern(this.selectedPatternKey, { status }).toPromise();
      const snackBarRef = this.snackBar.open('Pattern status updated', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.loadQueue();
      if (this.patternDetail) {
        this.patternDetail.status = status as any;
      }
    } catch (error: any) {
      console.error('Failed to update pattern status:', error);
      const snackBarRef = this.snackBar.open('Failed to update status: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }
  
  async updatePatternAssignee(assignee: string | null) {
    if (!this.selectedPatternKey) return;
    
    try {
      await this.auditService.updatePattern(this.selectedPatternKey, { assignee }).toPromise();
      const snackBarRef = this.snackBar.open('Pattern assignee updated', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.loadQueue();
      if (this.patternDetail) {
        this.patternDetail.assignee = assignee;
      }
    } catch (error: any) {
      console.error('Failed to update pattern assignee:', error);
      const snackBarRef = this.snackBar.open('Failed to update assignee: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }
  
  viewEvaluation(evaluationId: string) {
    this.router.navigate(['/evaluations', evaluationId]);
  }
  
  copyPatternKey() {
    if (this.patternDetail?.patternKey) {
      navigator.clipboard.writeText(this.patternDetail.patternKey).then(() => {
        const snackBarRef = this.snackBar.open('Pattern key copied to clipboard', 'Close', { duration: 2000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      });
    }
  }
  
  updatePatternAssigneeFromInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = target.value?.trim() || null;
    if (value === 'Unassigned' || value === '') {
      this.updatePatternAssignee(null);
    } else {
      this.updatePatternAssignee(value);
    }
  }
  
  hasConflicts(): boolean {
    if (!this.patternDetail?.occurrencesList) return false;
    return this.patternDetail.occurrencesList.some(occ => 
      occ.tracePreview?.contradictionPairs && occ.tracePreview.contradictionPairs.length > 0
    );
  }
  
  getConflictsForOccurrence(occ: IssuePatternOccurrence): Array<{ claimA: string; claimB: string; weight: number }> {
    if (!occ.tracePreview?.contradictionPairs) return [];
    return occ.tracePreview.contradictionPairs.slice(0, 3);
  }
  
  hasEvidence(): boolean {
    if (!this.patternDetail?.occurrencesList) return false;
    return this.patternDetail.occurrencesList.some(occ => 
      occ.evidencePreview && occ.evidencePreview.length > 0
    );
  }
  
  getEvidenceForOccurrence(occ: IssuePatternOccurrence): Array<{ sourceType: string; quote: string; turnIndex?: number }> {
    return occ.evidencePreview || [];
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
    // Format as per spec: "External 0 • Transcript 0 • None 15"
    const parts: string[] = [];
    parts.push(`External ${counts.EXTERNAL_VERIFIED}`);
    parts.push(`Transcript ${counts.TRANSCRIPT_ONLY}`);
    parts.push(`None ${counts.NONE}`);
    return parts.join(' • ');
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
      // Set end date to end of day (23:59:59) to include all records from that day
      toDate.setHours(23, 59, 59, 999);
      to = toDate.toISOString();
    } else if (dateRange === '30d') {
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      from = fromDate.toISOString().split('T')[0];
      // Set end date to end of day (23:59:59) to include all records from that day
      toDate.setHours(23, 59, 59, 999);
      to = toDate.toISOString();
    } else if (dateRange === 'custom' && filterValues.from && filterValues.to) {
      from = filterValues.from;
      // For custom dates, if 'to' is just a date (YYYY-MM-DD), set it to end of day
      if (filterValues.to.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const toDate = new Date(filterValues.to + 'T23:59:59.999Z');
        to = toDate.toISOString();
      } else {
        to = filterValues.to;
      }
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
    const snackBarRef = this.snackBar.open(`Exporting queue as ${format.toUpperCase()}...`, 'Close', { duration: 2000 });
    snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
  }
  
  exportSelected(format: 'csv' | 'json') {
    if (this.selectedPatterns.size === 0) {
      const snackBarRef = this.snackBar.open('Please select at least one pattern', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
      const snackBarRef = this.snackBar.open(`Exported ${selectedPatterns.length} patterns as JSON`, 'Close', { duration: 2000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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
      const snackBarRef = this.snackBar.open(`Exported ${selectedPatterns.length} patterns as CSV`, 'Close', { duration: 2000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }
}

