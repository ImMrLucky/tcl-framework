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

// New clustered issue types (manager-grade)
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

  displayedColumns: string[] = ['severity', 'issueType', 'claim', 'speaker', 'where', 'evidence', 'importance', 'status', 'actions'];
  
  sortedIssues: Issue[] = [];
  topOffenders: Array<{ claimId: string; text: string; nodeBlameNorm: number }> = [];
  topContradictions: Array<{ claimAId: string; claimBId: string; weight: number }> = [];
  topSupports: Array<{ claimAId: string; claimBId: string; weight: number }> = [];
  
  // NEW: Manager-grade clustered issues
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

      // Load issues
      const issuesResponse = await this.auditService.getIssues(this.evaluationId).toPromise();
      if (issuesResponse) {
        this.issues = issuesResponse.issues;
        this.sortAndProcessIssues();
        this.extractTopOffenders();
      }
      
      // Load clustered issues (manager-grade) from report
      const issueAnalysis = (this.evaluation?.report as any)?.issueAnalysis;
      if (issueAnalysis) {
        this.clusteredIssues = issueAnalysis.clusteredIssues || [];
        this.issueSummary = issueAnalysis.summary || null;
        console.log('📊 Loaded clustered issues:', {
          count: this.clusteredIssues.length,
          summary: this.issueSummary
        });
      }
    } catch (error: any) {
      console.error('Load evaluation error:', error);
      this.errorMessage = error.error?.error || error.message || 'Failed to load evaluation';
      this.snackBar.open(this.errorMessage, 'Close', { duration: 5000 });
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
        this.snackBar.open('Claims CSV exported successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to export CSV: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
    }
  }

  async exportRunJSON() {
    try {
      const result = await this.auditService.exportRunJSON(this.evaluationId).toPromise();
      if (result?.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
        this.snackBar.open('Run JSON exported successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to export JSON: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
    }
  }

  async exportIssuePDF(claimId: string) {
    try {
      const result = await this.auditService.exportIssuePDF(this.evaluationId, claimId).toPromise();
      if (result?.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
        this.snackBar.open('Issue PDF exported successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to export PDF: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
    }
  }

  // ============================================================================
  // CLUSTERED ISSUES (Manager-grade)
  // ============================================================================

  toggleView() {
    this.showClusteredView = !this.showClusteredView;
  }

  selectClusteredIssue(issue: ClusteredIssue) {
    this.dialog.open(IssueDetailModalComponent, {
      width: '900px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: issue,
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
  sortAndProcessIssues() {
    const truthStateOrder: Record<string, number> = {
      'Contradicted': 1,
      'Ungrounded': 2,
      'Inconclusive': 3,
      'Supported': 4
    };
    
    this.sortedIssues = [...this.issues].sort((a, b) => {
      // First by truth state (handles nested structure)
      const stateA = truthStateOrder[(a as any).what?.truthState || a.truthState] || 99;
      const stateB = truthStateOrder[(b as any).what?.truthState || b.truthState] || 99;
      if (stateA !== stateB) {
        return stateA - stateB;
      }
      
      // Then by nodeBlameNorm desc (handles nested structure)
      const blameA = (a as any).confidence?.nodeBlameNorm || a.nodeBlameNorm || 0;
      const blameB = (b as any).confidence?.nodeBlameNorm || b.nodeBlameNorm || 0;
      if (blameA !== blameB) {
        return blameB - blameA;
      }
      
      // Then by importance desc (handles nested structure)
      const importanceA = (a as any).confidence?.importance || a.importance || 0;
      const importanceB = (b as any).confidence?.importance || b.importance || 0;
      return importanceB - importanceA;
    });
  }

  /**
   * Extract top offenders from spectral output
   */
  extractTopOffenders() {
    const spectral = this.evaluation?.report?.spectral;
    // Try both claim locations
    const claims = this.evaluation?.report?.inputs?.claims || 
                   this.evaluation?.report?.claims || 
                   [];
    
    if (spectral?.nodeBlameNorm && claims.length > 0) {
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
    if (this.topOffenders.length === 0 && this.issues.length > 0) {
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
        this.snackBar.open('Status updated successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to update status: ' + (error.error?.error || error.message), 'Close', { duration: 5000 });
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
        this.snackBar.open('Running simulation...', '', { duration: 0 });
        
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
          this.snackBar.open('Simulation created! Redirecting...', 'Close', { duration: 2000 });
          // Navigate to the new simulation evaluation
          this.router.navigate(['/evaluations', result.evaluationId]);
        }
      } catch (error: any) {
        this.snackBar.open(
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
      this.snackBar.open('Evaluation deleted successfully', 'Close', { duration: 3000 });
      this.router.navigate(['/evaluations']);
    } else {
      this.snackBar.open('Failed to delete evaluation: ' + (result.error || 'Unknown error'), 'Close', { duration: 5000 });
    }
  }
}

