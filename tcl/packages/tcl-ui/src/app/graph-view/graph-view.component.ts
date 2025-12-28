import { Component, Input, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import * as d3 from 'd3';
import { ClaimWithMetadata, GraphEdge } from '../types';

type ViewType = 'force' | 'matrix' | 'circular' | 'hierarchical';

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonToggleModule,
    MatTooltipModule
  ],
  template: `
    <mat-card class="graph-card">
      <mat-card-header>
        <div class="header-content">
          <mat-card-title>Graph View</mat-card-title>
          <mat-button-toggle-group 
            *ngIf="!loading && claims.length > 0 && edges.length > 0"
            [(value)]="viewType" 
            (change)="onViewChange()"
            class="view-toggle">
            <mat-button-toggle value="force" matTooltip="Force-directed graph (best for exploration)">
              <mat-icon>account_tree</mat-icon>
              <span>Force</span>
            </mat-button-toggle>
            <mat-button-toggle value="circular" matTooltip="Circular layout (clean, shows all relationships)">
              <mat-icon>radio_button_unchecked</mat-icon>
              <span>Circular</span>
            </mat-button-toggle>
            <mat-button-toggle value="hierarchical" matTooltip="Hierarchical view (sources → claims → supports)">
              <mat-icon>vertical_align_center</mat-icon>
              <span>Layered</span>
            </mat-button-toggle>
          </mat-button-toggle-group>
        </div>
      </mat-card-header>
      <mat-card-content>
        <div *ngIf="loading" class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>

        <div *ngIf="!loading && (claims.length === 0 || edges.length === 0)" class="empty-state">
          <mat-icon>account_tree</mat-icon>
          <p *ngIf="claims.length === 0">No claims to display</p>
          <p *ngIf="claims.length > 0 && edges.length === 0">Graph not available from engine<br><small>No edges above threshold</small></p>
        </div>

        <div *ngIf="!loading && claims.length > 0 && edges.length > 0" class="graph-legend">
          <div class="legend-item">
            <div class="legend-color" style="background-color: #4caf50;"></div>
            <span>Grounded & Valid</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #ff9800;"></div>
            <span>Has Contradictions</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #f44336;"></div>
            <span>Ungrounded</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #ffc107;"></div>
            <span>In Cycles</span>
          </div>
          <div class="legend-edges">
            <div class="legend-edge">
              <svg width="40" height="20">
                <line x1="0" y1="10" x2="40" y2="10" stroke="#4caf50" stroke-width="2" marker-end="url(#arrow-green)"/>
                <defs>
                  <marker id="arrow-green" viewBox="0 -5 10 10" refX="35" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,-5L10,0L0,5" fill="#4caf50"/>
                  </marker>
                </defs>
              </svg>
              <span>Support</span>
            </div>
            <div class="legend-edge">
              <svg width="40" height="20">
                <line x1="0" y1="10" x2="40" y2="10" stroke="#f44336" stroke-width="2" marker-end="url(#arrow-red)"/>
                <defs>
                  <marker id="arrow-red" viewBox="0 -5 10 10" refX="35" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,-5L10,0L0,5" fill="#f44336"/>
                  </marker>
                </defs>
              </svg>
              <span>Contradiction</span>
            </div>
            <div class="legend-edge">
              <svg width="40" height="20">
                <line x1="0" y1="10" x2="40" y2="10" stroke="#2196f3" stroke-width="2" stroke-dasharray="5,5" marker-end="url(#arrow-blue)"/>
                <defs>
                  <marker id="arrow-blue" viewBox="0 -5 10 10" refX="35" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,-5L10,0L0,5" fill="#2196f3"/>
                  </marker>
                </defs>
              </svg>
              <span>Grounding</span>
            </div>
          </div>
        </div>

        <div #graphContainer class="graph-container" [style.display]="viewType === 'force' || viewType === 'circular' || viewType === 'hierarchical' ? 'block' : 'none'"></div>
        <div class="matrix-container" [style.display]="viewType === 'matrix' ? 'block' : 'none'">
          <div class="matrix-wrapper" #matrixContainer></div>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .graph-card {
      min-height: 600px;
    }

    .loading-container {
      display: flex;
      justify-content: center;
      padding: 40px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #666;
      gap: 16px;
      min-height: 400px;
    }

    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #ccc;
    }

    .graph-container {
      width: 100%;
      height: 600px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background: #fafafa;
      overflow: hidden;
    }

    .graph-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 12px;
      margin-bottom: 12px;
      background: #f5f5f5;
      border-radius: 4px;
      font-size: 12px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    .legend-edges {
      display: flex;
      gap: 20px;
      margin-left: auto;
      align-items: center;
    }

    .legend-edge {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .legend-edge svg {
      display: block;
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    .view-toggle {
      margin-left: auto;
    }

    .view-toggle mat-button-toggle {
      font-size: 12px;
    }

    .view-toggle mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }

    .matrix-container {
      width: 100%;
      overflow: auto;
      max-height: 600px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background: #fafafa;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.06);
    }

    .matrix-wrapper {
      display: inline-block;
      padding: 8px;
    }

    .matrix-table {
      border-collapse: separate;
      border-spacing: 2px;
      font-size: 12px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .matrix-table th,
    .matrix-table td {
      border: none;
      padding: 6px 8px;
      text-align: center;
      position: relative;
      background: #fff;
    }

    .matrix-table th {
      background: linear-gradient(to bottom, #f8f9fa, #e9ecef);
      font-weight: 600;
      position: sticky;
      z-index: 10;
      color: #495057;
      border-bottom: 2px solid #dee2e6;
    }

    .matrix-table th:first-child {
      left: 0;
      z-index: 20;
      background: linear-gradient(to right, #f8f9fa, #e9ecef);
      min-width: 120px;
      max-width: 120px;
      text-align: left;
      font-size: 11px;
      padding: 8px 10px;
    }

    .matrix-table th:not(:first-child) {
      top: 0;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      min-width: 35px;
      max-width: 35px;
      height: 120px;
      padding: 8px 2px;
      font-size: 10px;
      white-space: nowrap;
    }

    .matrix-table td:first-child {
      position: sticky;
      left: 0;
      background: #f8f9fa;
      z-index: 5;
      text-align: left;
      font-weight: 600;
      min-width: 120px;
      max-width: 120px;
      font-size: 11px;
      padding: 8px 10px;
      color: #495057;
      border-right: 2px solid #dee2e6;
    }

    .matrix-table td {
      padding: 2px;
      vertical-align: middle;
    }

    .matrix-cell {
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-radius: 3px;
      position: relative;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }

    .matrix-cell:hover {
      transform: scale(1.15);
      z-index: 15;
      box-shadow: 0 3px 8px rgba(0,0,0,0.25);
    }

    .matrix-cell.support {
      background: linear-gradient(135deg, #4caf50, #45a049);
      border: 1px solid #388e3c;
    }

    .matrix-cell.contradiction {
      background: linear-gradient(135deg, #f44336, #e53935);
      border: 1px solid #c62828;
    }

    .matrix-cell.grounding {
      background: linear-gradient(135deg, #2196f3, #1e88e5);
      border: 1px solid #1565c0;
      background-image: repeating-linear-gradient(
        45deg,
        transparent,
        transparent 3px,
        rgba(255,255,255,0.2) 3px,
        rgba(255,255,255,0.2) 6px
      );
    }

    .matrix-cell.multiple {
      background: linear-gradient(135deg, 
        #4caf50 0%, #4caf50 33%, 
        #f44336 33%, #f44336 66%, 
        #2196f3 66%, #2196f3 100%);
      border: 1px solid #666;
    }

    .matrix-cell-weight {
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,0.6);
      line-height: 1;
    }

    .matrix-tooltip {
      position: fixed;
      background: rgba(33, 33, 33, 0.95);
      color: #fff;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      pointer-events: none;
      z-index: 10000;
      max-width: 350px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.1);
      line-height: 1.5;
    }

    .matrix-tooltip strong {
      color: #64b5f6;
      font-weight: 600;
    }
  `]
})
export class GraphViewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('graphContainer', { static: false }) graphContainer!: ElementRef;
  @ViewChild('matrixContainer', { static: false }) matrixContainer!: ElementRef;
  @Input() claims: ClaimWithMetadata[] = [];
  @Input() edges: GraphEdge[] = [];
  @Input() loading = false;

  viewType: ViewType = 'force';

  private svg: any;
  private simulation: any;
  private width = 800;
  private height = 600;
  private matrixTooltip: HTMLElement | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit() {
    if (this.claims.length > 0 && this.edges.length > 0) {
      if ((this.viewType === 'force' || this.viewType === 'circular' || this.viewType === 'hierarchical') && this.graphContainer) {
        this.width = this.graphContainer.nativeElement.offsetWidth || 800;
        this.height = this.graphContainer.nativeElement.offsetHeight || 600;
        this.initGraph();
      } else if (this.viewType === 'matrix' && this.matrixContainer) {
        this.renderMatrix();
      }
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['claims'] || changes['edges']) {
      // If edges become empty, clear the graph completely
      if (this.edges.length === 0 || this.claims.length === 0) {
        this.clearGraph();
        this.clearMatrix();
        return;
      }
      
      // Only render graph if we have both claims and edges
      if (this.claims.length > 0 && this.edges.length > 0) {
        if (this.viewType === 'force' || this.viewType === 'circular' || this.viewType === 'hierarchical') {
          if (this.svg) {
            this.updateGraph();
          } else if (this.graphContainer) {
            this.width = this.graphContainer.nativeElement.offsetWidth || 800;
            this.height = this.graphContainer.nativeElement.offsetHeight || 600;
            this.initGraph();
          }
        } else if (this.viewType === 'matrix') {
          this.renderMatrix();
        }
      }
    }
  }

  onViewChange() {
    if (this.claims.length === 0 || this.edges.length === 0) return;
    
    // Use setTimeout to ensure DOM is updated after view change
    setTimeout(() => {
      if (this.viewType === 'force' || this.viewType === 'circular' || this.viewType === 'hierarchical') {
        this.clearMatrix();
        if (this.svg) {
          this.updateGraph();
        } else if (this.graphContainer) {
          this.width = this.graphContainer.nativeElement.offsetWidth || 800;
          this.height = this.graphContainer.nativeElement.offsetHeight || 600;
          this.initGraph();
        }
      } else if (this.viewType === 'matrix') {
        this.clearGraph();
        // Container should now always be available (using display instead of *ngIf)
        if (this.matrixContainer && this.matrixContainer.nativeElement) {
          this.renderMatrix();
        } else {
          // Fallback: wait a tick if container not ready
          setTimeout(() => {
            if (this.matrixContainer && this.matrixContainer.nativeElement) {
              this.renderMatrix();
            }
          }, 0);
        }
      }
    }, 0);
  }

  private initGraph() {
    if (!this.graphContainer) return;

    // Clear existing SVG
    d3.select(this.graphContainer.nativeElement).selectAll('*').remove();

    // Create SVG
    this.svg = d3.select(this.graphContainer.nativeElement)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height);

    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        this.svg.select('g').attr('transform', event.transform);
      });

    this.svg.call(zoom);

    // Create container group for zoom
    const g = this.svg.append('g');

    // Create arrow markers
    const defs = g.append('defs');

    // Support arrow (green)
    defs.append('marker')
      .attr('id', 'arrow-support')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#4caf50');

    // Contradiction arrow (red)
    defs.append('marker')
      .attr('id', 'arrow-contradiction')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#f44336');

    // Grounding arrow (dashed, blue)
    defs.append('marker')
      .attr('id', 'arrow-grounding')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#2196f3');

    this.updateGraph();
  }

  private clearGraph() {
    // Stop simulation if running
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    
    // Clear SVG content
    if (this.svg) {
      this.svg.selectAll('*').remove();
      this.svg = null;
    }
    
    // Also clear the container directly
    if (this.graphContainer) {
      d3.select(this.graphContainer.nativeElement).selectAll('*').remove();
    }
  }

  private updateGraph() {
    if (!this.svg || this.claims.length === 0 || this.edges.length === 0) {
      this.clearGraph();
      return;
    }

    const g = this.svg.select('g');
    if (g.empty()) return;

    // Prepare nodes
    const nodes = this.claims.map(claim => ({
      id: claim.id,
      label: claim.text.length > 50 ? claim.text.substring(0, 50) + '...' : claim.text,
      fullText: claim.text,
      grounded: claim.grounded,
      inCycles: claim.inCycles,
      contradictionCount: claim.contradictionCount,
    }));

    // Prepare links
    const links = this.edges.map(edge => ({
      source: edge.from,
      target: edge.to,
      type: edge.type,
      weight: edge.weight,
    }));

    // Clear existing elements
    g.selectAll('.link').remove();
    g.selectAll('.node').remove();

    // Initialize node positions based on view type
    if (this.viewType === 'circular') {
      // Arrange nodes in a circle
      const radius = Math.min(this.width, this.height) / 3;
      const angleStep = (2 * Math.PI) / nodes.length;
      nodes.forEach((node: any, i: number) => {
        node.x = this.width / 2 + radius * Math.cos(i * angleStep - Math.PI / 2);
        node.y = this.height / 2 + radius * Math.sin(i * angleStep - Math.PI / 2);
        node.fx = node.x;
        node.fy = node.y;
      });
    } else if (this.viewType === 'hierarchical') {
      // Arrange nodes in layers: grounded claims at bottom, ungrounded in middle, supports flow up
      const grounded = nodes.filter((n: any) => n.grounded);
      const ungrounded = nodes.filter((n: any) => !n.grounded);
      const layerHeight = this.height / 3;
      const spacing = this.width / (Math.max(grounded.length, ungrounded.length) + 1);
      
      grounded.forEach((node: any, i: number) => {
        node.x = spacing * (i + 1);
        node.y = this.height - 50;
        node.fx = node.x;
        node.fy = node.y;
      });
      
      ungrounded.forEach((node: any, i: number) => {
        node.x = spacing * (i + 1);
        node.y = layerHeight;
        node.fx = node.x;
        node.fy = node.y;
      });
    }

    // Create force simulation with layout-specific settings
    let simulation: any;
    
    if (this.viewType === 'circular') {
      // Circular layout: weak forces to maintain circle, but allow some movement
      simulation = d3.forceSimulation(nodes as any)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(150))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(this.width / 2, this.height / 2))
        .force('collision', d3.forceCollide().radius(60))
        .alphaDecay(0.1); // Slower decay to maintain positions
    } else if (this.viewType === 'hierarchical') {
      // Hierarchical layout: strong vertical forces, weak horizontal
      simulation = d3.forceSimulation(nodes as any)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-500))
        .force('center', d3.forceCenter(this.width / 2, this.height / 2))
        .force('y', d3.forceY().strength(0.3).y((d: any) => d.fy || this.height / 2))
        .force('collision', d3.forceCollide().radius(70))
        .alphaDecay(0.15);
    } else {
      // Force-directed (default)
      simulation = d3.forceSimulation(nodes as any)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(200))
        .force('charge', d3.forceManyBody().strength(-800))
        .force('center', d3.forceCenter(this.width / 2, this.height / 2))
        .force('collision', d3.forceCollide().radius((d: any) => {
          const labelLength = d.label ? d.label.length : 0;
          return Math.max(70, 50 + labelLength * 3);
        }));
    }
    
    this.simulation = simulation;

    // Draw links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('class', 'link')
      .attr('stroke-width', (d: any) => Math.sqrt(d.weight) * 2)
      .attr('stroke', (d: any) => {
        if (d.type === 'support') return '#4caf50';
        if (d.type === 'contradiction') return '#f44336';
        return '#2196f3';
      })
      .attr('stroke-dasharray', (d: any) => d.type === 'grounding' ? '5,5' : '0')
      .attr('marker-end', (d: any) => {
        if (d.type === 'support') return 'url(#arrow-support)';
        if (d.type === 'contradiction') return 'url(#arrow-contradiction)';
        return 'url(#arrow-grounding)';
      });

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .call(this.drag(this.simulation) as any);

    // Add circles for nodes
    node.append('circle')
      .attr('r', 20)
      .attr('fill', (d: any) => {
        if (d.inCycles && !d.grounded) return '#ff9800'; // Ungrounded cycles
        if (d.inCycles) return '#ffc107'; // Cycles
        if (!d.grounded) return '#f44336'; // Ungrounded
        if (d.contradictionCount > 0) return '#ff9800'; // Has contradictions
        return '#4caf50'; // Good
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // Add labels with better positioning and wrapping
    const labels = node.append('text')
      .text((d: any) => {
        // Truncate long labels
        const maxLength = 40;
        return d.label && d.label.length > maxLength 
          ? d.label.substring(0, maxLength) + '...' 
          : d.label;
      })
      .attr('dx', 30)
      .attr('dy', 5)
      .attr('font-size', '11px')
      .attr('fill', '#333')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'start')
      .style('user-select', 'none');
    
    // Add background rectangles for better readability
    labels.each(function(this: SVGTextElement, d: any) {
      const text = d3.select(this);
      const bbox = this.getBBox();
      const padding = 4;
      const parentNode = this.parentNode as SVGElement;
      d3.select(parentNode)
        .insert('rect', 'text')
        .attr('x', bbox.x - padding)
        .attr('y', bbox.y - padding)
        .attr('width', bbox.width + padding * 2)
        .attr('height', bbox.height + padding * 2)
        .attr('fill', 'rgba(255, 255, 255, 0.9)')
        .attr('stroke', '#ddd')
        .attr('stroke-width', 1)
        .attr('rx', 3)
        .lower();
    });

    // Add tooltips
    node.append('title')
      .text((d: any) => d.fullText);

    // Update positions on tick
    this.simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });
  }

  private drag(simulation: any) {
    return d3.drag()
      .on('start', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        // For circular and hierarchical, allow movement but don't lock position initially
        if (this.viewType === 'force') {
          d.fx = d.x;
          d.fy = d.y;
        }
      })
      .on('drag', (event: any, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
        // For circular/hierarchical, allow free movement when dragging
      })
      .on('end', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        // For force-directed, release the node
        if (this.viewType === 'force') {
          d.fx = null;
          d.fy = null;
        }
        // For circular/hierarchical, keep the dragged position
        // (user can double-click to reset if needed)
      });
  }

  private clearMatrix() {
    if (this.matrixContainer) {
      this.matrixContainer.nativeElement.innerHTML = '';
    }
    if (this.matrixTooltip) {
      this.matrixTooltip.remove();
      this.matrixTooltip = null;
    }
  }

  private renderMatrix() {
    if (!this.matrixContainer || !this.matrixContainer.nativeElement || this.claims.length === 0 || this.edges.length === 0) {
      console.warn('Matrix render skipped:', {
        hasContainer: !!this.matrixContainer,
        hasNativeElement: !!this.matrixContainer?.nativeElement,
        claimsCount: this.claims.length,
        edgesCount: this.edges.length
      });
      return;
    }

    // Clear existing matrix
    this.clearMatrix();

    // Create edge map for quick lookup
    const edgeMap = new Map<string, { type: string; weight: number }[]>();
    
    this.edges.forEach(edge => {
      const key = `${edge.from}::${edge.to}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, []);
      }
      edgeMap.get(key)!.push({ type: edge.type, weight: edge.weight });
    });

    // Create table
    const table = document.createElement('table');
    table.className = 'matrix-table';

    // Create header row
    const headerRow = document.createElement('tr');
    const emptyHeader = document.createElement('th');
    headerRow.appendChild(emptyHeader);

    this.claims.forEach((claim, index) => {
      const th = document.createElement('th');
      // Show shortened claim ID or index
      const displayText = claim.id.length > 8 ? `C${index + 1}` : claim.id;
      th.textContent = displayText;
      th.title = `${claim.id}\n${claim.text.length > 80 ? claim.text.substring(0, 80) + '...' : claim.text}`;
      headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Create data rows
    this.claims.forEach((claimRow, rowIndex) => {
      const tr = document.createElement('tr');
      
      // Row header (claim ID with truncated text)
      const rowHeader = document.createElement('td');
      const rowText = document.createElement('div');
      rowText.style.cssText = 'font-size: 10px; line-height: 1.3;';
      const claimIdSpan = document.createElement('strong');
      claimIdSpan.textContent = claimRow.id;
      claimIdSpan.style.cssText = 'display: block; margin-bottom: 2px;';
      const claimTextSpan = document.createElement('span');
      claimTextSpan.textContent = claimRow.text.length > 50 ? claimRow.text.substring(0, 50) + '...' : claimRow.text;
      claimTextSpan.style.cssText = 'color: #666; font-size: 9px;';
      rowText.appendChild(claimIdSpan);
      rowText.appendChild(claimTextSpan);
      rowHeader.appendChild(rowText);
      rowHeader.title = `${claimRow.id}\n${claimRow.text}`;
      tr.appendChild(rowHeader);

      // Data cells
      this.claims.forEach((claimCol, colIndex) => {
        const td = document.createElement('td');
        
        if (rowIndex === colIndex) {
          // Diagonal - show claim status with better styling
          const diagonalCell = document.createElement('div');
          diagonalCell.style.cssText = `
            width: 32px;
            height: 32px;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 16px;
            background: ${claimRow.grounded ? 'linear-gradient(135deg, #c8e6c9, #a5d6a7)' : 'linear-gradient(135deg, #ffcdd2, #ef9a9a)'};
            color: ${claimRow.grounded ? '#2e7d32' : '#c62828'};
            border: 2px solid ${claimRow.grounded ? '#4caf50' : '#f44336'};
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          `;
          diagonalCell.textContent = claimRow.grounded ? '✓' : '✗';
          diagonalCell.title = `Claim ${claimRow.id}: ${claimRow.grounded ? 'Grounded' : 'Ungrounded'}\n${claimRow.text.substring(0, 100)}${claimRow.text.length > 100 ? '...' : ''}`;
          td.appendChild(diagonalCell);
        } else {
          // Check for edges
          const key = `${claimRow.id}::${claimCol.id}`;
          const reverseKey = `${claimCol.id}::${claimRow.id}`;
          const edges = edgeMap.get(key) || edgeMap.get(reverseKey) || [];

          if (edges.length > 0) {
            const cell = document.createElement('div');
            cell.className = 'matrix-cell';
            
            // Determine cell styling based on edge types
            const hasSupport = edges.some(e => e.type === 'support');
            const hasContradiction = edges.some(e => e.type === 'contradiction');
            const hasGrounding = edges.some(e => e.type === 'grounding');
            
            if (edges.length > 1) {
              cell.classList.add('multiple');
            } else if (hasSupport) {
              cell.classList.add('support');
            } else if (hasContradiction) {
              cell.classList.add('contradiction');
            } else if (hasGrounding) {
              cell.classList.add('grounding');
            }

            // Show weight if single edge, or count if multiple
            const weightSpan = document.createElement('span');
            weightSpan.className = 'matrix-cell-weight';
            if (edges.length === 1) {
              weightSpan.textContent = edges[0].weight.toFixed(1);
            } else {
              weightSpan.textContent = `${edges.length}x`;
            }
            cell.appendChild(weightSpan);

            // Tooltip content
            const tooltipText = edges.map(e => 
              `${e.type} (${e.weight.toFixed(2)})`
            ).join(', ');
            
            cell.title = `${claimRow.id} → ${claimCol.id}: ${tooltipText}`;
            
            // Add hover tooltip
            cell.addEventListener('mouseenter', (e) => this.showMatrixTooltip(e, claimRow, claimCol, edges));
            cell.addEventListener('mouseleave', () => this.hideMatrixTooltip());
            cell.addEventListener('mousemove', (e) => this.updateMatrixTooltipPosition(e));

            td.appendChild(cell);
          }
        }

        tr.appendChild(td);
      });

      table.appendChild(tr);
    });

    this.matrixContainer.nativeElement.appendChild(table);
  }

  private showMatrixTooltip(event: MouseEvent, claimRow: ClaimWithMetadata, claimCol: ClaimWithMetadata, edges: { type: string; weight: number }[]) {
    if (!this.matrixTooltip) {
      this.matrixTooltip = document.createElement('div');
      this.matrixTooltip.className = 'matrix-tooltip';
      document.body.appendChild(this.matrixTooltip);
    }

    const edgeDetails = edges.map(e => {
      const color = e.type === 'support' ? '#4caf50' : e.type === 'contradiction' ? '#f44336' : '#2196f3';
      return `<span style="color: ${color}; font-weight: 600;">${e.type}</span>: ${e.weight.toFixed(2)}`;
    }).join('<br>');

    this.matrixTooltip.innerHTML = `
      <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px;">
        ${claimRow.id} → ${claimCol.id}
      </div>
      <div style="margin-bottom: 8px;">${edgeDetails}</div>
      <div style="font-size: 11px; opacity: 0.9; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
        <div style="margin-bottom: 4px;"><strong style="color: #90caf9;">From:</strong> ${claimRow.text.substring(0, 70)}${claimRow.text.length > 70 ? '...' : ''}</div>
        <div><strong style="color: #90caf9;">To:</strong> ${claimCol.text.substring(0, 70)}${claimCol.text.length > 70 ? '...' : ''}</div>
      </div>
    `;

    this.updateMatrixTooltipPosition(event);
    this.matrixTooltip.style.display = 'block';
  }

  private updateMatrixTooltipPosition(event: MouseEvent) {
    if (!this.matrixTooltip) return;
    
    const x = event.clientX + 10;
    const y = event.clientY + 10;
    
    this.matrixTooltip.style.left = `${x}px`;
    this.matrixTooltip.style.top = `${y}px`;
  }

  private hideMatrixTooltip() {
    if (this.matrixTooltip) {
      this.matrixTooltip.style.display = 'none';
    }
  }

  ngOnDestroy() {
    this.clearGraph();
    this.clearMatrix();
    if (this.matrixTooltip) {
      this.matrixTooltip.remove();
      this.matrixTooltip = null;
    }
  }
}

