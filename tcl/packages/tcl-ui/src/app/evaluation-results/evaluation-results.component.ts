import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
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
    AppHeaderComponent
  ],
  templateUrl: './evaluation-results.component.html',
  styleUrls: ['./evaluation-results.component.scss']
})
export class EvaluationResultsComponent implements OnInit {
  evaluationId: string = '';
  evaluation: Evaluation | null = null;
  issues: Issue[] = [];
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
  
  sortedIssues: Issue[] = [];
  topOffenders: Array<{ claimId: string; text: string; nodeBlameNorm: number }> = [];
  topContradictions: Array<{ claimAId: string; claimBId: string; weight: number }> = [];
  topSupports: Array<{ claimAId: string; claimBId: string; weight: number }> = [];
  
  // NEW: Manager-grade issue narratives (QA-Manager Grade)
  issueNarratives: IssueNarrative[] = [];
  issueNarrativesSummary: IssueSummary | null = null;
  
  // Legacy: Manager-grade clustered issues (for backward compatibility)
  clusteredIssues: ClusteredIssue[] = [];
  issueSummary: IssueSummary | null = null;
  showClusteredView = true; // Toggle between clustered and per-claim view

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

      // PART 4: Defensive guard: ensure report exists
      if (!this.evaluation?.report) {
        console.warn('Evaluation report is missing');
        // Initialize empty state
        this.issues = [];
        this.issueNarratives = [];
        this.issueNarrativesSummary = {
          totalIssues: 0,
          bySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
          byCategory: {},
          primaryRiskCategories: [],
          auditReady: false
        };
        return;
      }

      // Load issue narratives (QA-Manager Grade) from report - PRIMARY
      // Try multiple possible locations in the report structure
      const report = this.evaluation.report as any;
      let issueNarrativesData = report?.issueNarratives;
      
      // Also check if narratives are directly in report
      if (!issueNarrativesData && Array.isArray(report?.narratives)) {
        issueNarrativesData = { narratives: report.narratives, summary: report.summary };
      }
      
      // Also check if it's in issueAnalysis
      if (!issueNarrativesData && report?.issueAnalysis?.narratives) {
        issueNarrativesData = report.issueAnalysis;
      }
      
      // Extract narratives array and check if it's actually populated
      const narratives = issueNarrativesData
        ? (Array.isArray(issueNarrativesData) 
            ? issueNarrativesData 
            : (issueNarrativesData.narratives || []))
        : [];
      
