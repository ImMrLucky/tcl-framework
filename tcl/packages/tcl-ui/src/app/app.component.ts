import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputPanelComponent } from './input-panel/input-panel.component';
import { SummaryPanelComponent } from './summary-panel/summary-panel.component';
import { ClaimTableComponent } from './claim-table/claim-table.component';
import { GraphViewComponent } from './graph-view/graph-view.component';
import { TclService } from './tcl.service';
import { ValidateOutput, ClaimWithMetadata, GraphEdge } from './types';

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

    // Build graph edges - use graph from backend if available, otherwise fallback to inferred
    const supports: GraphEdge[] = [];
    const contradictionEdges: GraphEdge[] = [];
    const grounding: GraphEdge[] = [];

    // Use graph edges from backend if available
    if (graph) {
      // Process support edges from graph
      graph.supports.forEach(edge => {
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
      graph.contradictions.forEach(edge => {
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
      graph.grounding.forEach(edge => {
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

    // Fallback: If no graph provided, infer support relationships (simplified)
    if (!graph || graph.supports.length === 0) {
      for (let i = 0; i < claims.length - 1; i++) {
        const claimA = claims[i];
        const claimB = claims[i + 1];
        const hasContradiction = contradictionEdges.some(
          e => (e.from === claimA.id && e.to === claimB.id) || (e.from === claimB.id && e.to === claimA.id)
        );
        const claimAMeta = claimMap.get(claimA.id);
        const claimBMeta = claimMap.get(claimB.id);
        if (!hasContradiction && claimAMeta?.grounded && claimBMeta?.grounded) {
          if (claimAMeta && claimBMeta) {
            claimAMeta.supportCount++;
            supports.push({
              from: claimA.id,
              to: claimB.id,
              type: 'support',
              weight: 0.6,
            });
          }
        }
      }
    }

    // Fallback: Process grounding from claim evidence if graph grounding not available
    if (!graph || graph.grounding.length === 0) {
      claims.forEach(claim => {
        claim.evidence.forEach(ev => {
          grounding.push({
            from: claim.id,
            to: ev.source_id,
            type: 'grounding',
            weight: ev.weight || 0.5,
          });
        });
      });
    }

    // Detect cycles based on spectral circularity score
    if (spectral?.circularityScore && spectral.circularityScore > 50) {
      // Mark ungrounded claims with contradictions as likely in cycles
      claimMap.forEach(claim => {
        if ((claim.contradictionCount > 0 && !claim.grounded) || 
            (spectral.circularityScore && spectral.circularityScore > 70 && claim.contradictionCount > 0)) {
          claim.inCycles = true;
        }
      });
    }

    this.claimsWithMetadata = Array.from(claimMap.values());
    this.graphEdges = [...supports, ...contradictionEdges, ...grounding];
  }
}

