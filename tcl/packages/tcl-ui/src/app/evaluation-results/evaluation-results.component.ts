import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuditService, Evaluation, Issue } from '../audit.service';
import { EvidenceViewerComponent } from '../evidence-viewer/evidence-viewer.component';
import { SimulationDialogComponent, SimulationModifications } from '../simulation-dialog/simulation-dialog.component';
import { IssueDetailModalComponent } from '../issue-detail-modal/issue-detail-modal.component';
import { IssueV2DetailModalComponent } from '../issue-v2-detail-modal/issue-v2-detail-modal.component';
import { SensitiveActionService } from '../sensitive-action.service';

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

// IssueV2 type (Enterprise-Grade)
interface IssueV2 {
  issueId: string;
  issueKey: string;
  runId: string;
  conversationId: string;
  type: 'CONTRADICTION' | 'UNVERIFIED_CLAIM' | 'UNSUPPORTED_CLAIM' | 'NUMERIC_MISMATCH' | 'COMMITMENT_INCONSISTENCY' | 'FEE_DISCLOSURE_RISK' | 'DATA_INTEGRITY' | 'OTHER';
  category: 'evidence' | 'consistency' | 'compliance' | 'billing' | 'disclosure' | 'data_integrity' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityDisplay?: 'low' | 'medium' | 'high'; // What UI shows (capped in transcript-only)
  impact?: 'low' | 'medium' | 'high'; // How bad if true (not affected by mode)
  riskScore: number;
  score?: number; // Numeric for sorting (0..100)
  confidence: number;
  reviewRequired: boolean;
  verification: {
    level: 'EXTERNAL_VERIFIED' | 'TRANSCRIPT_ONLY' | 'NONE';
    reasonCodes: string[];
  };
  scoring?: {
    components: {
      impact01: number;
      evidence01: number;
      signal01: number;
      category01: number;
    };
    weights: {
      impact: number;
      evidence: number;
      signal: number;
      category: number;
    };
    reasons: string[];
  };
  who: {
    speaker: 'AGENT' | 'CUSTOMER' | 'SYSTEM' | 'UNKNOWN';
    turnIndex?: number;
  };
  what: {
    primaryClaimId: string;
    relatedClaimIds?: string[];
    claimText?: string;
    issueSummary: string;
    issueDetail: string;
  };
  evidence: {
    refs: Array<{
      sourceType: 'TRANSCRIPT' | 'POLICY' | 'DOC' | 'SYSTEM_FACT';
      sourceId: string;
      quote: string;
      weight?: number;
      turnIndex?: number;
    }>;
    edges?: Array<{
      kind: 'grounding' | 'support' | 'contradiction';
      claimA: string;
      claimB?: string;
      weight: number;
    }>;
  };
  compliance: {
    tags: string[];
    impactedPolicies?: Array<{ policyId: string; section?: string }>;
    legalHoldSuggested?: boolean;
    disclaimers: string[];
  };
  audit: {
    createdAt: string;
    engineVersion: string;
    scorerId: string;
    modelFingerprint?: any;
    configHash?: string;
    inputHash?: string;
  };
}

interface IssueSummaryV2 {
  totalIssues: number;
  byType: Record<string, number>;
  bySeverity: Record<'low' | 'medium' | 'high' | 'critical', number>;
  byCategory: Record<string, number>;
  topIssuesCount: number;
  allIssuesCount: number;
}

// G2: Aggregated Issue (Cluster) type
interface AggregatedIssue {
  clusterId: string;
  clusterKey: string;
  category: string;
  type: string;
  title: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  occurrences: number;
  firstTurnIndex: number;
  lastTurnIndex: number;
  verification: {
    level: 'EXTERNAL_VERIFIED' | 'TRANSCRIPT_ONLY' | 'NONE';
    reasonCodes: string[];
  };
  reviewRequired: boolean;
  evidence: {
    refs: any[];
    edges: any[];
    atomicIssueIds: string[];
    claimIds: string[];
  };
  scoring: {
    components: {
      impact01: number;
      signal01: number;
      evidence01: number;
      category01: number;
      clusterPenalty01: number;
      verificationMultiplier: number;
    };
    reasons: string[];
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
  relatedClaimIds?: string[];
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

interface IssueSummary {
  totalIssues: number;
  bySeverity: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  byCategory: Record<string, number>;
  primaryRiskCategories: string[];
  auditReady: boolean;
}

@Component({
  selector: 'app-evaluation-results',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    MatDialogModule,
    MatSnackBarModule,
    MatSelectModule,
    MatProgressBarModule,
    MatExpansionModule,
    MatDividerModule,
    MatTabsModule,
    MatPaginatorModule,
    AppHeaderComponent
  ],
  templateUrl: './evaluation-results.component.html',
  styleUrls: ['./evaluation-results.component.scss']
})
export class EvaluationResultsComponent implements OnInit {
  evaluationId: string = '';
  evaluation: Evaluation | null = null;
  loading = true;
  errorMessage = '';

  // PART 1: Fixed displayedColumns to match HTML column definitions exactly
  displayedColumns: string[] = [
    'severity',
    'issueType',
    'claim',
    'speaker',
    'where',
    'evidence',
    'importance',
    'status',
    'actions'
  ];
  
  topOffenders: Array<{ claimId: string; text: string; nodeBlameNorm: number }> = [];
  topContradictions: Array<{ claimAId: string; claimBId: string; weight: number }> = [];
  topSupports: Array<{ claimAId: string; claimBId: string; weight: number }> = [];
  
  // IssueV2 (Enterprise-Grade) - Only view
  allIssuesV2: IssueV2[] = [];
  topIssuesV2: IssueV2[] = [];
  issueSummaryV2: IssueSummaryV2 | null = null;
  
  // G2: Issue Clusters (Top Aggregated Issues)
  issueClustersV2: {
    clusters: AggregatedIssue[];
    topClusters: AggregatedIssue[];
  } | null = null;
  
  // Pagination for top issues
  paginatedTopIssues: IssueV2[] = [];
  pageSize = 10;
  pageIndex = 0;
  pageSizeOptions = [5, 10, 25, 50];
  
