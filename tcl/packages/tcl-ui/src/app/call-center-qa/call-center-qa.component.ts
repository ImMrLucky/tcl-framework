import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputPanelComponent } from '../input-panel/input-panel.component';
import { SummaryPanelComponent } from '../summary-panel/summary-panel.component';
import { ClaimTableComponent } from '../claim-table/claim-table.component';
import { GraphViewComponent } from '../graph-view/graph-view.component';
import { TclService } from '../tcl.service';
import { ValidateOutput, ClaimWithMetadata, GraphEdge, CallMetadata } from '../types';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule } from '@angular/router';
import { AuthService, User } from '../auth.service';
import { AppHeaderComponent } from '../shared/app-header.component';

@Component({
  selector: 'app-call-center-qa',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    InputPanelComponent,
    SummaryPanelComponent,
    ClaimTableComponent,
    GraphViewComponent,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    AppHeaderComponent
  ],
  templateUrl: './call-center-qa.component.html',
  styleUrls: ['./call-center-qa.component.scss']
})
export class CallCenterQaComponent implements OnInit {
  loading = false;
  result: ValidateOutput | null = null;
  claimsWithMetadata: ClaimWithMetadata[] = [];
  graphEdges: GraphEdge[] = [];
  engineVersion: string | null = null;
  latency: number | null = null;
  cacheHitRate: number | null = null;
  validationStartTime: number | null = null;

  // Store current validation inputs for share link (ONLY inputs, never results)
  currentQuestion = '';
  currentAnswer = '';
  currentSources: { id: string; text: string }[] | undefined = undefined;
  currentCallMetadata: CallMetadata | undefined = undefined;
  currentOptions: any = {};

  // Auth properties
  isAuthenticated = false;
  currentUser: User | null = null;

