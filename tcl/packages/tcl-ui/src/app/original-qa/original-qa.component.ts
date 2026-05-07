import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OriginalInputPanelComponent } from '../original-input-panel/original-input-panel.component';
import { SummaryPanelComponent } from '../summary-panel/summary-panel.component';
import { ClaimTableComponent } from '../claim-table/claim-table.component';
import { GraphViewComponent } from '../graph-view/graph-view.component';
import { TclService } from '../tcl.service';
import { ValidateOutput, ClaimWithMetadata, GraphEdge, SupportEdge, ContradictionEdge, GroundingEdge } from '../types';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { LogoComponent } from '../shared/logo.component';

@Component({
  selector: 'app-original-qa',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    OriginalInputPanelComponent,
    SummaryPanelComponent,
    ClaimTableComponent,
    GraphViewComponent,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    LogoComponent
  ],
  template: `
    <div class="app-container">
      <header class="app-header">
        <div class="header-content">
          <div class="header-left">
            <app-logo></app-logo>
          </div>
          <div class="header-title">
            <h1>TCL Framework</h1>
            <p class="subtitle">Truth & Consistency Layer for LLM Validation</p>
          </div>
          <div class="header-actions">
            <a mat-button routerLink="/call-center-qa" routerLinkActive="active">
              <mat-icon>swap_horiz</mat-icon>
              Switch to conversation review (ProtectQA / TCL)
            </a>
            <button
              *ngIf="result"
              mat-icon-button
              matTooltip="Download Report JSON"
              (click)="downloadReport()"
              color="primary"
            >
              <mat-icon>download</mat-icon>
            </button>
            <button
              *ngIf="result"
              mat-icon-button
              matTooltip="Share Link"
              (click)="shareLink()"
              color="primary"
            >
              <mat-icon>share</mat-icon>
            </button>
          </div>
        </div>
      </header>

      <div class="main-layout">
        <div class="left-column">
          <app-original-input-panel
            (validate)="onValidate($event)"
            [loading]="loading"
            [initialQuestion]="currentQuestion"
            [initialAnswer]="currentAnswer"
            [initialSources]="currentSources"
            [initialOptions]="currentOptions"
          ></app-original-input-panel>

          <app-summary-panel
            [result]="result"
            [loading]="loading"
          ></app-summary-panel>
        </div>

        <div class="right-column">
          <app-claim-table
            [claims]="claimsWithMetadata"
            [loading]="loading"
          ></app-claim-table>

          <app-graph-view
            [claims]="claimsWithMetadata"
            [edges]="graphEdges"
            [loading]="loading"
          ></app-graph-view>
        </div>
      </div>

      <footer class="app-footer">
        <div class="footer-left"></div>
        <div class="footer-right">
          <span class="version-info" *ngIf="engineVersion">
            Engine: {{ engineVersion }}
          </span>
          <span class="metrics-info" *ngIf="latency !== null || cacheHitRate !== null">
            <span *ngIf="latency !== null">Latency: {{ latency }}ms</span>
            <span *ngIf="cacheHitRate !== null"> | Cache: {{ cacheHitRate }}%</span>
          </span>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    .app-container {
      min-height: 100vh;
      padding: 20px;
      max-width: 1800px;
      margin: 0 auto;
    }

    .app-header {
      margin-bottom: 30px;
      text-align: center;
    }

    .app-header h1 {
      font-size: 2.5rem;
      color: #1a1a1a;
      margin-bottom: 8px;
    }

    .subtitle {
      color: #666;
      font-size: 1.1rem;
    }

    .main-layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    .left-column,
    .right-column {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    @media (max-width: 1400px) {
      .main-layout {
        grid-template-columns: 1fr;
      }
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }

    .header-left {
      display: flex;
      align-items: center;
    }

    .header-title {
      flex: 1;
      text-align: center;
    }

    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .header-actions a.active {
      background-color: #1976d2;
      color: white;
    }

    .app-footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: #666;
    }

    .footer-right {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .version-info,
    .metrics-info {
      font-family: monospace;
    }
  `]
})
export class OriginalQaComponent implements OnInit {
  loading = false;
  result: ValidateOutput | null = null;
  claimsWithMetadata: ClaimWithMetadata[] = [];
  graphEdges: GraphEdge[] = [];
  engineVersion: string | null = null;
  latency: number | null = null;
  cacheHitRate: number | null = null;
  validationStartTime: number | null = null;

  currentQuestion = '';
  currentAnswer = '';
  currentSources: { id: string; text: string }[] | undefined = undefined;
  currentOptions: any = {};

  constructor(private tclService: TclService) {}

  ngOnInit() {
    this.readUrlParameters();
    this.getEngineVersion();
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
      
      this.currentQuestion = decodedQuestion;
      this.currentAnswer = decodedAnswer;
      this.currentSources = decodedSources;
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

      if (decodedQuestion && decodedAnswer) {
        setTimeout(() => {
          this.onValidate({
            question: decodedQuestion,
            answer: decodedAnswer,
            sources: decodedSources,
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
      }
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
      graph.supports.forEach((edge: SupportEdge) => {
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

      graph.contradictions.forEach((edge: ContradictionEdge) => {
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

      graph.grounding.forEach((edge: GroundingEdge) => {
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
        question: this.currentQuestion,
        answer: this.currentAnswer,
        sources: this.currentSources,
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
    a.download = `tcl-report-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  shareLink() {
    if (!this.currentQuestion || !this.currentAnswer) {
      alert('No question and answer to share. Please validate first.');
      return;
    }

    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    
    params.set('q', encodeURIComponent(this.currentQuestion));
    params.set('a', encodeURIComponent(this.currentAnswer));
    
    if (this.currentOptions.spectral) params.set('spectral', '1');
    if (this.currentOptions.ann) params.set('ann', '1');
    if (this.currentOptions.cache) params.set('cache', '1');
    
    if (this.currentOptions.supportThreshold !== undefined) {
      params.set('st', this.currentOptions.supportThreshold.toString());
    }
    if (this.currentOptions.contradictionThreshold !== undefined) {
      params.set('ct', this.currentOptions.contradictionThreshold.toString());
    }
    if (this.currentOptions.groundingThreshold !== undefined) {
      params.set('gt', this.currentOptions.groundingThreshold.toString());
    }
    if (this.currentOptions.maxPairwiseEdges !== undefined) {
      params.set('mpe', this.currentOptions.maxPairwiseEdges.toString());
    }
    if (this.currentOptions.neighborK !== undefined) {
      params.set('nk', this.currentOptions.neighborK.toString());
    }

    if (this.currentSources && this.currentSources.length > 0) {
      const totalLength = this.currentSources.reduce((sum, s) => sum + s.text.length, 0);
      if (this.currentSources.length <= 5 && totalLength <= 5000) {
        params.set('sources', encodeURIComponent(JSON.stringify(this.currentSources)));
      }
    }

    const shareUrl = `${baseUrl}?${params.toString()}`;
    
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('Share link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this link:', shareUrl);
    });
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

