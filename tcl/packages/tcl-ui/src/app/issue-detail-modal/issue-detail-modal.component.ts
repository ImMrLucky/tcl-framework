import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';

// Issue Narrative type (QA-Manager Grade)
interface IssueNarrative {
  issueId: string;
  category: string;
  subcategory?: string;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  scope: {
    turnRange: [number, number];
    claimIds: string[];
    speakerFocus: 'AGENT' | 'SYSTEM' | 'CUSTOMER';
  };
  whatIsWrong: string;
  whyWrong: string[];
  whyItMatters: string[];
  recommendedActions: Array<{
    type: 'COACHING' | 'PROCESS' | 'COMPLIANCE' | 'SYSTEM_FIX';
    action: string;
  }>;
  evidenceQuotes: Array<{
    quoteId: string;
    claimId: string;
    speaker: 'Agent' | 'Customer' | 'System';
    turnIndex: number;
    lineSpan?: [number, number];
    text: string;
    evidenceRef?: {
      type: 'Call' | 'Policy' | 'KB';
      ref: string;
    };
  }>;
  contradictionPairs?: Array<{
    claimAId: string;
    claimBId: string;
    score: number;
    explanation: string;
    quoteIds: [string, string];
  }>;
  traceability: {
    topEdges: Array<{
      type: 'support' | 'contradiction' | 'grounding';
      fromClaimId: string;
      toClaimId: string;
      weight: number;
      reason?: string;
    }>;
  };
  scoring: {
    riskScore: number;
    impactScore: number;
    fixabilityScore: number;
    compositeScore: number;
    rationale: string[];
  };
}

// Legacy clustered issue type
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

type IssueData = IssueNarrative | ClusteredIssue;

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
  issue: IssueData;
  isNarrative: boolean = false;

  constructor(
    public dialogRef: MatDialogRef<IssueDetailModalComponent>,
    @Inject(MAT_DIALOG_DATA) data: IssueData
  ) {
    // Check if it's an IssueNarrative (has issueId and evidenceQuotes)
    this.isNarrative = !!(data && 'issueId' in data && 'evidenceQuotes' in data);
    
    // Ensure issue is always defined, provide defaults if missing
    if (this.isNarrative) {
      this.issue = data as IssueNarrative || this.getDefaultNarrative();
    } else {
      this.issue = data as ClusteredIssue || this.getDefaultClustered();
    }
    
    // Debug: log the issue data to see what we're receiving
    console.log('IssueDetailModal - Received issue data:', this.issue);
    console.log('IssueDetailModal - Is narrative:', this.isNarrative);
  }
  
  private getDefaultNarrative(): IssueNarrative {
    return {
      issueId: '',
      title: 'Issue Details',
      category: 'OTHER',
      severity: 'MEDIUM',
      confidence: 'MEDIUM',
      status: 'OPEN',
      scope: {
        turnRange: [0, 0],
        claimIds: [],
        speakerFocus: 'AGENT'
      },
      whatIsWrong: 'No data available',
      whyWrong: [],
      whyItMatters: [],
      recommendedActions: [],
      evidenceQuotes: [],
      traceability: {
        topEdges: []
      },
      scoring: {
        riskScore: 0,
        impactScore: 0,
        fixabilityScore: 0,
        compositeScore: 0,
        rationale: []
      }
    };
  }
  
  private getDefaultClustered(): ClusteredIssue {
    return {
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

  // Helper to check if evidence exists (works for both types)
  hasEvidence(): boolean {
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      return !!(narrative.evidenceQuotes && narrative.evidenceQuotes.length > 0);
    } else {
      const clustered = this.issue as ClusteredIssue;
      return !!(clustered.primaryEvidence && clustered.primaryEvidence.length > 0);
    }
  }

  // Helper to get evidence (works for both types)
  getEvidence(): any[] {
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      return narrative.evidenceQuotes || [];
    } else {
      const clustered = this.issue as ClusteredIssue;
      return clustered.primaryEvidence || [];
    }
  }

  // Helper to check if metrics exist
  hasMetrics(): boolean {
    if (this.isNarrative) {
      return !!(this.issue as IssueNarrative).scoring;
    } else {
      return !!(this.issue as ClusteredIssue).metrics;
    }
  }

  // Helper to get metrics/scoring (works for both types)
  getMetrics(): any {
    if (this.isNarrative) {
      return (this.issue as IssueNarrative).scoring;
    } else {
      return (this.issue as ClusteredIssue).metrics;
    }
  }

  // Helper to get title
  getTitle(): string {
    return this.isNarrative 
      ? (this.issue as IssueNarrative).title 
      : (this.issue as ClusteredIssue).title;
  }

  // Helper to get problem statement/whatIsWrong
  getProblemStatement(): string {
    return this.isNarrative 
      ? (this.issue as IssueNarrative).whatIsWrong 
      : (this.issue as ClusteredIssue).problemStatement;
  }

  // Helper to get whyWrong
  getWhyWrong(): string[] {
    return this.isNarrative 
      ? (this.issue as IssueNarrative).whyWrong 
      : (this.issue as ClusteredIssue).whyWrong;
  }

  // Helper to get whyItMatters/impact
  getWhyItMatters(): string[] {
    if (this.isNarrative) {
      return (this.issue as IssueNarrative).whyItMatters;
    } else {
      const clustered = this.issue as ClusteredIssue;
      return clustered.impact ? [clustered.impact] : [];
    }
  }

  // Helper to get subcategory
  getSubcategory(): string | null {
    if (this.isNarrative) {
      return (this.issue as IssueNarrative).subcategory || null;
    }
    return null;
  }

  // Helper to get recommended actions (normalized to consistent format)
  getRecommendedActions(): Array<{ type: string; action: string }> {
    if (this.isNarrative) {
      return (this.issue as IssueNarrative).recommendedActions;
    } else {
      const clustered = this.issue as ClusteredIssue;
      return clustered.recommendedAction.map(action => ({ type: 'COACHING', action }));
    }
  }

  // Helper to get turn range
  getTurnRange(): string {
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      const [min, max] = narrative.scope.turnRange;
      const minDisplay = min + 1;
      const maxDisplay = max + 1;
      if (minDisplay === maxDisplay) {
        return `Turn ${minDisplay}`;
      }
      return `Turns ${minDisplay}-${maxDisplay}`;
    } else {
      const clustered = this.issue as ClusteredIssue;
      if (!clustered.primaryEvidence || clustered.primaryEvidence.length === 0) {
        return '';
      }
      const turnIndices = clustered.primaryEvidence.map(ev => ev.turnIndex).sort((a, b) => a - b);
      const minTurn = turnIndices[0] + 1;
      const maxTurn = turnIndices[turnIndices.length - 1] + 1;
      if (minTurn === maxTurn) {
        return `Turn ${minTurn}`;
      }
      return `Turns ${minTurn}-${maxTurn}`;
    }
  }
}