  constructor(
    private tclService: TclService,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.readUrlParameters();
    this.getEngineVersion();
    
    // Subscribe to auth state
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.isAuthenticated = user !== null;
    });
  }

  signOut() {
    this.authService.signOut();
  }

  private readUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const question = params.get('q');
    const answer = params.get('a');
    const spectral = params.get('spectral');
    const ann = params.get('ann');
    const cache = params.get('cache');
    const supportThreshold = params.get('st');
    const contradictionThreshold = params.get('ct');
    const groundingThreshold = params.get('gt');
    const maxPairwiseEdges = params.get('mpe');
    const neighborK = params.get('nk');
    const sourcesParam = params.get('sources');
    const callMetadataJson = params.get('cm');

    if (question || answer) {
      const decodedQuestion = question ? decodeURIComponent(question) : '';
      const decodedAnswer = answer ? decodeURIComponent(answer) : '';
      
      let decodedSources: { id: string; text: string }[] | undefined = undefined;
      if (sourcesParam) {
        try {
          decodedSources = JSON.parse(decodeURIComponent(sourcesParam));
        } catch (e) {
          console.warn('Failed to decode sources from URL:', e);
        }
      }

      let decodedCallMetadata: CallMetadata | undefined;
      if (callMetadataJson) {
        try {
          decodedCallMetadata = JSON.parse(decodeURIComponent(callMetadataJson));
        } catch (e) {
          console.warn('Failed to decode call metadata from URL:', e);
        }
      }
      
      this.currentQuestion = decodedQuestion;
      this.currentAnswer = decodedAnswer;
      this.currentSources = decodedSources;
      this.currentCallMetadata = decodedCallMetadata;
      this.currentOptions = {
        spectral: spectral === '1',
        ann: ann === '1',
        cache: cache === '1',
        supportThreshold: supportThreshold ? parseFloat(supportThreshold) : undefined,
        contradictionThreshold: contradictionThreshold ? parseFloat(contradictionThreshold) : undefined,
        groundingThreshold: groundingThreshold ? parseFloat(groundingThreshold) : undefined,
        maxPairwiseEdges: maxPairwiseEdges ? parseInt(maxPairwiseEdges, 10) : undefined,
        neighborK: neighborK ? parseInt(neighborK, 10) : undefined,
      };

      if (decodedQuestion) {
        setTimeout(() => {
          this.onValidate({
            question: decodedQuestion,
            answer: decodedAnswer,
            sources: decodedSources,
            callMetadata: decodedCallMetadata,
            options: this.currentOptions
          });
        }, 100);
      }
    }
  }

  onValidate(event: {
    question: string;
    answer: string;
    sources?: { id: string; text: string }[];
    callMetadata?: CallMetadata;
    options: any;
  }) {
    this.loading = true;
    this.result = null;
    this.claimsWithMetadata = [];
    this.graphEdges = [];
    this.latency = null;
    this.cacheHitRate = null;

    this.currentQuestion = event.question;
    this.currentAnswer = event.answer;
    this.currentSources = event.sources;
    this.currentCallMetadata = event.callMetadata;
    this.currentOptions = event.options;

    this.validationStartTime = Date.now();

    this.tclService.validate(
      event.question,
      event.answer,
      event.sources,
      {
        spectral: event.options.spectral,
        ann: event.options.ann,
        cache: event.options.cache,
        supportThreshold: event.options.supportThreshold,
        contradictionThreshold: event.options.contradictionThreshold,
        groundingThreshold: event.options.groundingThreshold,
        maxPairwiseEdges: event.options.maxPairwiseEdges,
        neighborK: event.options.neighborK,
      },
      event.callMetadata
    ).subscribe({
      next: (result: ValidateOutput) => {
        if (this.validationStartTime) {
          this.latency = Date.now() - this.validationStartTime;
        }
        this.cacheHitRate = result.cacheHitRate ?? null;
        if (result.engineVersion) {
          this.engineVersion = result.engineVersion;
        }
        this.result = result;
        this.processResult(result);
        this.loading = false;
      },
      error: (error: any) => {
        console.error('Validation error:', error);
        alert('Error: ' + (error.error?.error || error.message || 'Unknown error'));
        this.loading = false;
        this.validationStartTime = null;
      }
    });
  }

  private processResult(result: ValidateOutput) {
    const { claims, contradictions: reportContradictions, missingEvidence, spectral, graph } = result.report;
    
    const claimMap = new Map<string, ClaimWithMetadata>();
    const groundedIds = new Set(
      claims.filter(c => c.evidence && c.evidence.length > 0).map(c => c.id)
    );

    claims.forEach(claim => {
      claimMap.set(claim.id, {
        ...claim,
        grounded: groundedIds.has(claim.id),
        supportCount: 0,
        contradictionCount: 0,
        inCycles: false,
      });
    });

    const supports: GraphEdge[] = [];
    const contradictionEdges: GraphEdge[] = [];
    const grounding: GraphEdge[] = [];

    if (graph) {
      graph.supports.forEach((edge: any) => {
        const claimA = claimMap.get(edge.claimA);
        const claimB = claimMap.get(edge.claimB);
        if (claimA && claimB) {
          claimA.supportCount++;
          supports.push({
            from: edge.claimA,
            to: edge.claimB,
            type: 'support',
            weight: edge.weight,
          });
        }
      });

      graph.contradictions.forEach((edge: any) => {
        const claimA = claimMap.get(edge.claimA);
        const claimB = claimMap.get(edge.claimB);
        if (claimA && claimB) {
          claimA.contradictionCount++;
          claimB.contradictionCount++;
          contradictionEdges.push({
            from: edge.claimA,
            to: edge.claimB,
            type: 'contradiction',
            weight: edge.weight,
          });
        }
      });

      graph.grounding.forEach((edge: any) => {
        const claim = claimMap.get(edge.claimId);
        if (claim) {
          grounding.push({
            from: edge.claimId,
            to: edge.sourceId,
            type: 'grounding',
            weight: edge.weight,
          });
        }
      });
    }

    reportContradictions.forEach(cont => {
      const claimA = claimMap.get(cont.claimA);
      const claimB = claimMap.get(cont.claimB);
      if (claimA && claimB) {
        const exists = contradictionEdges.some(
          e => (e.from === cont.claimA && e.to === cont.claimB) || (e.from === cont.claimB && e.to === cont.claimA)
        );
        if (!exists) {
          claimA.contradictionCount++;
          claimB.contradictionCount++;
          contradictionEdges.push({
            from: cont.claimA,
            to: cont.claimB,
            type: 'contradiction',
            weight: 1.0,
          });
        }
      }
    });

    this.claimsWithMetadata = Array.from(claimMap.values());
    this.graphEdges = [...supports, ...contradictionEdges, ...grounding];
  }

  downloadReport() {
    if (!this.result) return;

    const report = {
      ...this.result,
      metadata: {
        timestamp: new Date().toISOString(),
        transcript: this.currentQuestion,
        callMetadata: this.currentCallMetadata,
        options: this.currentOptions,
        latency: this.latency,
        cacheHitRate: this.cacheHitRate,
        engineVersion: this.engineVersion
      }
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-qa-report-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  exportToCSV() {
    if (!this.result) return;
    // Implementation from app.component.ts
    const rows: string[] = [];
    rows.push('Call ID,Agent ID,Customer ID,Call Date,Duration (min),TCL_Overall_Score,Risk Level,Contradictions,Evidence_Gaps,Timestamp');
    const callId = this.currentCallMetadata?.agentId ? `CALL-${this.currentCallMetadata.agentId}-${Date.now()}` : 'CALL-UNKNOWN';
    const tclOrOverall = this.result.scores.tcl ?? this.result.scores.overall;
    const riskLevel = tclOrOverall >= 80 ? 'Low' : tclOrOverall >= 60 ? 'Medium' : tclOrOverall >= 40 ? 'High' : 'Critical';
    rows.push(`${callId},${this.currentCallMetadata?.agentId || 'N/A'},${this.currentCallMetadata?.customerId || 'N/A'},${this.currentCallMetadata?.callDate || new Date().toISOString().split('T')[0]},${this.currentCallMetadata?.duration || 'N/A'},${tclOrOverall},${riskLevel},${this.result.report.contradictions.length},${this.result.report.missingEvidence.length},${new Date().toISOString()}`);
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-qa-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  exportToPDF() {
    if (!this.result) {
      alert('No call analysis data to export. Please analyze a call first.');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to generate PDF');
      return;
    }
    const tclOrOverall = this.result.scores.tcl ?? this.result.scores.overall;
    const riskLevel = tclOrOverall >= 80 ? 'Low' : tclOrOverall >= 60 ? 'Medium' : tclOrOverall >= 40 ? 'High' : 'Critical';
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conversation truth & risk report</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { color: #1976d2; }
          .score { font-size: 48px; font-weight: bold; margin: 20px 0; }
          .risk-${riskLevel.toLowerCase()} { color: ${riskLevel === 'Low' ? '#4caf50' : riskLevel === 'Medium' ? '#ff9800' : riskLevel === 'High' ? '#f44336' : '#d32f2f'}; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f5f5f5; }
        </style>
      </head>
      <body>
        <h1>ProtectQA / TCL conversation report</h1>
        <p><strong>Agent ID:</strong> ${this.currentCallMetadata?.agentId || 'N/A'}</p>
        <p><strong>Customer ID:</strong> ${this.currentCallMetadata?.customerId || 'N/A'}</p>
        <p><strong>Call Date:</strong> ${this.currentCallMetadata?.callDate || new Date().toISOString().split('T')[0]}</p>
        <p><strong>Duration:</strong> ${this.currentCallMetadata?.duration || 'N/A'} minutes</p>
        <h2>TCL / ProtectQA score</h2>
        <div class="score risk-${riskLevel.toLowerCase()}">${tclOrOverall}</div>
        <p><strong>Risk band (from score):</strong> ${riskLevel}</p>
        ${this.result.risk?.primaryRisk ? `<p><strong>Primary risk:</strong> ${this.result.risk.primaryRisk}</p>` : ''}
        <h2>Score breakdown</h2>
        <table>
          <tr><th>Metric</th><th>Score</th></tr>
          <tr><td>Truth (factual / supported)</td><td>${this.result.scores.truth}</td></tr>
          ${this.result.scores.transcriptGrounding != null ? `<tr><td>Transcript grounding</td><td>${this.result.scores.transcriptGrounding}</td></tr>` : ''}
          ${this.result.scores.compliance != null ? `<tr><td>Compliance</td><td>${this.result.scores.compliance}</td></tr>` : ''}
          ${this.result.scores.hallucination != null ? `<tr><td>Hallucination safety</td><td>${this.result.scores.hallucination}</td></tr>` : ''}
          ${this.result.scores.drift != null ? `<tr><td>Drift</td><td>${this.result.scores.drift}</td></tr>` : ''}
          <tr><td>Consistency</td><td>${this.result.scores.consistency}</td></tr>
          <tr><td>Coherence</td><td>${this.result.scores.coherence}</td></tr>
          <tr><td><strong>TCL / overall</strong></td><td><strong>${this.result.scores.tcl ?? this.result.scores.overall}</strong></td></tr>
        </table>
        <h2>Issues Found</h2>
        <p><strong>Contradictions:</strong> ${this.result.report.contradictions.length}</p>
        <p><strong>Ungrounded Claims:</strong> ${this.result.report.missingEvidence.length}</p>
        <p><strong>Total Violations:</strong> ${this.result.report.violations.length}</p>
      </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }

  private getEngineVersion() {
    this.tclService.getEngineVersion().subscribe({
      next: (version) => {
        this.engineVersion = version;
      },
      error: (err) => {
        console.error('Failed to get engine version:', err);
        this.engineVersion = 'v0.2.0 (fallback)';
      }
    });
  }
}

