import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputPanelComponent } from './input-panel/input-panel.component';
import { SummaryPanelComponent } from './summary-panel/summary-panel.component';
import { ClaimTableComponent } from './claim-table/claim-table.component';
import { GraphViewComponent } from './graph-view/graph-view.component';
import { TclService } from './tcl.service';
import { ValidateOutput, ClaimWithMetadata, GraphEdge, SupportEdge, ContradictionEdge, GroundingEdge } from './types';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    InputPanelComponent,
    SummaryPanelComponent,
    ClaimTableComponent,
    GraphViewComponent,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ],
  template: `
    <div class="app-container">
      <header class="app-header">
        <div class="header-content">
          <div class="header-title">
            <h1>TCL Framework Demo</h1>
            <p class="subtitle">Truth & Consistency Layer - Reasoning Structure Visualization</p>
          </div>
          <div class="header-actions" *ngIf="result">
            <button
              mat-icon-button
              matTooltip="Download Report JSON"
              (click)="downloadReport()"
              color="primary"
            >
              <mat-icon>download</mat-icon>
            </button>
            <button
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
          <app-input-panel
            (validate)="onValidate($event)"
            [loading]="loading"
            [initialQuestion]="currentQuestion"
            [initialAnswer]="currentAnswer"
            [initialSources]="currentSources"
            [initialOptions]="currentOptions"
          ></app-input-panel>

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

    .header-title {
      flex: 1;
    }

    .header-actions {
      display: flex;
      gap: 8px;
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
export class AppComponent implements OnInit {
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
  currentOptions: any = {};

  constructor(private tclService: TclService) {}

  ngOnInit() {
    // Read URL parameters on init
    this.readUrlParameters();
    // Get engine version
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
      // Decode and set values (ONLY inputs, never results)
      const decodedQuestion = question ? decodeURIComponent(question) : '';
      const decodedAnswer = answer ? decodeURIComponent(answer) : '';
      
      // Decode sources if present
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

      // Auto-run if both question and answer are provided
      // This will call /validate and generate fresh results
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

  private getEngineVersion() {
    // Try to get version from backend health endpoint or environment
    // For now, we'll use a placeholder - you can add a /version endpoint to backend
    this.engineVersion = 'v0.2.0'; // TODO: Get from backend
  }

  downloadReport() {
    if (!this.result) return;

    const report = {
      ...this.result,
      metadata: {
        timestamp: new Date().toISOString(),
        question: this.currentQuestion,
        answer: this.currentAnswer,
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
      alert('No validation data to share. Please run a validation first.');
      return;
    }

    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    
    // Encode ONLY inputs - never results
    params.set('q', encodeURIComponent(this.currentQuestion));
    params.set('a', encodeURIComponent(this.currentAnswer));
    
    // Encode options (spectral, ann, cache)
    if (this.currentOptions.spectral) params.set('spectral', '1');
    if (this.currentOptions.ann) params.set('ann', '1');
    if (this.currentOptions.cache) params.set('cache', '1');
    
    // Encode thresholds (optional)
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

    // Encode sources ONLY if they exist and are small (max 5 sources, each max 500 chars)
    if (this.currentSources && this.currentSources.length > 0) {
      const totalLength = this.currentSources.reduce((sum, s) => sum + s.text.length, 0);
      const maxTotalLength = 5000; // Total max 5KB for all sources
      const maxSources = 5;
      
      if (this.currentSources.length <= maxSources && totalLength <= maxTotalLength) {
        // Encode sources as JSON array (compact)
        const sourcesData = this.currentSources.map(s => ({
          id: s.id,
          text: s.text
        }));
        params.set('sources', encodeURIComponent(JSON.stringify(sourcesData)));
      } else {
        console.warn('Sources too large to encode in share link. Skipping sources.');
      }
    }

    // DO NOT encode any results:
    // - coherenceScore
    // - graph
    // - claims
    // - spectral metrics
    // - scores
    // - violations
    // These must be regenerated by calling /validate

    const shareUrl = `${baseUrl}?${params.toString()}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('Share link copied to clipboard!');
    }).catch(() => {
      // Fallback: show in prompt
      prompt('Copy this link:', shareUrl);
    });
  }

  onValidate(event: {
    question: string;
    answer: string;
    sources?: { id: string; text: string }[];
    options: {
      spectral: boolean;
      ann: boolean;
      cache: boolean;
      supportThreshold?: number;
      contradictionThreshold?: number;
      groundingThreshold?: number;
      maxPairwiseEdges?: number;
      neighborK?: number;
    };
  }) {
    this.loading = true;
    this.result = null;
    this.claimsWithMetadata = [];
    this.graphEdges = [];
    this.latency = null;
    this.cacheHitRate = null;
    
    // Store current inputs for share link (ONLY inputs, never results)
    this.currentQuestion = event.question;
    this.currentAnswer = event.answer;
    this.currentSources = event.sources;
    this.currentOptions = event.options;

    // Track start time for latency
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
      next: (result) => {
        // Calculate latency
        if (this.validationStartTime) {
          this.latency = Date.now() - this.validationStartTime;
        }
        
        // Extract cache hit rate and engine version from result
        this.cacheHitRate = result.cacheHitRate ?? null;
        if (result.engineVersion) {
          this.engineVersion = result.engineVersion;
        }
        
        this.result = result;
        this.processResult(result);
        this.loading = false;
      },
      error: (error) => {
        console.error('Validation error:', error);
        alert('Error: ' + (error.error?.error || error.message || 'Unknown error'));
        this.loading = false;
        this.validationStartTime = null;
      }
    });
  }

  private processResult(result: ValidateOutput) {
    const { claims, contradictions: reportContradictions, missingEvidence, spectral, graph } = result.report;
    
    // Build claim metadata
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

    // Build graph edges - ONLY use data explicitly provided by backend
    // No inference, no heuristics, no fallbacks
    const supports: GraphEdge[] = [];
    const contradictionEdges: GraphEdge[] = [];
    const grounding: GraphEdge[] = [];

    // Use graph edges from backend if available
    if (graph) {
      // Process support edges from graph
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

      // Process contradiction edges from graph (these are from semantic analysis)
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

      // Process grounding edges from graph
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

    // Also process contradictions from report (rule-based contradictions)
    // These are explicitly provided by the backend, so we include them
    reportContradictions.forEach(cont => {
      const claimA = claimMap.get(cont.claimA);
      const claimB = claimMap.get(cont.claimB);
      if (claimA && claimB) {
        // Only add if not already in graph contradictions
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

    // Note: We only use data explicitly provided by the backend.
    // No fallback inference, no heuristic cycle marking.
    // If graph is missing or empty, we show an empty graph with a message.

    this.claimsWithMetadata = Array.from(claimMap.values());
    this.graphEdges = [...supports, ...contradictionEdges, ...grounding];
  }
}

