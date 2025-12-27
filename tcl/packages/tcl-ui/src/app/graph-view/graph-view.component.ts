import { Component, Input, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import * as d3 from 'd3';
import { ClaimWithMetadata, GraphEdge } from '../types';

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule
  ],
  template: `
    <mat-card class="graph-card">
      <mat-card-header>
        <mat-card-title>Graph View</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <div *ngIf="loading" class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>

        <div *ngIf="!loading && (claims.length === 0 || edges.length === 0)" class="empty-state">
          <mat-icon>account_tree</mat-icon>
          <p>No graph data to display</p>
        </div>

        <div #graphContainer class="graph-container"></div>
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
  `]
})
export class GraphViewComponent implements AfterViewInit, OnChanges {
  @ViewChild('graphContainer', { static: false }) graphContainer!: ElementRef;
  @Input() claims: ClaimWithMetadata[] = [];
  @Input() edges: GraphEdge[] = [];
  @Input() loading = false;

  private svg: any;
  private simulation: any;
  private width = 800;
  private height = 600;

  ngAfterViewInit() {
    if (this.graphContainer) {
      this.width = this.graphContainer.nativeElement.offsetWidth || 800;
      this.height = this.graphContainer.nativeElement.offsetHeight || 600;
      if (this.claims.length > 0 && this.edges.length > 0) {
        this.initGraph();
      }
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['claims'] || changes['edges']) {
      if (this.claims.length > 0 && this.edges.length > 0) {
        if (this.svg) {
          this.updateGraph();
        } else if (this.graphContainer) {
          this.width = this.graphContainer.nativeElement.offsetWidth || 800;
          this.height = this.graphContainer.nativeElement.offsetHeight || 600;
          this.initGraph();
        }
      }
    }
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

  private updateGraph() {
    if (!this.svg || this.claims.length === 0 || this.edges.length === 0) return;

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

    // Create force simulation with better spacing
    this.simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(150))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => {
        // Larger radius for nodes with longer labels
        const labelLength = d.label ? d.label.length : 0;
        return Math.max(50, 30 + labelLength * 2);
      }));

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
    labels.each(function(d: any) {
      const text = d3.select(this);
      const bbox = (this as SVGTextElement).getBBox();
      const padding = 4;
      d3.select(this.parentNode)
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
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: any, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }
}