      // Only use narratives if they're actually populated (not empty array)
      if (narratives.length > 0) {
        this.issueNarratives = narratives;
        this.issueNarrativesSummary = {
          totalIssues: issueNarrativesData.summary?.totalIssues || narratives.length,
          bySeverity: issueNarrativesData.summary?.bySeverity || { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
          byCategory: issueNarrativesData.summary?.byCategory || {},
          primaryRiskCategories: issueNarrativesData.summary?.topCategories || [],
          auditReady: true, // Issue narratives include full reproducibility
        };
        console.log('📊 Loaded issue narratives:', {
          count: this.issueNarratives.length,
          summary: this.issueNarrativesSummary,
          firstNarrative: this.issueNarratives[0] ? {
            issueId: this.issueNarratives[0].issueId,
            title: this.issueNarratives[0].title,
            evidenceQuotesCount: this.issueNarratives[0].evidenceQuotes?.length || 0,
            traceabilityEdgesCount: this.issueNarratives[0].traceability?.topEdges?.length || 0,
            hasScoring: !!this.issueNarratives[0].scoring
          } : null
        });
        
        // Convert issue narratives to Issue[] format for the table
        this.issues = this.convertNarrativesToIssues(this.issueNarratives);
        this.sortAndProcessIssues();
        this.extractTopOffenders();
      } else {
        // PART 3: Fallback to report.issues if narratives are empty
        // Explicitly set issueNarratives to empty array
        this.issueNarratives = [];
        const reportIssues = Array.isArray(report?.issues) ? report.issues : [];
        
        console.log('📊 No narratives found, falling back to report.issues:', {
          narrativesLength: narratives.length,
          reportIssuesLength: reportIssues.length,
          issueNarrativesDataExists: !!issueNarrativesData
        });
        
        if (reportIssues.length > 0) {
          // Use issues directly from report
          this.issues = reportIssues;
          this.issueNarrativesSummary = this.buildIssueSummaryFromIssues(reportIssues);
          // Default to per-claim view when we only have issues (no narratives)
          this.showClusteredView = false;
          this.sortAndProcessIssues();
          this.extractTopOffenders();
          console.log('📊 Loaded issues from report.issues:', {
            count: this.issues.length,
            sortedCount: this.sortedIssues.length,
            showClusteredView: this.showClusteredView,
            summary: this.issueNarrativesSummary,
            bySeverity: this.issueNarrativesSummary.bySeverity,
            topOffendersCount: this.topOffenders.length,
            firstIssue: this.issues[0] ? {
              claimId: this.issues[0].claimId,
              issueType: (this.issues[0] as any).what?.issueType || this.issues[0].issueType,
              severity: this.getSeverity(this.issues[0])
            } : null
          });
        } else {
          // Final fallback: Load issues from API if not in report
          const issuesResponse = await this.auditService.getIssues(this.evaluationId).toPromise();
          if (issuesResponse && Array.isArray(issuesResponse.issues) && issuesResponse.issues.length > 0) {
            this.issues = issuesResponse.issues;
            this.issueNarrativesSummary = this.buildIssueSummaryFromIssues(issuesResponse.issues);
            // Default to per-claim view when we only have issues (no narratives)
            this.showClusteredView = false;
            this.sortAndProcessIssues();
            this.extractTopOffenders();
            console.log('📊 Loaded issues from API:', {
              count: this.issues.length,
              summary: this.issueNarrativesSummary,
              bySeverity: this.issueNarrativesSummary.bySeverity
            });
          } else {
            // No issues found anywhere - initialize empty state
            this.issues = [];
            this.issueNarrativesSummary = {
              totalIssues: 0,
              bySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
              byCategory: {},
              primaryRiskCategories: [],
              auditReady: false
            };
          }
        }
      }
      
      // Load clustered issues (legacy manager-grade) from report - FALLBACK
      const issueAnalysis = report?.issueAnalysis;
      if (issueAnalysis && this.issueNarratives.length === 0) {
        this.clusteredIssues = issueAnalysis.clusteredIssues || [];
        this.issueSummary = issueAnalysis.summary || null;
        console.log('📊 Loaded clustered issues (legacy):', {
          count: this.clusteredIssues.length,
          summary: this.issueSummary
        });
      }
    } catch (error: any) {
      console.error('Load evaluation error:', error);
      this.errorMessage = error.error?.error || error.message || 'Failed to load evaluation';
      const snackBarRef = this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
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
    this.showClusteredView = !this.showClusteredView;
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
      const contradictedIssues = this.issues.filter(i => i.truthState === 'Contradicted');
      const ungroundedIssues = this.issues.filter(i => i.truthState === 'Ungrounded');
      
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
   * Sort issues: Contradicted first, then Ungrounded, then Inconclusive
   * Within each: by nodeBlameNorm desc, then by importance desc
   */
  // PART 4: Defensive guard - ensure issues is always an array
  sortAndProcessIssues() {
    if (!Array.isArray(this.issues)) {
      this.issues = [];
    }
    const truthStateOrder: Record<string, number> = {
      'Contradicted': 1,
      'Ungrounded': 2,
      'Inconclusive': 3,
      'Supported': 4
    };
    
    const severityOrder: Record<string, number> = {
      'critical': 1,
      'high': 2,
      'medium': 3,
      'low': 4
    };
    
    this.sortedIssues = [...this.issues].sort((a, b) => {
      // First by severity (if available from narratives)
      const severityA = severityOrder[this.getSeverity(a)] || 99;
      const severityB = severityOrder[this.getSeverity(b)] || 99;
      if (severityA !== severityB) {
        return severityA - severityB;
      }
      
      // Then by truth state (handles nested structure)
      const stateA = truthStateOrder[(a as any).what?.truthState || a.truthState] || 99;
      const stateB = truthStateOrder[(b as any).what?.truthState || b.truthState] || 99;
      if (stateA !== stateB) {
        return stateA - stateB;
      }
      
      // Then by importance/compositeScore desc (handles nested structure)
      const importanceA = (a as any).confidence?.importance || a.importance || 0;
      const importanceB = (b as any).confidence?.importance || b.importance || 0;
      if (importanceA !== importanceB) {
        return importanceB - importanceA;
      }
      
      // Then by nodeBlameNorm desc (handles nested structure)
      const blameA = (a as any).confidence?.nodeBlameNorm || a.nodeBlameNorm || 0;
      const blameB = (b as any).confidence?.nodeBlameNorm || b.nodeBlameNorm || 0;
      return blameB - blameA;
    });
  }

  /**
   * Convert IssueNarratives to Issue[] format for the table
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
    
    // If no spectral nodeBlameNorm, try to derive from issues
    if (this.topOffenders.length === 0 && Array.isArray(this.issues) && this.issues.length > 0) {
      // Use issues with highest importance as top offenders (handles nested structure)
      this.topOffenders = [...this.issues]
        .sort((a, b) => {
          const importanceA = (a as any).confidence?.importance || a.importance || 0;
          const importanceB = (b as any).confidence?.importance || b.importance || 0;
          return importanceB - importanceA;
        })
        .slice(0, 5)
        .map(issue => ({
          claimId: issue.claimId,
          text: (issue as any).what?.claimText || issue.claimText || this.getClaimText(issue.claimId, issue),
          nodeBlameNorm: (issue as any).confidence?.nodeBlameNorm || issue.nodeBlameNorm || 
                         (issue as any).confidence?.importance || issue.importance || 0
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
  async updateStatus(issue: Issue, newStatus: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE') {
    try {
      const result = await this.auditService.updateIssueStatus(this.evaluationId, issue.claimId, newStatus).toPromise();
      if (result?.success) {
        // Update local issue
        const issueIndex = this.issues.findIndex(i => i.claimId === issue.claimId);
        if (issueIndex !== -1) {
          this.issues[issueIndex].status = newStatus;
          this.sortAndProcessIssues();
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
   * Get issue rank - use compositeScore if available, otherwise use index
   */
  getIssueRank(issue: Issue, index: number): number {
    // If we have issueNarratives, use their compositeScore for ranking
    if (this.issueNarratives.length > 0) {
      // Find the narrative that matches this issue
      const narrative = this.issueNarratives.find(n => 
        n.issueId === issue.issueId || 
        n.scope?.claimIds?.includes(issue.claimId)
      );
      if (narrative?.scoring?.compositeScore !== undefined) {
        // Rank by compositeScore (higher = better rank = lower number)
        const sortedByScore = [...this.issueNarratives].sort((a, b) => 
          (b.scoring?.compositeScore || 0) - (a.scoring?.compositeScore || 0)
        );
        const rankIndex = sortedByScore.findIndex(n => 
          n.issueId === narrative.issueId
        );
        return rankIndex >= 0 ? rankIndex + 1 : index + 1;
      }
    }
    // Fallback to index-based ranking
    return index + 1;
  }
  
  /**
   * Get risk score from narrative if available
   */
  getRiskScore(issue: Issue): number | null {
    if (this.issueNarratives.length > 0) {
      const narrative = this.issueNarratives.find(n => 
        n.issueId === issue.issueId || 
        n.scope?.claimIds?.includes(issue.claimId)
      );
      return narrative?.scoring?.riskScore ?? null;
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

