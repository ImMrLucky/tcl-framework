import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { IssuesService, IssuePatternDetail } from '../issues.service';
import { IssuePatternOccurrence } from './issue.model';

export interface PatternDetailModalData {
  patternKey: string;
  patternDetail: IssuePatternDetail | null;
  loading: boolean;
}

@Component({
  selector: 'app-pattern-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatCardModule,
    MatTabsModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './pattern-detail-modal.component.html',
  styleUrls: ['./pattern-detail-modal.component.scss']
})
export class PatternDetailModalComponent implements OnInit {
  patternDetail: IssuePatternDetail | null = null;
  loading = true;
  statusOptions = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'];
  
  // Table columns for occurrences
  displayedColumns = ['occurredAt', 'riskScore', 'verificationLevel', 'excerpt', 'actions'];

  constructor(
    public dialogRef: MatDialogRef<PatternDetailModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PatternDetailModalData,
    private issuesService: IssuesService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.patternDetail = data.patternDetail;
    this.loading = data.loading;
  }

  async ngOnInit() {
    // If pattern detail wasn't provided, load it
    if (!this.patternDetail && !this.loading) {
      this.loading = true;
      try {
        this.patternDetail = await this.issuesService.getPatternDetail(this.data.patternKey).toPromise() || null;
      } catch (error: any) {
        console.error('Failed to load pattern detail:', error);
        const snackBarRef = this.snackBar.open('Failed to load pattern detail: ' + (error.error?.error || error.message), 'Close', {
          duration: 5000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      } finally {
        this.loading = false;
      }
    } else if (this.patternDetail) {
      this.loading = false;
    }
  }

  close() {
    this.dialogRef.close();
  }

  async updateStatus(status: string) {
    if (!this.patternDetail) return;
    
    try {
      await this.issuesService.updatePattern(this.patternDetail.patternKey, { status }).toPromise();
      const snackBarRef = this.snackBar.open('Pattern status updated', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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

  async updateAssignee(assignee: string | null) {
    if (!this.patternDetail) return;
    
    try {
      await this.issuesService.updatePattern(this.patternDetail.patternKey, { assignee }).toPromise();
      const snackBarRef = this.snackBar.open('Pattern assignee updated', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
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

  updateAssigneeFromInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = target.value?.trim() || null;
    if (value === 'Unassigned' || value === '') {
      this.updateAssignee(null);
    } else {
      this.updateAssignee(value);
    }
  }

  viewEvaluation(evaluationId: string) {
    this.router.navigate(['/evaluations', evaluationId]);
    this.close();
  }

  copyPatternKey() {
    if (this.patternDetail?.patternKey) {
      navigator.clipboard.writeText(this.patternDetail.patternKey).then(() => {
        const snackBarRef = this.snackBar.open('Pattern key copied to clipboard', 'Close', { duration: 2000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      });
    }
  }

  // Helper methods for display
  getSeverityColor(severity: string): string {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'critical';
      case 'high': return 'high';
      case 'medium': return 'medium';
      case 'low': return 'low';
      default: return 'medium';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'RESOLVED': return 'resolved';
      case 'ACKNOWLEDGED': return 'acknowledged';
      case 'FALSE_POSITIVE': return 'false-positive';
      default: return 'open';
    }
  }

  getVerificationLabel(level: string): string {
    switch (level) {
      case 'EXTERNAL_VERIFIED': return 'Verified';
      case 'TRANSCRIPT_ONLY': return 'Unverified (Transcript-only)';
      case 'NONE': return 'No Verification';
      default: return level;
    }
  }

  formatDate(date: string): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  }

  formatRelativeTime(date: string): string {
    if (!date) return 'N/A';
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return then.toLocaleDateString();
  }

  getScore(occurrence: IssuePatternOccurrence): number {
    return occurrence.score ?? Math.round((occurrence.riskScore ?? 0) * 100);
  }

  getVerificationMix(): string {
    if (!this.patternDetail) return '';
    const counts = this.patternDetail.verificationCounts;
    const parts: string[] = [];
    if (counts.EXTERNAL_VERIFIED > 0) parts.push(`External ${counts.EXTERNAL_VERIFIED}`);
    if (counts.TRANSCRIPT_ONLY > 0) parts.push(`Transcript ${counts.TRANSCRIPT_ONLY}`);
    if (counts.NONE > 0) parts.push(`None ${counts.NONE}`);
    return parts.join(' • ') || 'None';
  }

  hasConflicts(occurrence: IssuePatternOccurrence): boolean {
    return !!(occurrence.tracePreview?.contradictionPairs && occurrence.tracePreview.contradictionPairs.length > 0);
  }

  getConflictsForOccurrence(occurrence: IssuePatternOccurrence): Array<{ claimA: string; claimB: string; weight: number }> {
    return occurrence.tracePreview?.contradictionPairs || [];
  }

  hasEvidence(occurrence: IssuePatternOccurrence): boolean {
    return !!(occurrence.evidencePreview && occurrence.evidencePreview.length > 0);
  }

  getEvidenceForOccurrence(occurrence: IssuePatternOccurrence): Array<{ sourceType: string; quote: string; turnIndex?: number }> {
    return occurrence.evidencePreview || [];
  }
}

