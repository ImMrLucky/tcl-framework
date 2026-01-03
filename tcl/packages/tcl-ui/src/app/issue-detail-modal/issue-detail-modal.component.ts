import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
// IssueNarrative type - matches packages/tcl-core/src/types.ts
// Defined locally to avoid cross-package import path issues in TypeScript
interface IssueNarrative {
  issueId: string;
  category: string; // e.g., "BILLING"
  subcategory?: string; // e.g., "Cancellation Fees"
  title: string; // Human-friendly (no "discrepancy about X and Y")
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  scope: {
    turnRange: [number, number];
    claimIds: string[];
    speakerFocus: "AGENT" | "SYSTEM" | "CUSTOMER"; // Default "AGENT"
  };
  whatIsWrong: string; // 1–3 sentences, specific
  whyWrong: string[]; // Bullet reasons (policy/logic)
  whyItMatters: string[]; // Business impact bullets
  recommendedActions: Array<{
    type: "COACHING" | "PROCESS" | "COMPLIANCE" | "SYSTEM_FIX";
    action: string;
  }>;
  evidenceQuotes: Array<{
    quoteId: string;
    claimId: string;
    speaker: "Agent" | "Customer" | "System";
    turnIndex: number;
    lineSpan?: [number, number];
    text: string; // Exact quote (not truncated)
    evidenceRef?: {
      type: "Call" | "Policy" | "KB";
      ref: string;
    };
  }>;
  contradictionPairs?: Array<{
    claimAId: string;
    claimBId: string;
    score: number;
    explanation: string; // Auto-generated: "These cannot both be true because…"
    quoteIds: [string, string]; // References into evidenceQuotes
  }>;
  traceability: {
    topEdges: Array<{
      type: "support" | "contradiction" | "grounding";
      fromClaimId: string;
      toClaimId: string;
      weight: number;
      reason?: string;
    }>;
  };
  scoring: {
    riskScore: number; // 0–100 (configurable mapping)
    impactScore: number; // 0–100
    fixabilityScore: number; // 0–100
    compositeScore: number; // Used for ranking
    rationale: string[]; // Bullet explanation of score drivers
  };
}

