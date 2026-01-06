import { Component, OnInit, ViewChild } from '@angular/core';
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
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppHeaderComponent } from '../shared/app-header.component';
import { IssuesService, IssueV2, IssueFilters } from '../issues.service';
import { IssueV2DetailModalComponent } from '../issue-v2-detail-modal/issue-v2-detail-modal.component';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-issues-list',
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
    MatCheckboxModule,
    MatMenuModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatDialogModule,
    MatSnackBarModule,
    MatDividerModule,
    AppHeaderComponent
  ],
  templateUrl: './issues-list.component.html',
  styleUrls: ['./issues-list.component.scss']
})
export class IssuesListComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  
  dataSource = new MatTableDataSource<IssueV2>([]);
  loading = false;
  total = 0;
  pageSize = 50;
  pageIndex = 0;
  
  // Filters
  filters: IssueFilters = {
    limit: 50,
    offset: 0
  };
  
  // Selected issues for bulk actions
  selectedIssues = new Set<string>();
  selectAll = false;
  
  // Filter options
  statusOptions = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'];
  severityOptions = ['low', 'medium', 'high'];
  verificationOptions = ['EXTERNAL_VERIFIED', 'TRANSCRIPT_ONLY', 'NONE'];
  categoryOptions: string[] = [];
  typeOptions: string[] = [];
  
  displayedColumns = [
    'select',
    'status',
    'severityDisplay',
    'impact',
    'verification',
    'riskScore',
    'issueSummary',
    'createdAt',
    'evaluation',
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
    this.loadIssues();
  }
  
  async loadIssues() {
    this.loading = true;
    try {
      const response = await this.issuesService.getIssues({
        ...this.filters,
        limit: this.pageSize,
        offset: this.pageIndex * this.pageSize
      }).toPromise();
      
      if (response) {
        this.dataSource.data = response.issues;
        this.total = response.total;
        
        // Extract unique categories and types for filter options
        const categories = new Set<string>();
        const types = new Set<string>();
        response.issues.forEach(issue => {
          if (issue.category) categories.add(issue.category);
          if (issue.type) types.add(issue.type);
        });
        this.categoryOptions = Array.from(categories).sort();
        this.typeOptions = Array.from(types).sort();
      }
    } catch (error: any) {
      console.error('Failed to load issues:', error);
      this.snackBar.open('Failed to load issues: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }
  
  applyFilters() {
    this.pageIndex = 0;
    this.loadIssues();
  }
  
  clearFilters() {
    this.filters = {
      limit: 50,
      offset: 0
    };
    this.applyFilters();
  }
  
  onPageChange(event: PageEvent) {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.loadIssues();
  }
  
  toggleSelectAll() {
    if (this.selectAll) {
      this.selectedIssues.clear();
    } else {
      this.dataSource.data.forEach(issue => {
        this.selectedIssues.add(issue.issueId);
      });
    }
    this.selectAll = !this.selectAll;
  }
  
  toggleSelect(issueId: string) {
    if (this.selectedIssues.has(issueId)) {
      this.selectedIssues.delete(issueId);
    } else {
      this.selectedIssues.add(issueId);
    }
    this.selectAll = this.selectedIssues.size === this.dataSource.data.length;
  }
  
  isSelected(issueId: string): boolean {
    return this.selectedIssues.has(issueId);
  }
  
  async bulkUpdateStatus(status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE') {
    if (this.selectedIssues.size === 0) {
      this.snackBar.open('Please select at least one issue', 'Close', { duration: 3000 });
      return;
    }
    
    try {
      const result = await this.issuesService.bulkAction(
        Array.from(this.selectedIssues),
        'status',
        { status }
      ).toPromise();
      
      if (result) {
        this.snackBar.open(`Updated ${result.results?.length || 0} issues`, 'Close', { duration: 3000 });
        this.selectedIssues.clear();
        this.selectAll = false;
        this.loadIssues();
      }
    } catch (error: any) {
      console.error('Bulk update failed:', error);
      this.snackBar.open('Failed to update issues: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  async bulkAssign(assigneeUserId: string | null) {
    if (this.selectedIssues.size === 0) {
      this.snackBar.open('Please select at least one issue', 'Close', { duration: 3000 });
      return;
    }
    
    try {
      const result = await this.issuesService.bulkAction(
        Array.from(this.selectedIssues),
        'assign',
        { assigneeUserId }
      ).toPromise();
      
      if (result) {
        this.snackBar.open(`Assigned ${result.results?.length || 0} issues`, 'Close', { duration: 3000 });
        this.selectedIssues.clear();
        this.selectAll = false;
        this.loadIssues();
      }
    } catch (error: any) {
      console.error('Bulk assign failed:', error);
      this.snackBar.open('Failed to assign issues: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  viewIssue(issue: IssueV2) {
    this.dialog.open(IssueV2DetailModalComponent, {
      width: '90%',
      maxWidth: '1200px',
      data: { issue, evaluation: { id: issue.evaluationId } }
    });
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
  
  getScore(issue: IssueV2): number {
    return issue.score ?? (issue.riskScore ?? 0) * 100;
  }
  
  exportIssue(issue: IssueV2) {
    const dataStr = JSON.stringify(issue, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `issue-${issue.issueId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.snackBar.open('Issue exported', 'Close', { duration: 2000 });
  }
  
  exportSelected(format: 'csv' | 'json' | 'pdf') {
    if (this.selectedIssues.size === 0) {
      this.snackBar.open('Please select at least one issue', 'Close', { duration: 3000 });
      return;
    }
    
    const selectedIssues = this.dataSource.data.filter(issue => this.selectedIssues.has(issue.issueId));
    
    if (format === 'json') {
      const dataStr = JSON.stringify(selectedIssues, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `issues-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.snackBar.open(`Exported ${selectedIssues.length} issues as JSON`, 'Close', { duration: 2000 });
    } else if (format === 'csv') {
      // Convert to CSV
      const headers = ['Issue ID', 'Type', 'Category', 'Severity', 'Impact', 'Score', 'Status', 'Verification', 'Summary', 'Created At'];
      const rows = selectedIssues.map(issue => [
        issue.issueId,
        issue.type || '',
        issue.category || '',
        issue.severityDisplay || issue.severity || '',
        issue.impact || '',
        this.getScore(issue).toString(),
        issue.status || 'OPEN',
        this.getVerificationLabel(issue.verification?.level || 'NONE'),
        issue.what?.issueSummary || '',
        issue.evaluationCreatedAt || issue.audit?.createdAt || ''
      ]);
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      
      const dataBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `issues-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      this.snackBar.open(`Exported ${selectedIssues.length} issues as CSV`, 'Close', { duration: 2000 });
    }
  }
  
  sendToJira(issue: IssueV2) {
    // TODO: Implement Jira integration
    this.snackBar.open('Jira integration coming soon', 'Close', { duration: 3000 });
  }
  
  sendToSalesforce(issue: IssueV2) {
    // TODO: Implement Salesforce integration
    this.snackBar.open('Salesforce integration coming soon', 'Close', { duration: 3000 });
  }
  
  sendToServiceNow(issue: IssueV2) {
    // TODO: Implement ServiceNow integration
    this.snackBar.open('ServiceNow integration coming soon', 'Close', { duration: 3000 });
  }
}

