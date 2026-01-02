import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';

// Issue type matching the component
interface ClusteredIssue {
  id: string;
  title: string;
  category: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  problemStatement: string;
  whyWrong: string[];
  impact: string;
  recommendedAction: string[];
  confidenceExplanation: string;
  primaryEvidence: Array<{
    speaker: string;
    quote: string;
    turnIndex: number;
    timestampMs?: number;
    claimId: string;
  }>;
  metrics: {
    contradictionMass: number;
    supportMass: number;
    groundingMass: number;
    centrality: number;
    claimCount: number;
    turnSpan: number;
    riskScore: number;
    rank: number;
    drivers: string[];
  };
  tags: string[];
  flags?: {
    sensitiveData?: boolean;
    financialImpact?: boolean;
    policyConflict?: boolean;
    regulatoryRisk?: boolean;
  };
}

@Component({
  selector: 'app-issue-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatCardModule,
    MatTabsModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule
  ],
  templateUrl: './issue-detail-modal.component.html',
  styleUrls: ['./issue-detail-modal.component.scss']
})
export class IssueDetailModalComponent {
  issue: ClusteredIssue;

  constructor(
    public dialogRef: MatDialogRef<IssueDetailModalComponent>,
    @Inject(MAT_DIALOG_DATA) data: ClusteredIssue
  ) {
    // Ensure issue is always defined, provide defaults if missing
    this.issue = data || {
      id: '',
      title: 'Issue Details',
      category: 'OTHER',
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      problemStatement: 'No data available',
      whyWrong: [],
      impact: 'No impact description',
      recommendedAction: [],
      confidenceExplanation: 'No explanation available',
      primaryEvidence: [],
      metrics: {
        contradictionMass: 0,
        supportMass: 0,
        groundingMass: 0,
        centrality: 0,
        claimCount: 0,
        turnSpan: 0,
        riskScore: 0,
        rank: 0,
        drivers: []
      },
      tags: []
    };
    
    // Debug: log the issue data to see what we're receiving
    console.log('IssueDetailModal - Received issue data:', this.issue);
    console.log('IssueDetailModal - primaryEvidence:', this.issue.primaryEvidence);
    console.log('IssueDetailModal - metrics:', this.issue.metrics);
  }

  getSeverityColor(severity: string): string {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return '#991b1b';
      case 'HIGH': return '#ea580c';
      case 'MEDIUM': return '#2563eb';
      case 'LOW': return '#16a34a';
      default: return '#6b7280';
    }
  }

  getSeverityBgColor(severity: string): string {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return '#fee2e2';
      case 'HIGH': return '#fef3c7';
      case 'MEDIUM': return '#e0e7ff';
      case 'LOW': return '#d1fae5';
      default: return '#f3f4f6';
    }
  }

  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      'BILLING': 'Billing',
      'DISCLOSURE': 'Disclosure',
      'MISREPRESENTATION': 'Misrepresentation',
      'PRIVACY': 'Privacy',
      'SECURITY': 'Security',
      'PROCESS': 'Process',
      'CUSTOMER_HARM': 'Customer Harm',
      'REGULATORY': 'Regulatory',
      'PROMISE_BREACH': 'Promise Breach',
      'OTHER': 'Other'
    };
    return labels[category] || category;
  }

  getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      'BILLING': 'payments',
      'DISCLOSURE': 'visibility_off',
      'MISREPRESENTATION': 'warning',
      'PRIVACY': 'lock',
      'SECURITY': 'security',
      'PROCESS': 'account_tree',
      'CUSTOMER_HARM': 'person_off',
      'REGULATORY': 'gavel',
      'PROMISE_BREACH': 'handshake',
      'OTHER': 'help_outline'
    };
    return icons[category] || 'help_outline';
  }

  close(): void {
    this.dialogRef.close();
  }

  // Helper to check if evidence exists
  hasEvidence(): boolean {
    return !!(this.issue.primaryEvidence && this.issue.primaryEvidence.length > 0);
  }

  // Helper to check if metrics exist
  hasMetrics(): boolean {
    return !!this.issue.metrics;
  }
}