// Legacy clustered issue type (for backward compatibility)
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
    @Inject(MAT_DIALOG_DATA) data: { issue: IssueData; isNarrative: boolean } | IssueData | null | undefined
  ) {
    // Handle new data format: { issue: IssueData, isNarrative: boolean }
    // or legacy format: IssueData directly
    let issueData: IssueData | null = null;
    
    if (data && typeof data === 'object') {
      if ('issue' in data && 'isNarrative' in data) {
        // New format
        issueData = (data as { issue: IssueData; isNarrative: boolean }).issue;
        this.isNarrative = (data as { issue: IssueData; isNarrative: boolean }).isNarrative;
      } else {
        // Legacy format - check if it's an IssueNarrative (has issueId and evidenceQuotes)
        issueData = data as IssueData;
        this.isNarrative = !!(issueData && typeof issueData === 'object' && 'issueId' in issueData && 'evidenceQuotes' in issueData);
      }
    }
    
    // Ensure issue is always defined, provide defaults if missing
    if (!issueData) {
      this.issue = this.getDefaultClustered();
      this.isNarrative = false;
    } else if (this.isNarrative) {
      this.issue = issueData as IssueNarrative;
    } else {
      this.issue = issueData as ClusteredIssue;
    }
    
    // Debug: log the issue data to see what we're receiving
    console.log('IssueDetailModal - Received data:', JSON.stringify(data, null, 2));
    console.log('IssueDetailModal - Extracted issue:', JSON.stringify(this.issue, null, 2));
    console.log('IssueDetailModal - Is narrative:', this.isNarrative);
    
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      console.log('IssueDetailModal - Narrative details:', {
        issueId: narrative.issueId,
        title: narrative.title,
        evidenceQuotesCount: narrative.evidenceQuotes?.length || 0,
        evidenceQuotes: narrative.evidenceQuotes,
        traceabilityEdgesCount: narrative.traceability?.topEdges?.length || 0,
        traceabilityEdges: narrative.traceability?.topEdges,
        scoring: narrative.scoring,
        contradictionPairsCount: narrative.contradictionPairs?.length || 0
      });
    } else {
      const clustered = this.issue as ClusteredIssue;
      console.log('IssueDetailModal - Clustered issue details:', {
        id: clustered.id,
        title: clustered.title,
        primaryEvidenceCount: clustered.primaryEvidence?.length || 0,
        primaryEvidence: clustered.primaryEvidence,
        metrics: clustered.metrics
      });
    }
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
    if (!this.issue) return [];
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
    if (!this.issue) return {};
    if (this.isNarrative) {
      return (this.issue as IssueNarrative).scoring || {};
    } else {
      return (this.issue as ClusteredIssue).metrics || {};
    }
  }

  // Helper to get title
  getTitle(): string {
    if (!this.issue) return 'Issue Details';
    return this.isNarrative 
      ? (this.issue as IssueNarrative).title || 'Issue Details'
      : (this.issue as ClusteredIssue).title || 'Issue Details';
  }

  // Helper to get problem statement/whatIsWrong
  getProblemStatement(): string {
    if (!this.issue) return 'No data available';
    return this.isNarrative 
      ? (this.issue as IssueNarrative).whatIsWrong || 'No data available'
      : (this.issue as ClusteredIssue).problemStatement || 'No data available';
  }

  // Helper to get whyWrong
  getWhyWrong(): string[] {
    if (!this.issue) return [];
    return this.isNarrative 
      ? (this.issue as IssueNarrative).whyWrong || []
      : (this.issue as ClusteredIssue).whyWrong || [];
  }

  // Helper to get whyItMatters/impact
  getWhyItMatters(): string[] {
    if (!this.issue) return [];
    if (this.isNarrative) {
      return (this.issue as IssueNarrative).whyItMatters || [];
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
    if (!this.issue) return [];
    if (this.isNarrative) {
      return (this.issue as IssueNarrative).recommendedActions || [];
    } else {
      const clustered = this.issue as ClusteredIssue;
      return (clustered.recommendedAction || []).map(action => ({ type: 'COACHING', action }));
    }
  }

  // Helper to get turn range
  getTurnRange(): string {
    if (!this.issue) return '';
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      const turnRange = narrative.scope?.turnRange;
      if (!turnRange) return '';
      const [min, max] = turnRange;
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

  // Helper to get confidence explanation
  getConfidenceExplanation(): string {
    if (!this.isNarrative) {
      const clustered = this.issue as ClusteredIssue;
      return clustered.confidenceExplanation || 'No explanation available.';
    }
    return 'Based on spectral analysis and evidence strength.';
  }

  // Helper to get contradiction pairs
  getContradictionPairs(): Array<{ claimAId: string; claimBId: string; score: number; explanation: string; quoteIds: [string, string] }> {
    if (!this.issue || !this.isNarrative) return [];
    const narrative = this.issue as IssueNarrative;
    return narrative.contradictionPairs || [];
  }

  // Helper to get claim count
  getClaimCount(): number {
    if (!this.issue) return 0;
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      return narrative.scope?.claimIds?.length || 0;
    } else {
      const clustered = this.issue as ClusteredIssue;
      return clustered.metrics?.claimCount || 0;
    }
  }

  // Helper to get traceability edges
  getTraceabilityEdges(): Array<{ type: string; fromClaimId: string; toClaimId: string; weight: number; reason?: string }> {
    if (!this.issue || !this.isNarrative) return [];
    const narrative = this.issue as IssueNarrative;
    return narrative.traceability?.topEdges || [];
  }

  // Helper to check if traceability exists
  hasTraceability(): boolean {
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      return !!(narrative.traceability && narrative.traceability.topEdges && narrative.traceability.topEdges.length > 0);
    }
    return false;
  }

  // Helper to get evidence text (works for both types)
  getEvidenceText(ev: any): string {
    if (this.isNarrative) {
      return ev.text || 'No quote available';
    } else {
      return ev.quote || 'No quote available';
    }
  }

  // Helper to get tags
  getTags(): string[] {
    if (!this.issue) return [];
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      // IssueNarrative doesn't have tags in the current spec, but check anyway
      return (narrative as any).tags || [];
    } else {
      const clustered = this.issue as ClusteredIssue;
      return clustered.tags || [];
    }
  }

  // Helper to check if has tags
  hasTags(): boolean {
    if (!this.issue) return false;
    if (this.isNarrative) {
      const narrative = this.issue as IssueNarrative;
      return !!((narrative as any).tags && (narrative as any).tags.length > 0);
    } else {
      const clustered = this.issue as ClusteredIssue;
      return !!(clustered.tags && clustered.tags.length > 0);
    }
  }

  // Helper to get flags
  getFlags(): { sensitiveData?: boolean; financialImpact?: boolean; policyConflict?: boolean; regulatoryRisk?: boolean } | null {
    if (!this.isNarrative) {
      const clustered = this.issue as ClusteredIssue;
      return clustered.flags || null;
    }
    return null;
  }

  // Helper to check if has flags
  hasFlags(): boolean {
    if (!this.isNarrative) {
      const clustered = this.issue as ClusteredIssue;
      return !!clustered.flags;
    }
    return false;
  }

  // Helper to get severity (safe access)
  getSeverity(): string {
    return this.issue?.severity || 'UNKNOWN';
  }

  // Helper to get confidence (safe access)
  getConfidence(): string {
    return this.issue?.confidence || 'UNKNOWN';
  }

  // Helper to get category (safe access)
  getCategory(): string | null {
    return this.issue?.category || null;
  }

  // Helper to get evidence ref
  getEvidenceRef(ev: any): string | null {
    return ev?.evidenceRef?.ref || null;
  }
}

