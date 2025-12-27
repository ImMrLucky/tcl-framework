import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputPanelComponent } from './input-panel/input-panel.component';
import { SummaryPanelComponent } from './summary-panel/summary-panel.component';
import { ClaimTableComponent } from './claim-table/claim-table.component';
import { GraphViewComponent } from './graph-view/graph-view.component';
import { TclService } from './tcl.service';
import { ValidateOutput, ClaimWithMetadata, GraphEdge, SupportEdge, ContradictionEdge, GroundingEdge } from './types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    InputPanelComponent,
    SummaryPanelComponent,
    ClaimTableComponent,
    GraphViewComponent
  ],
  template: `
    <div class="app-container">
      <header class="app-header">
        <h1>TCL Framework Demo</h1>
        <p class="subtitle">Truth & Consistency Layer - Reasoning Structure Visualization</p>
      </header>

      <div class="main-layout">
        <div class="left-column">
          <app-input-panel
            (validate)="onValidate($event)"
            [loading]="loading"
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
  `]
})
export class AppComponent {
  loading = false;
  result: ValidateOutput | null = null;
  claimsWithMetadata: ClaimWithMetadata[] = [];
  graphEdges: GraphEdge[] = [];
  
  

  constructor(private tclService: TclService) {}

  onValidate(event: {
    question: string;
    answer: string;
    sources?: { id: string; text: string }[];
    options: { spectral: boolean; ann: boolean; cache: boolean };
  }) {
    this.loading = true;
    this.result = null;
    this.claimsWithMetadata = [];
    this.graphEdges = [];

    this.tclService.validate(
      event.question,
      event.answer,
      event.sources,
      {
        spectral: event.options.spectral,
        ann: event.options.ann,
        cache: event.options.cache,
      }
    ).subscribe({
      next: (result) => {
        this.result = result;
        this.processResult(result);
        this.loading = false;
      },
      error: (error) => {
        console.error('Validation error:', error);
        alert('Error: ' + (error.error?.error || error.message || 'Unknown error'));
        this.loading = false;
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