  // Pagination for top clusters
  paginatedTopClusters: AggregatedIssue[] = [];
  clusterPageSize = 10;
  clusterPageIndex = 0;
  clusterPageSizeOptions = [5, 10, 25, 50];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auditService: AuditService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private sensitiveActionService: SensitiveActionService
  ) {}

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.evaluationId = params['id'];
      if (this.evaluationId) {
        this.loadEvaluation();
      }
    });
  }

  async loadEvaluation() {
    this.loading = true;
    this.errorMessage = '';

    try {
      // Load evaluation
      const evalResponse = await this.auditService.getEvaluation(this.evaluationId).toPromise();
      if (!evalResponse) {
        throw new Error('Failed to load evaluation');
      }
      this.evaluation = evalResponse.evaluation;

      // Defensive guard: ensure report exists
      if (!this.evaluation?.report) {
        console.warn('Evaluation report is missing');
        // Initialize empty state
        this.allIssuesV2 = [];
        this.topIssuesV2 = [];
        this.issueSummaryV2 = null;
        return;
      }

      // Load IssueV2 (Enterprise-Grade) - PRIMARY
      const report = this.evaluation.report as any;
      
      // Load allIssuesV2 and topIssuesV2
      if (report?.allIssuesV2 && Array.isArray(report.allIssuesV2)) {
        // G3: Ensure All Issues is sorted by riskScore desc, then severity, then impact, then verification
        this.allIssuesV2 = [...report.allIssuesV2].sort((a, b) => {
          // Primary: riskScore DESC
          const riskA = a.riskScore ?? 0;
          const riskB = b.riskScore ?? 0;
          if (riskB !== riskA) return riskB - riskA;
          
          // Secondary: severity (high > medium > low)
          const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
          const sevA = severityOrder[a.severity || 'low'] ?? 1;
          const sevB = severityOrder[b.severity || 'low'] ?? 1;
          if (sevB !== sevA) return sevB - sevA;
          
          // Tertiary: impact
          const impactOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
          const impA = impactOrder[a.impact || 'low'] ?? 1;
          const impB = impactOrder[b.impact || 'low'] ?? 1;
          if (impB !== impA) return impB - impA;
          
          // Quaternary: verification level
          const verifOrder: Record<string, number> = { EXTERNAL_VERIFIED: 3, TRANSCRIPT_ONLY: 2, NONE: 1 };
          const verA = verifOrder[a.verification?.level || 'NONE'] ?? 1;
          const verB = verifOrder[b.verification?.level || 'NONE'] ?? 1;
          return verB - verA;
        });
        
        // Use topIssuesV2 from report, or default to first 10 (not 4)
        this.topIssuesV2 = report.topIssuesV2 || this.allIssuesV2.slice(0, 10);
        
        // Defense in depth: compute summary from issues if backend summary is missing/incomplete
        const existingSummary = report.issueSummaryV2;
        const issueCount = this.allIssuesV2.length;
        
        // Check if summary is missing or incomplete (all zeros but we have issues)
        const isSummaryMissing = !existingSummary || !existingSummary.bySeverity;
        const totalSeverityCount = existingSummary?.bySeverity 
          ? (existingSummary.bySeverity.low || 0) + 
            (existingSummary.bySeverity.medium || 0) + 
            (existingSummary.bySeverity.high || 0) + 
            (existingSummary.bySeverity.critical || 0)
          : 0;
        const isSummaryIncomplete = totalSeverityCount === 0 && issueCount > 0;
        
        if (isSummaryMissing || isSummaryIncomplete) {
          // Compute summary from actual issues (frontend fallback)
          this.issueSummaryV2 = this.computeIssueSummaryV2FromIssues(this.allIssuesV2, this.topIssuesV2.length);
        } else {
          // Use backend summary if it's valid
          this.issueSummaryV2 = existingSummary;
        }
        
        // Initialize pagination for top issues (use allIssuesV2 so user can see all issues)
        this.updatePaginatedTopIssues();
        
        console.log('✅ Loaded IssueV2 (Enterprise-Grade):', {
          allIssuesCount: this.allIssuesV2.length,
          topIssuesCount: this.topIssuesV2.length,
          summary: this.issueSummaryV2,
        });
      } else {
        // Initialize empty if not present
        this.allIssuesV2 = [];
        this.topIssuesV2 = [];
        this.paginatedTopIssues = [];
        this.issueSummaryV2 = null;
      }
      
      // G2: Load issueClustersV2 (Top Aggregated Issues)
      if (report?.issueClustersV2) {
        this.issueClustersV2 = report.issueClustersV2;
        this.updatePaginatedTopClusters();
        if (this.issueClustersV2) {
          console.log('✅ Loaded Issue Clusters V2:', {
            totalClusters: this.issueClustersV2.clusters?.length ?? 0,
            topClusters: this.issueClustersV2.topClusters?.length ?? 0,
          });
        }
      } else {
        // Fallback: try aggregatedIssues or topAggregatedIssues (backwards compat)
        if (report?.aggregatedIssues && Array.isArray(report.aggregatedIssues)) {
          this.issueClustersV2 = {
            clusters: report.aggregatedIssues,
            topClusters: report.topAggregatedIssues || report.aggregatedIssues.slice(0, 10),
          };
          this.updatePaginatedTopClusters();
        } else {
          this.issueClustersV2 = null;
          this.paginatedTopClusters = [];
        }
      }
      
      // Extract top offenders from IssueV2 if available
      this.extractTopOffenders();
    } catch (error: any) {
      console.error('Load evaluation error:', error);
      this.errorMessage = error.error?.error || error.message || 'Failed to load evaluation';
      const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }

  /**
   * Compute IssueSummaryV2 from issues array (frontend fallback)
   * Executive summary should count impact severity (severity), NOT display severity (severityDisplay)
   * This ensures high/critical counts are accurate regardless of transcript-only mode
   */
  private computeIssueSummaryV2FromIssues(issues: IssueV2[], topIssuesCount: number): any {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byCategory: Record<string, number> = {};

    for (const issue of issues) {
      // Count by type
      const type = issue.type || 'OTHER';
      byType[type] = (byType[type] || 0) + 1;

      // Count by category
      const category = issue.category || 'other';
      byCategory[category] = (byCategory[category] || 0) + 1;

      // Executive summary should count impact severity (severity), not display severity (severityDisplay)
      // This ensures high/critical counts are accurate regardless of transcript-only mode
      // severityDisplay is only for UI convenience, not for analytics
      const severity = (issue.severity || 'medium') as string;
      
      // Normalize to valid severity values
      if (severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'critical') {
        bySeverity[severity] = (bySeverity[severity] || 0) + 1;
      } else {
        // Unknown severity - count as medium (safe default)
        bySeverity['medium'] = (bySeverity['medium'] || 0) + 1;
      }
    }

    return {
      totalIssues: issues.length,
      byType,
      bySeverity,
      byCategory,
      topIssuesCount,
      allIssuesCount: issues.length,
    };
  }

  /**
   * Update paginated top issues based on current page settings
   */
  updatePaginatedTopIssues(): void {
    const startIndex = this.pageIndex * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    // Use allIssuesV2 so user can paginate through all issues, not just top 10
    this.paginatedTopIssues = this.allIssuesV2.slice(startIndex, endIndex);
  }

  /**
   * Handle page change event from paginator
   */
  onPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.updatePaginatedTopIssues();
  }
  
  /**
   * G2: Update paginated top clusters based on current page settings
   */
  updatePaginatedTopClusters(): void {
    if (!this.issueClustersV2 || !this.issueClustersV2.topClusters) {
      this.paginatedTopClusters = [];
      return;
    }
    const startIndex = this.clusterPageIndex * this.clusterPageSize;
    const endIndex = startIndex + this.clusterPageSize;
    this.paginatedTopClusters = this.issueClustersV2.topClusters.slice(startIndex, endIndex);
  }
  
  /**
   * G2: Handle cluster page change event from paginator
   */
  onClusterPageChange(event: PageEvent): void {
    this.clusterPageIndex = event.pageIndex;
    this.clusterPageSize = event.pageSize;
    this.updatePaginatedTopClusters();
  }
  
  /**
   * G2: Open cluster detail modal (shows all atomic issues in the cluster)
   */
  openClusterDetail(cluster: AggregatedIssue): void {
    // Find all atomic issues in this cluster
    const atomicIssues = this.allIssuesV2.filter(issue => 
      cluster.evidence.atomicIssueIds.includes(issue.issueId)
    );
    
    // Open a dialog showing cluster details and atomic issues
    // For now, open the first atomic issue's detail modal
    // TODO: Create a dedicated cluster detail modal component
    if (atomicIssues.length > 0) {
      this.openIssueV2Detail(atomicIssues[0]);
    }
  }
  
  /**
   * G2: Get verification label for cluster
   */
  getClusterVerificationLabel(cluster: AggregatedIssue): string {
    const level = cluster.verification?.level || 'NONE';
    switch (level) {
      case 'EXTERNAL_VERIFIED':
        return 'Externally Verified';
      case 'TRANSCRIPT_ONLY':
        return 'Transcript Only';
      case 'NONE':
        return 'Unverified';
      default:
        return 'Unknown';
    }
  }
  
  /**
   * G2: Get verification tooltip for cluster
   */
  getClusterVerificationTooltip(cluster: AggregatedIssue): string {
    const level = cluster.verification?.level || 'NONE';
    const reasonCodes = cluster.verification?.reasonCodes || [];
    let tooltip = `Verification: ${this.getClusterVerificationLabel(cluster)}`;
    if (reasonCodes.length > 0) {
      tooltip += `\nReason: ${reasonCodes.join(', ')}`;
    }
    if (cluster.occurrences > 1) {
      tooltip += `\nOccurrences: ${cluster.occurrences}`;
    }
    return tooltip;
  }

  /**
   * G2: Get severity display for cluster (for UI rendering)
   */
  getClusterSeverityDisplay(cluster: AggregatedIssue): string {
    // AggregatedIssue doesn't have severityDisplay, so use severity directly
    return (cluster.severity || 'unknown').toUpperCase();
  }

  /**
   * G2: Calculate total occurrences across all clusters
   */
  getTotalClusterOccurrences(): number {
    if (!this.issueClustersV2 || !this.issueClustersV2.clusters) {
      return 0;
    }
    return this.issueClustersV2.clusters.reduce((sum, c) => sum + c.occurrences, 0);
  }

  getSeverity(issue: Issue): 'critical' | 'high' | 'medium' | 'low' {
    // Use pre-computed severity if available (handles nested structure)
    const severity = (issue as any).risk?.severity || issue.severity;
    if (severity) {
      return severity;
    }
    
    // Fallback to computing severity from other fields (handles nested structure)
    const nodeBlame = (issue as any).confidence?.nodeBlameNorm || issue.nodeBlameNorm || 0;
    const issueType = (issue as any).what?.issueType || issue.issueType;
    const truthState = (issue as any).what?.truthState || issue.truthState;
    
    if (issueType === 'POLICY_VIOLATION' && truthState === 'Contradicted') {
      return 'critical';
    }
    if (truthState === 'Contradicted' || issueType === 'POLICY_VIOLATION') {
      return 'high';
    }
    if (truthState === 'Ungrounded' || issueType === 'POLICY_MISS' || nodeBlame > 0.7) {
      return 'medium';
    }
    if (nodeBlame > 0.3) {
      return 'medium';
    }
    return 'low';
  }

  getSeverityColor(severity: 'critical' | 'high' | 'medium' | 'low'): string {
    switch (severity) {
      case 'critical': return '#b71c1c';
      case 'high': return '#d32f2f';
      case 'medium': return '#f57c00';
      case 'low': return '#1976d2';
      default: return '#666';
    }
  }
  
  getSeverityLabel(severity: 'critical' | 'high' | 'medium' | 'low'): string {
    return severity.charAt(0).toUpperCase() + severity.slice(1);
  }

  getClaimText(claimId: string, issue?: Issue): string {
    // First check if issue has the claim text directly (handles nested structure)
    const claimText = (issue as any)?.what?.claimText || issue?.claimText;
    if (claimText) {
      return claimText;
    }
    
    // Try report.inputs.claims
    let claim = this.evaluation?.report?.inputs?.claims?.find((c: any) => c.id === claimId);
    if (claim?.text) {
      return claim.text;
    }
    
    // Try report.claims (original ValidateOutput format)
    claim = this.evaluation?.report?.claims?.find((c: any) => c.id === claimId);
    if (claim?.text) {
      return claim.text;
    }
    
    // Fallback to claimId
    return claimId;
  }

  /**
   * Get claim summary (truncated for table display)
   */
  getClaimSummary(claimId: string, issue?: Issue): string {
    const fullText = this.getClaimText(claimId, issue);
    if (fullText.length > 80) {
      return '"' + fullText.substring(0, 77) + '..."';
    }
    return '"' + fullText + '"';
  }

  /**
   * Get evidence location string (e.g., "Call · Line 13")
   */
  getEvidenceLocation(issue: Issue): string {
    // Handle nested structure (issue.where.turnStartIdx)
    const turnIdx = (issue as any).where?.turnStartIdx ?? issue.turnStartIdx ?? issue.primaryEvidence?.turnIdx;
    if (turnIdx !== undefined && turnIdx !== null) {
      return `Call · Line ${turnIdx + 1}`;
    }
    return 'N/A';
  }

  async openEvidenceViewer(issue: Issue) {
    const claim = this.evaluation?.report?.inputs?.claims?.find((c: any) => c.id === issue.claimId);
    const conversationId = this.evaluation?.conversation_id;
    
    // Fetch transcript with turns
    let transcript = null;
    let turns: Array<{ idx: number; speaker: string; text: string; startMs?: number; endMs?: number }> = [];
    
    if (conversationId) {
      try {
        const transcriptResponse = await this.auditService.getConversationTranscript(conversationId).toPromise();
        if (transcriptResponse) {
          transcript = transcriptResponse.raw_text;
          turns = transcriptResponse.turns || [];
        }
      } catch (error) {
        console.warn('Failed to load transcript:', error);
      }
    }

    this.dialog.open(EvidenceViewerComponent, {
      width: '1200px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      data: {
        issue,
        claim,
        conversationId,
        transcript,
        turns,
        evaluation: this.evaluation
      }
    });
  }

  async exportClaimsCSV() {
    try {
      const result = await this.auditService.exportClaimsCSV(this.evaluationId).toPromise();
      if (result?.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
        const snackBarRef = this.snackBar.open('Claims CSV exported successfully', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to export CSV: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }

  async exportRunJSON() {
    try {
      const result = await this.auditService.exportRunJSON(this.evaluationId).toPromise();
      if (result?.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
        const snackBarRef = this.snackBar.open('Run JSON exported successfully', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to export JSON: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }

  async exportIssuePDF(claimId: string) {
    try {
      const result = await this.auditService.exportIssuePDF(this.evaluationId, claimId).toPromise();
      if (result?.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
        const snackBarRef = this.snackBar.open('Issue PDF exported successfully', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to export PDF: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }

  // ============================================================================
  // CLUSTERED ISSUES (Manager-grade)
  // ============================================================================

  toggleView() {
    // Legacy view toggle removed - IssueV2 is the only view
  }

  selectClusteredIssue(issue: ClusteredIssue) {
    console.log('Opening clustered issue modal:', issue);
    this.dialog.open(IssueDetailModalComponent, {
      width: '900px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: { 
        issue: issue, 
        isNarrative: false 
      },
      panelClass: 'issue-detail-modal-container'
    });
  }

  getClusteredSeverityColor(severity: string): string {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return '#991b1b';
      case 'HIGH': return '#ea580c';
      case 'MEDIUM': return '#2563eb';
      case 'LOW': return '#16a34a';
      default: return '#6b7280';
    }
  }

  getClusteredSeverityBgColor(severity: string): string {
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

  /**
   * Get turn range from primary evidence (e.g., "Turns 5-12" or "Turn 5")
   */
  getTurnRange(issue: ClusteredIssue): string {
    if (!issue.primaryEvidence || issue.primaryEvidence.length === 0) {
      return '';
    }
    
    const turnIndices = issue.primaryEvidence.map(ev => ev.turnIndex).sort((a, b) => a - b);
    const minTurn = turnIndices[0];
    const maxTurn = turnIndices[turnIndices.length - 1];
    
    // Convert to 1-based for display
    const minDisplay = minTurn + 1;
    const maxDisplay = maxTurn + 1;
    
    if (minDisplay === maxDisplay) {
      return `Turn ${minDisplay}`;
    }
    return `Turns ${minDisplay}-${maxDisplay}`;
  }

  /**
   * Get formatted claim IDs (e.g., "3 claims: claim_123, claim_456, claim_789")
   */
  getClaimIdsSummary(issue: ClusteredIssue): string {
    if (!issue.relatedClaimIds || issue.relatedClaimIds.length === 0) {
      return `${issue.metrics.claimCount} claim${issue.metrics.claimCount !== 1 ? 's' : ''}`;
    }
    
    const count = issue.relatedClaimIds.length;
    if (count <= 3) {
      // Show all claim IDs if 3 or fewer
      return `${count} claim${count !== 1 ? 's' : ''}: ${issue.relatedClaimIds.join(', ')}`;
    } else {
      // Show first 2 and count
      const firstTwo = issue.relatedClaimIds.slice(0, 2).join(', ');
      return `${count} claims: ${firstTwo}, +${count - 2} more`;
    }
  }

  // ============================================================================
  // ISSUE NARRATIVES (QA-Manager Grade)
  // ============================================================================

  selectIssueNarrative(narrative: IssueNarrative) {
    console.log('Opening issue narrative modal:', narrative);
    this.dialog.open(IssueDetailModalComponent, {
      width: '900px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: { 
        issue: narrative, 
        isNarrative: true 
      },
      panelClass: 'issue-detail-modal-container'
    });
  }

  getNarrativeTurnRange(narrative: IssueNarrative): string {
    const [min, max] = narrative.scope.turnRange;
    const minDisplay = min + 1;
    const maxDisplay = max + 1;
    
    if (minDisplay === maxDisplay) {
      return `Turn ${minDisplay}`;
    }
    return `Turns ${minDisplay}-${maxDisplay}`;
  }

  getNarrativeSeverityColor(severity: string): string {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return '#991b1b';
      case 'HIGH': return '#ea580c';
      case 'MEDIUM': return '#2563eb';
      case 'LOW': return '#16a34a';
      default: return '#6b7280';
    }
  }

  getNarrativeSeverityBgColor(severity: string): string {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return '#fee2e2';
      case 'HIGH': return '#fef3c7';
      case 'MEDIUM': return '#e0e7ff';
      case 'LOW': return '#d1fae5';
      default: return '#f3f4f6';
    }
  }

  getNarrativeConfidenceColor(confidence: string): string {
    switch (confidence?.toUpperCase()) {
      case 'HIGH': return '#16a34a';
      case 'MEDIUM': return '#2563eb';
      case 'LOW': return '#ea580c';
      default: return '#6b7280';
    }
  }

  // Tooltip definitions for metrics
  /**
 * Get tooltip text for issue score showing scoring components
 */
getScoreTooltip(issue: IssueV2): string {
  if (!issue.scoring) {
    return `Score: ${(issue.score ?? (issue.riskScore * 100)).toFixed(0)}`;
  }
  
  const { components, weights, reasons } = issue.scoring;
  const score = (issue.score ?? (issue.riskScore * 100)).toFixed(0);
  
  let tooltip = `Score: ${score}\n\n`;
  tooltip += `Components:\n`;
  tooltip += `  Impact: ${(components.impact01 * 100).toFixed(1)}% (weight: ${(weights.impact * 100).toFixed(0)}%)\n`;
  tooltip += `  Evidence: ${(components.evidence01 * 100).toFixed(1)}% (weight: ${(weights.evidence * 100).toFixed(0)}%)\n`;
  tooltip += `  Signal: ${(components.signal01 * 100).toFixed(1)}% (weight: ${(weights.signal * 100).toFixed(0)}%)\n`;
  tooltip += `  Category: ${(components.category01 * 100).toFixed(1)}% (weight: ${(weights.category * 100).toFixed(0)}%)\n`;
  
  if (reasons && reasons.length > 0) {
    tooltip += `\nReasons:\n`;
    reasons.forEach(reason => {
      tooltip += `  • ${reason}\n`;
    });
  }
  
  return tooltip;
}

getMetricTooltip(metric: string): string {
    // First check if definitions are available from backend (from headline counts)
    const counts = this.evaluation?.scores?.counts;
    if (counts?.definitions) {
      if (metric === 'supported' && counts.definitions.supported) {
        return counts.definitions.supported;
      }
      if (metric === 'contradicted' && counts.definitions.contradicted) {
        return counts.definitions.contradicted;
      }
      if (metric === 'ungrounded' && counts.definitions.ungrounded) {
        return counts.definitions.ungrounded;
      }
      if (metric === 'unverified' && counts.definitions.unverified) {
        return counts.definitions.unverified;
      }
    }
    
    // Fallback to default definitions
    const definitions: Record<string, string> = {
      'coherenceScore': 'Measures overall consistency of claims. Higher scores indicate fewer contradictions and better logical flow.',
      'contradictionEnergy': 'Sum of contradiction edge weights. Higher values indicate more conflicting information.',
      'supportEnergy': 'Sum of support edge weights. Higher values indicate more supporting relationships.',
      'spectralGap': 'Difference between truth and falsehood propagation. Larger gaps indicate clearer truth/falsehood separation.',
      'circularityScore': 'Measures circular support chains. Higher scores indicate more circular reasoning.',
      'supported': 'Claims with external evidence support (policy/document/system_fact). In transcript-only mode, this will be 0.',
      'contradicted': 'Claims involved in contradiction edges on the same subject slot.',
      'ungrounded': 'Claims with NO evidence at all (no grounding edges, isolated nodes).',
      'unverified': 'Claims grounded in transcript but not externally verified. This is expected in transcript-only mode.',
    };
    return definitions[metric] || '';
  }
  
  /**
   * Check if we're in transcript-only mode (no external evidence provided)
   * In this mode, claims are grounded in the conversation but not externally verified.
   */
  isTranscriptOnlyMode(): boolean {
    const counts = this.evaluation?.scores?.counts;
    if (!counts) return false;
    
    // Transcript-only mode: no support edges AND unverified count > 0
    const mode = counts.mode;
    if (mode === 'transcript_only') return true;
    
    // Fallback: check if supports=0 and unverified > 0
    const supportsCount = counts.supports ?? 0;
    const unverifiedCount = counts.unverified ?? 0;
    return supportsCount === 0 && unverifiedCount > 0;
  }
  
  /**
   * Get IssueV2 type summary for display
   */
  getIssueV2TypeSummary(): string {
    if (!this.issueSummaryV2) return '';
    const types = Object.entries(this.issueSummaryV2.byType)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    return types || 'None';
  }
  
  /**
   * Get IssueV2 severity summary for display
   */
  getIssueV2SeveritySummary(): string {
    if (!this.issueSummaryV2) return '';
    const severities = Object.entries(this.issueSummaryV2.bySeverity)
      .filter(([_, count]) => count > 0)
      .map(([severity, count]) => `${severity}: ${count}`)
      .join(', ');
    return severities || 'None';
  }
  
  /**
   * Open IssueV2 detail modal
   */
  openIssueV2Detail(issue: IssueV2) {
    this.dialog.open(IssueV2DetailModalComponent, {
      width: '90%',
      maxWidth: '1200px',
      data: { issue, evaluation: this.evaluation }
    });
  }
  
  // Tooltip for issue narrative scores
  getNarrativeScoreTooltip(scoreType: string): string {
    const tooltips: Record<string, string> = {
      'riskScore': 'Risk score (0-100): Based on contradiction strength, category risk multiplier, and spectral signals.',
      'impactScore': 'Impact score (0-100): Based on category, customer harm potential, and structural importance.',
      'fixabilityScore': 'Fixability score (0-100): Based on clarity, number of claims, and spectral coherence. Higher = easier to fix.',
      'compositeScore': 'Composite score (0-100): Weighted average of risk (50%), impact (30%), and fixability (20%). Used for ranking.',
    };
    return tooltips[scoreType] || '';
  }
  
  // Tooltip for severity levels
  getSeverityTooltip(severity: string): string {
    const tooltips: Record<string, string> = {
      'CRITICAL': 'Critical severity: Highest risk, immediate action required. Typically policy violations or high-impact contradictions.',
      'HIGH': 'High severity: Significant risk, requires prompt attention. Strong contradictions or ungrounded critical claims.',
      'MEDIUM': 'Medium severity: Moderate risk, should be addressed. Some contradictions or ungrounded claims.',
      'LOW': 'Low severity: Minor risk, may be addressed in routine review. Weak contradictions or minor issues.',
    };
    return tooltips[severity] || '';
  }
  
  // Tooltip for confidence levels
  getConfidenceTooltip(confidence: string): string {
    const tooltips: Record<string, string> = {
      'HIGH': 'High confidence: Spectral analysis confirms the issue. Strong evidence and clear signals.',
      'MEDIUM': 'Medium confidence: Some evidence supports the issue. Moderate signals.',
      'LOW': 'Low confidence: Limited evidence. Weak signals or uncertain classification.',
    };
    return tooltips[confidence] || '';
  }

  exportHTML() {
    // Trigger HTML export download
    window.open(`/api/evaluations/${this.evaluationId}/export/html`, '_blank');
  }

  exportIssuesCSV() {
    // Trigger CSV export download
    window.open(`/api/evaluations/${this.evaluationId}/export/csv`, '_blank');
  }

  exportIssuesJSON() {
    // Trigger JSON export download
    window.open(`/api/evaluations/${this.evaluationId}/export/json`, '_blank');
  }

  exportNarrativesCSV() {
    // Trigger issue narratives CSV export
    window.open(`/api/evaluations/${this.evaluationId}/export/narratives/csv`, '_blank');
  }

  exportNarrativesJSON() {
    // Trigger issue narratives JSON export
    window.open(`/api/evaluations/${this.evaluationId}/export/narratives/json`, '_blank');
  }

  // IssueV2 Export Functions
  exportIssuesV2CSV() {
    if (!this.evaluationId || this.allIssuesV2.length === 0) {
      const snackBarRef = this.snackBar.open('No IssueV2 data available to export', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      return;
    }
    window.open(`/api/evaluations/${this.evaluationId}/export/issues-v2/csv`, '_blank');
  }

  exportIssuesV2JSON() {
    if (!this.evaluationId || this.allIssuesV2.length === 0) {
      const snackBarRef = this.snackBar.open('No IssueV2 data available to export', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      return;
    }
    window.open(`/api/evaluations/${this.evaluationId}/export/issues-v2/json`, '_blank');
  }

  exportIssuesV2PDF() {
    if (!this.evaluationId || this.allIssuesV2.length === 0) {
      const snackBarRef = this.snackBar.open('No IssueV2 data available to export', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      return;
    }
    window.open(`/api/evaluations/${this.evaluationId}/export/issues-v2/pdf`, '_blank');
  }

  getObjectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }

  exportNarrativesHTML() {
    // Trigger issue narratives HTML/PDF export
    window.open(`/api/evaluations/${this.evaluationId}/export/narratives/html`, '_blank');
  }

  getSpectralScores() {
    // Try scores.spectral first, then report.spectral, then fallback to top-level scores
    const scores = this.evaluation?.scores?.spectral || {};
    const reportSpectral = this.evaluation?.report?.spectral || {};
    const topLevelScores = this.evaluation?.scores || {};
    
    // Use coherence from spectral if available, otherwise use orchestrator coherence
    const coherenceScore = scores.coherenceScore ?? 
                          reportSpectral.coherenceScore ?? 
                          topLevelScores.coherence;
    
    return {
      coherenceScore,
      contradictionEnergy: scores.contradictionEnergy ?? reportSpectral.contradictionEnergy,
      supportEnergy: scores.supportEnergy ?? reportSpectral.supportEnergy,
      circularityScore: scores.circularityScore ?? reportSpectral.circularityScore,
      spectralGap: scores.spectralGap ?? reportSpectral.spectralGap,
      cycleMass: scores.cycleMass ?? reportSpectral.cycleMass,
      spectralSkipped: scores.spectralSkipped ?? reportSpectral.spectralSkipped,
      ...scores,
      ...reportSpectral
    };
  }

  /**
   * PART 3: Build issue summary from issues array
   * Derives summary statistics from issues without hard-coding values
   */
  buildIssueSummaryFromIssues(issues: Issue[]): IssueSummary {
    if (!Array.isArray(issues) || issues.length === 0) {
      return {
        totalIssues: 0,
        bySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        byCategory: {},
        primaryRiskCategories: [],
        auditReady: false
      };
    }

    // Count by severity (use getSeverity helper to handle nested structure)
    const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const byCategory: Record<string, number> = {};
    const categories = new Set<string>();

    for (const issue of issues) {
      // Get severity using existing helper
      const severity = this.getSeverity(issue);
      const severityUpper = severity.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      if (bySeverity[severityUpper] !== undefined) {
        bySeverity[severityUpper]++;
      }

      // Get category from risk.category or riskCategory
      const category = (issue as any).risk?.category || issue.riskCategory || 'OTHER';
      byCategory[category] = (byCategory[category] || 0) + 1;
      categories.add(category);
    }

    // Get top categories (sorted by count, take top 3)
    const primaryRiskCategories = Array.from(categories)
      .sort((a, b) => (byCategory[b] || 0) - (byCategory[a] || 0))
      .slice(0, 3);

    return {
      totalIssues: issues.length,
      bySeverity,
      byCategory,
      primaryRiskCategories,
      auditReady: true // Assume audit-ready if we have issues data
    };
  }

  getCounts() {
    const counts = this.evaluation?.scores?.counts || {};
    
    // If counts not populated, derive from issues and claims
    if (!counts.claims && !counts.contradicted) {
      const claims = this.evaluation?.report?.inputs?.claims || 
                     this.evaluation?.report?.claims || [];
      // Use IssueV2 data if available, otherwise use report counts
      const contradictedCount = this.allIssuesV2.filter(i => i.type === 'CONTRADICTION').length;
      const ungroundedCount = this.allIssuesV2.filter(i => i.verification?.level === 'NONE' || !i.verification).length;
      const reportCounts = this.evaluation?.report?.scores?.counts || {};
      const contradictedIssues = { length: contradictedCount || reportCounts.contradicted || 0 };
      const ungroundedIssues = { length: ungroundedCount || reportCounts.ungrounded || 0 };
      
      return {
        claims: claims.length,
        contradicted: contradictedIssues.length,
        ungrounded: ungroundedIssues.length,
        supported: claims.length - contradictedIssues.length - ungroundedIssues.length,
        ...counts
      };
    }
    
    return counts;
  }

  /**
   * Calculate average grounding score from graph grounding edges
   */
  getAverageGroundingScore(): number {
    const grounding = this.evaluation?.report?.graph?.grounding;
    if (!grounding || !Array.isArray(grounding) || grounding.length === 0) {
      return 0;
    }
    const sum = grounding.reduce((acc: number, g: any) => acc + (g.weight || 0), 0);
    return sum / grounding.length;
  }

  getRunInfo() {
    // Try report.run first, then construct from other sources
    const run = this.evaluation?.report?.run || {};
    
    return {
      inputHash: run.inputHash || this.evaluation?.report?.frozenInputs?.inputHash,
      configHash: run.configHash || this.evaluation?.report?.frozenConfig?.configHash,
      engineVersion: run.engineVersion || this.evaluation?.engine_version || 'N/A',
      codeVersion: run.codeVersion || 'N/A',
      modelFingerprint: run.modelFingerprint || this.evaluation?.report?.frozenConfig?.modelFingerprint,
      ...run
    };
  }

  getSubtitle(): string {
    return this.evaluation ? `Evaluation ID: ${this.evaluationId}` : '';
  }

  goToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  /**
   * Get severity display label for UI (respects transcript-only caps)
   */
  getSeverityDisplay(issue: IssueV2): string {
    const severityDisplay = (issue as any).severityDisplay || issue.severity;
    return severityDisplay.toUpperCase();
  }

  /**
   * Get verification label for UI
   */
  getVerificationLabel(issue: IssueV2): string {
    if (!issue.verification) {
      return 'No Verification';
    }
    if (issue.verification.level === 'TRANSCRIPT_ONLY') {
      return 'Unverified (Transcript-only)';
    }
    if (issue.verification.level === 'EXTERNAL_VERIFIED') {
      return 'Externally Verified';
    }
    return 'No Verification';
  }

  getVerificationTooltip(issue: IssueV2): string {
    const impactSeverity = issue.severity ? issue.severity.toUpperCase() : 'UNKNOWN';
    const displaySeverity = issue.severityDisplay ? issue.severityDisplay.toUpperCase() : impactSeverity;
    let tooltip = `Impact Severity: ${impactSeverity}`;
    if (issue.severityDisplay && issue.severity && issue.severityDisplay !== issue.severity.toLowerCase()) {
      tooltip += `\nDisplay Severity: ${displaySeverity} (downgraded for transcript-only)`;
    }
    tooltip += `\nVerification: ${this.getVerificationLabel(issue)}`;
    return tooltip;
  }

  /**
   * Get impact label (separate from severity display)
   */
  getImpactLabel(issue: IssueV2): string {
    const impact = (issue as any).impact || 'medium';
    return `Impact: ${impact.toUpperCase()}`;
  }

  /**
   * Get severity display string for issue (uppercase, for UI rendering)
   */
  getIssueSeverityDisplay(issue: IssueV2): string {
    return (issue.severityDisplay || issue.severity || 'unknown').toUpperCase();
  }

  /**
   * Get formatted score for issue (0-100)
   */
  getIssueScore(issue: IssueV2): string {
    const score = issue.score ?? (issue.riskScore * 100);
    return score.toFixed(0);
  }

  /**
   * Check if issue should show as "high risk" in UI
   * In transcript-only mode, even high impact issues should not show as "high risk"
   */
  shouldShowAsHighRisk(issue: IssueV2): boolean {
    const severityDisplay = (issue as any).severityDisplay || issue.severity;
    return severityDisplay === 'high' || severityDisplay === 'critical';
  }

  /**
   * Sort issues: Contradicted first, then Ungrounded, then Inconclusive
   * Within each: by nodeBlameNorm desc, then by importance desc
   */
  // PART 4: Defensive guard - ensure issues is always an array
  sortAndProcessIssues() {
    // DEPRECATED: IssueV2 is already sorted by risk score
    // This method is kept for backward compatibility but does nothing
  }

  /**
   * Convert IssueNarratives to Issue[] format for the table - DEPRECATED
   * Legacy method kept for backward compatibility but not used with IssueV2
   */
  convertNarrativesToIssues(narratives: IssueNarrative[]): Issue[] {
    return narratives.map((narrative, index) => {
      // Get the first claim ID from scope
      const firstClaimId = narrative.scope?.claimIds?.[0] || narrative.issueId;
      
      // Get the first evidence quote for claim text
      const firstQuote = narrative.evidenceQuotes?.[0];
      const claimText = firstQuote?.text || narrative.whatIsWrong || '';
      
      // Map severity from narrative to Issue format
      const severityMap: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
        'CRITICAL': 'critical',
        'HIGH': 'high',
        'MEDIUM': 'medium',
        'LOW': 'low'
      };
      
      // Map category to issue type
      const categoryToIssueType: Record<string, string> = {
        'BILLING': 'POLICY_VIOLATION',
        'DISCLOSURE': 'POLICY_MISS',
        'MISREPRESENTATION': 'POLICY_VIOLATION',
        'PRIVACY': 'POLICY_VIOLATION',
        'SECURITY': 'POLICY_VIOLATION',
        'PROCESS': 'POLICY_MISS',
        'CUSTOMER_HARM': 'POLICY_VIOLATION',
        'REGULATORY': 'POLICY_VIOLATION',
        'PROMISE_BREACH': 'CONTRADICTION',
        'OTHER': 'UNSUPPORTED'
      };
      
      // Determine truth state from contradiction pairs
      let truthState: 'Contradicted' | 'Supported' | 'Ungrounded' | 'Inconclusive' = 'Inconclusive';
      if (narrative.contradictionPairs && narrative.contradictionPairs.length > 0) {
        truthState = 'Contradicted';
      } else if (narrative.traceability?.topEdges?.some(e => e.type === 'support')) {
        truthState = 'Supported';
      } else if (narrative.evidenceQuotes && narrative.evidenceQuotes.length === 0) {
        truthState = 'Ungrounded';
      }
      
      // Get speaker from first evidence quote or scope
      // Normalize to uppercase to match Issue type
      let speaker: 'AGENT' | 'CUSTOMER' | 'UNKNOWN' | 'SYSTEM' = 'UNKNOWN';
      if (firstQuote?.speaker) {
        const quoteSpeaker = firstQuote.speaker;
        if (quoteSpeaker === 'Agent') {
          speaker = 'AGENT';
        } else if (quoteSpeaker === 'Customer') {
          speaker = 'CUSTOMER';
        } else if (quoteSpeaker === 'System') {
          speaker = 'SYSTEM';
        }
      } else if (narrative.scope?.speakerFocus) {
        speaker = narrative.scope.speakerFocus === 'AGENT' ? 'AGENT' : 
                  narrative.scope.speakerFocus === 'CUSTOMER' ? 'CUSTOMER' : 
                  narrative.scope.speakerFocus === 'SYSTEM' ? 'SYSTEM' : 'UNKNOWN';
      }
      
      const issue: Issue = {
        claimId: firstClaimId,
        issueId: narrative.issueId,
        status: narrative.status === 'RESOLVED' ? 'RESOLVED' : 
                narrative.status === 'DISMISSED' ? 'FALSE_POSITIVE' : 'OPEN',
        
        // Nested structure
        who: {
          speaker: speaker,
          speakerLabel: speaker === 'AGENT' ? 'Agent' : speaker === 'CUSTOMER' ? 'Customer' : 'Unknown'
        },
        what: {
          claimText: claimText,
          claimSummary: narrative.title,
          issueType: categoryToIssueType[narrative.category] || 'UNSUPPORTED' as any,
          truthState: truthState,
          description: narrative.whatIsWrong,
          whyFlagged: narrative.whyWrong?.join('; ') || narrative.whatIsWrong
        },
        where: {
          turnStartIdx: narrative.scope?.turnRange?.[0],
          turnEndIdx: narrative.scope?.turnRange?.[1],
          excerpt: firstQuote?.text || narrative.whatIsWrong
        },
        risk: {
          severity: severityMap[narrative.severity] || 'medium',
          category: narrative.category,
          explanation: narrative.whyItMatters?.join('; ') || narrative.whatIsWrong
        },
        confidence: {
          nodeBlameNorm: narrative.scoring?.riskScore ? narrative.scoring.riskScore / 100 : 0,
          importance: narrative.scoring?.compositeScore ? narrative.scoring.compositeScore / 100 : 0,
          groundingScore: narrative.scoring?.fixabilityScore ? narrative.scoring.fixabilityScore / 100 : undefined
        },
        
        // Legacy flat fields for backward compatibility
        truthState: truthState,
        nodeBlameNorm: narrative.scoring?.riskScore ? narrative.scoring.riskScore / 100 : 0,
        importance: narrative.scoring?.compositeScore ? narrative.scoring.compositeScore / 100 : 0,
        issueType: categoryToIssueType[narrative.category] || 'UNSUPPORTED' as any,
        speaker: speaker,
        speakerLabel: speaker === 'AGENT' ? 'Agent' : speaker === 'CUSTOMER' ? 'Customer' : 'Unknown',
        turnStartIdx: narrative.scope?.turnRange?.[0],
        turnEndIdx: narrative.scope?.turnRange?.[1],
        claimText: claimText,
        claimSummary: narrative.title,
        description: narrative.whatIsWrong,
        whyFlagged: narrative.whyWrong?.join('; ') || narrative.whatIsWrong,
        severity: severityMap[narrative.severity] || 'medium',
        riskCategory: narrative.category,
        riskExplanation: narrative.whyItMatters?.join('; ') || narrative.whatIsWrong,
        evidenceLocation: this.getNarrativeEvidenceLocation(narrative)
      };
      
      return issue;
    });
  }
  
  /**
   * Get evidence location string from narrative
   */
  getNarrativeEvidenceLocation(narrative: IssueNarrative): string {
    if (!narrative.scope?.turnRange) return 'N/A';
    const [min, max] = narrative.scope.turnRange;
    const minDisplay = min + 1;
    const maxDisplay = max + 1;
    if (minDisplay === maxDisplay) {
      return `Call · Line ${minDisplay}`;
    }
    return `Call · Lines ${minDisplay}-${maxDisplay}`;
  }

  /**
   * Extract top offenders from spectral output
   * PART 4: Defensive guards added
   */
  extractTopOffenders() {
    // Initialize empty array if not set
    if (!Array.isArray(this.topOffenders)) {
      this.topOffenders = [];
    }
    
    const spectral = this.evaluation?.report?.spectral;
    // Try both claim locations
    const claims = this.evaluation?.report?.inputs?.claims || 
                   this.evaluation?.report?.claims || 
                   [];
    
    if (spectral?.nodeBlameNorm && Array.isArray(claims) && claims.length > 0) {
      // Create array of claim + blame pairs
      const claimBlame = claims.map((claim: any, idx: number) => ({
        claimId: claim.id,
        text: claim.text,
        nodeBlameNorm: spectral.nodeBlameNorm?.[idx] || 0
      }));
      
      // Sort by nodeBlameNorm desc and take top 5
      this.topOffenders = claimBlame
        .filter((c: any) => c.nodeBlameNorm > 0) // Only include if there's actual blame
        .sort((a: { claimId: string; text: string; nodeBlameNorm: number }, b: { claimId: string; text: string; nodeBlameNorm: number }) => b.nodeBlameNorm - a.nodeBlameNorm)
        .slice(0, 5);
    }
    
    // If no spectral nodeBlameNorm, try to derive from IssueV2
    if (this.topOffenders.length === 0 && this.allIssuesV2.length > 0) {
      // Use IssueV2 with highest risk score as top offenders
      this.topOffenders = [...this.allIssuesV2]
        .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))
        .slice(0, 5)
        .map(issue => ({
          claimId: issue.what.primaryClaimId,
          text: issue.what.claimText || issue.what.issueSummary || '',
          nodeBlameNorm: issue.riskScore || 0
        }));
    }
    
    // Extract top contradictions and supports
    if (spectral?.topBadContradictions) {
      this.topContradictions = spectral.topBadContradictions.slice(0, 5).map((e: any) => ({
        claimAId: e.claimAId || e.claimA,
        claimBId: e.claimBId || e.claimB,
        weight: e.weight || e.badness || 0
      }));
    }
    
    // If no spectral topBadContradictions, try graph.contradictions
    if (this.topContradictions.length === 0) {
      const graphContradictions = this.evaluation?.report?.graph?.contradictions || 
                                  this.evaluation?.report?.contradictions || [];
      this.topContradictions = graphContradictions.slice(0, 5).map((e: any) => ({
        claimAId: e.claimA,
        claimBId: e.claimB,
        weight: e.weight || 0
      }));
    }
    
    if (spectral?.topBadSupports) {
      this.topSupports = spectral.topBadSupports.slice(0, 5).map((e: any) => ({
        claimAId: e.claimAId || e.claimA,
        claimBId: e.claimBId || e.claimB,
        weight: e.weight || e.badness || 0
      }));
    }
    
    // If no spectral topBadSupports, try graph.supports
    if (this.topSupports.length === 0) {
      const graphSupports = this.evaluation?.report?.graph?.supports || [];
      this.topSupports = graphSupports.slice(0, 5).map((e: any) => ({
        claimAId: e.claimA,
        claimBId: e.claimB,
        weight: e.weight || 0
      }));
    }
  }

  /**
   * Get "Where" text for an issue (turn numbers)
   */
  getWhereText(issue: Issue): string {
    // Handle nested structure (issue.where.turnStartIdx/turnEndIdx)
    const turnStartIdx = (issue as any).where?.turnStartIdx ?? issue.turnStartIdx;
    const turnEndIdx = (issue as any).where?.turnEndIdx ?? issue.turnEndIdx;
    
    if (turnStartIdx !== undefined && turnEndIdx !== undefined) {
      if (turnStartIdx === turnEndIdx) {
        return `Turn ${turnStartIdx}`;
      }
      return `Turns ${turnStartIdx}–${turnEndIdx}`;
    }
    return 'N/A';
  }

  /**
   * Update issue status
   */
  async updateStatus(issue: Issue | IssueV2, newStatus: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE') {
    try {
      const claimId = (issue as IssueV2).what?.primaryClaimId || (issue as Issue).claimId;
      const result = await this.auditService.updateIssueStatus(this.evaluationId, claimId, newStatus).toPromise();
      if (result?.success) {
        // Update local IssueV2 if it exists
        if ('issueId' in issue && this.allIssuesV2.length > 0) {
          const issueIndex = this.allIssuesV2.findIndex(i => i.issueId === (issue as IssueV2).issueId);
          if (issueIndex !== -1) {
            // Note: IssueV2 doesn't have status field, but we can track it locally if needed
            // For now, just show success message
          }
        }
        const snackBarRef = this.snackBar.open('Status updated successfully', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to update status: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }

  /**
   * Get circularity warning message
   */
  getCircularityWarning(): string | null {
    const spectral = this.getSpectralScores();
    const circularityScore = spectral.circularityScore || 0;
    const cycleMass = spectral.cycleMass || 0;
    
    if (circularityScore > 30 || cycleMass > 0.1) {
      return `Multiple claims appear to mutually support without grounding (Circularity: ${circularityScore.toFixed(1)}, Cycle Mass: ${cycleMass.toFixed(3)})`;
    }
    return null;
  }

  /**
   * Get issue type label
   */
  getIssueTypeLabel(issueType: string | undefined | null): string {
    if (!issueType) return 'Unknown';
    const labels: Record<string, string> = {
      'CONTRADICTION': 'Contradiction',
      'UNSUPPORTED': 'Ungrounded Claim',
      'CIRCULAR': 'Circular Reasoning',
      'POLICY_MISS': 'Policy Miss',
      'POLICY_VIOLATION': 'Policy Violation',
      'VAGUE_LANGUAGE': 'Policy Ambiguity',
      'LATE_DISCLAIMER': 'Late Disclaimer'
    };
    return labels[issueType] || issueType;
  }
  
  /**
   * Get issue rank - use IssueV2 riskScore if available, otherwise use index
   */
  getIssueRank(issue: Issue, index: number): number {
    // If we have IssueV2, use their riskScore for ranking
    if (this.allIssuesV2.length > 0) {
      // Find the IssueV2 that matches this issue
      const issueV2 = this.allIssuesV2.find(i => 
        i.what?.primaryClaimId === issue.claimId ||
        i.issueId === issue.issueId
      );
      if (issueV2?.riskScore !== undefined) {
        // Rank by riskScore (higher = better rank = lower number)
        const sortedByScore = [...this.allIssuesV2].sort((a, b) => 
          (b.riskScore || 0) - (a.riskScore || 0)
        );
        const rankIndex = sortedByScore.findIndex(i => 
          i.issueId === issueV2.issueId
        );
        return rankIndex >= 0 ? rankIndex + 1 : index + 1;
      }
    }
    // Fallback to index-based ranking
    return index + 1;
  }
  
  /**
   * Get risk score from IssueV2 if available
   */
  getRiskScore(issue: Issue): number | null {
    if (this.allIssuesV2.length > 0) {
      const issueV2 = this.allIssuesV2.find(i => 
        i.what?.primaryClaimId === issue.claimId ||
        i.issueId === issue.issueId
      );
      return issueV2?.score ?? (issueV2?.riskScore ? issueV2.riskScore * 100 : null);
    }
    return null;
  }

  /**
   * Get model fingerprint as text
   */
  getModelFingerprintText(): string {
    const fingerprint = this.getRunInfo().modelFingerprint;
    if (!fingerprint) return 'N/A';
    try {
      return JSON.stringify(fingerprint);
    } catch {
      return String(fingerprint);
    }
  }

  /**
   * Check if this is a simulation
   */
  isSimulation(): boolean {
    return this.evaluation?.report?.mode === 'SIMULATION';
  }

  /**
   * Get parent evaluation ID if this is a simulation
   */
  getParentEvaluationId(): string | null {
    return this.evaluation?.report?.parentEvaluationId || null;
  }

  /**
   * Get simulation description
   */
  getSimulationDescription(): string {
    return this.evaluation?.report?.simulationDescription || '';
  }

  /**
   * Open simulation dialog to create a what-if analysis
   */
  openSimulationDialog() {
    if (!this.evaluation) return;

    const report = this.evaluation.report as any;
    // Try multiple locations for claims and graph data
    const inputs = report?.frozenInputs || report?.inputs || {};
    
    // Fallback to report.claims if inputs.claims doesn't exist
    if (!inputs.claims || inputs.claims.length === 0) {
      inputs.claims = (report?.claims || []).map((c: any) => ({
        id: c.id,
        text: c.text,
        speaker: c.meta?.speaker === 'Agent' ? 'AGENT' : 
                 c.meta?.speaker === 'Customer' ? 'CUSTOMER' : 
                 c.meta?.speaker || 'UNKNOWN',
        turnStartIdx: c.meta?.turnIndex
      }));
    }
    
    // Fallback to report.graph if inputs don't have edges
    if (!inputs.supports || inputs.supports.length === 0) {
      inputs.supports = report?.graph?.supports || [];
    }
    if (!inputs.contradictions || inputs.contradictions.length === 0) {
      inputs.contradictions = report?.graph?.contradictions || report?.contradictions || [];
    }
    if (!inputs.grounded || inputs.grounded.length === 0) {
      inputs.grounded = report?.graph?.grounding?.map((g: any) => g.claimId) || 
                        report?.graph?.groundedClaimIds || [];
    }
    
    const dialogRef = this.dialog.open(SimulationDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      data: {
        evaluationId: this.evaluationId,
        claims: inputs.claims || [],
        supports: inputs.supports || [],
        contradictions: inputs.contradictions || [],
        grounded: inputs.grounded || []
      }
    });

    dialogRef.afterClosed().subscribe(async (modifications: SimulationModifications) => {
      if (!modifications) return;
      
      try {
        const snackBarRef = this.snackBar.open('Running simulation...', '', { duration: 0 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        
        const result = await this.auditService.createSimulation(
          this.evaluationId,
          {
            removeClaims: modifications.removeClaims,
            addGrounded: modifications.addGrounded,
            removeSupports: modifications.removeSupports,
            removeContradictions: modifications.removeContradictions
          },
          modifications.description
        ).toPromise();
        
        if (result?.evaluationId) {
          const snackBarRef2 = this.snackBar.open('Simulation created! Redirecting...', 'Close', { duration: 2000 });
          snackBarRef2.onAction().subscribe(() => snackBarRef2.dismiss());
          // Navigate to the new simulation evaluation
          this.router.navigate(['/evaluations', result.evaluationId]);
        }
      } catch (error: any) {
        const snackBarRef3 = this.snackBar.open(
          'Simulation failed: ' + (error.error?.error || error.message),
          'Close',
          { duration: 5000 }
        );
        snackBarRef3.onAction().subscribe(() => snackBarRef3.dismiss());
      }
    });
  }

  /**
   * Navigate to parent evaluation
   */
  viewParentEvaluation() {
    const parentId = this.getParentEvaluationId();
    if (parentId) {
      this.router.navigate(['/evaluations', parentId]);
    }
  }

  /**
   * Delete evaluation (SENSITIVE ACTION - requires re-authentication)
   */
  async deleteEvaluation() {
    const result = await this.sensitiveActionService.executeWithReauth(
      'delete_evaluation',
      async () => {
        return await this.auditService.deleteEvaluation(this.evaluationId).toPromise();
      }
    );

    if (result.cancelled) {
      // User cancelled re-authentication
      return;
    }

    if (result.success) {
      const snackBarRef = this.snackBar.open('Evaluation deleted successfully', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.router.navigate(['/evaluations']);
    } else {
      const snackBarRef = this.snackBar.open('Failed to delete evaluation: ' + (result.error || 'Unknown error'), 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    }
  }
}

