import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface Claim {
  id: string;
  text: string;
  speaker?: string;
  turnStartIdx?: number;
}

interface Edge {
  claimA: string;
  claimB: string;
  weight?: number;
}

export interface SimulationDialogData {
  evaluationId: string;
  claims: Claim[];
  supports: Edge[];
  contradictions: Edge[];
  grounded: string[];
}

export interface SimulationModifications {
  addClaims: Array<{ text: string; speaker?: string; turnIndex?: number }>;
  removeClaims: string[];
  addSupports: Edge[];
  removeSupports: Edge[];
  addContradictions: Edge[];
  removeContradictions: Edge[];
  addGrounded: string[];
  removeGrounded: string[];
  description: string;
}

@Component({
  selector: 'app-simulation-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatChipsModule,
    MatCheckboxModule,
    MatTabsModule,
    MatTooltipModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>science</mat-icon>
      Create What-If Simulation
    </h2>
    
    <mat-dialog-content>
      <p class="simulation-notice">
        <mat-icon>info</mat-icon>
        This will create a <strong>NEW evaluation</strong> based on the original. 
        The original evaluation remains unchanged and immutable.
      </p>
      
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Simulation Description</mat-label>
        <textarea matInput 
                  [(ngModel)]="description" 
                  placeholder="What hypothesis are you testing?"
                  rows="2"></textarea>
        <mat-hint>Describe what you're trying to explore</mat-hint>
      </mat-form-field>
      
      <mat-tab-group>
        <!-- Remove Claims Tab -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>remove_circle</mat-icon>
            Remove Claims ({{ removedClaims.size }})
          </ng-template>
          <div class="tab-content">
            <p class="tab-description">Select claims to exclude from the simulation:</p>
            <div class="claims-list">
              <div *ngFor="let claim of data.claims" 
                   class="claim-item"
                   [class.removed]="removedClaims.has(claim.id)"
                   (click)="toggleRemoveClaim(claim.id)">
                <mat-checkbox [checked]="removedClaims.has(claim.id)" 
                              (click)="$event.stopPropagation()">
                </mat-checkbox>
                <div class="claim-content">
                  <span class="claim-speaker" [class]="'speaker-' + (claim.speaker?.toLowerCase() || 'unknown')">
                    {{ claim.speaker || 'UNKNOWN' }}
                  </span>
                  <span class="claim-text">{{ claim.text | slice:0:100 }}{{ claim.text.length > 100 ? '...' : '' }}</span>
                </div>
              </div>
            </div>
          </div>
        </mat-tab>
        
        <!-- Add Grounding Tab -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>verified</mat-icon>
            Ground Claims ({{ addedGrounded.size }})
          </ng-template>
          <div class="tab-content">
            <p class="tab-description">Select ungrounded claims to mark as grounded (trusted):</p>
            <div class="claims-list">
              <div *ngFor="let claim of getUngroundedClaims()" 
                   class="claim-item"
                   [class.grounded]="addedGrounded.has(claim.id)"
                   (click)="toggleAddGrounded(claim.id)">
                <mat-checkbox [checked]="addedGrounded.has(claim.id)"
                              (click)="$event.stopPropagation()">
                </mat-checkbox>
                <div class="claim-content">
                  <span class="claim-speaker" [class]="'speaker-' + (claim.speaker?.toLowerCase() || 'unknown')">
                    {{ claim.speaker || 'UNKNOWN' }}
                  </span>
                  <span class="claim-text">{{ claim.text | slice:0:100 }}{{ claim.text.length > 100 ? '...' : '' }}</span>
                </div>
              </div>
              <div *ngIf="getUngroundedClaims().length === 0" class="empty-message">
                All claims are already grounded
              </div>
            </div>
          </div>
        </mat-tab>
        
        <!-- Remove Edges Tab -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>link_off</mat-icon>
            Remove Edges ({{ removedContradictions.length + removedSupports.length }})
          </ng-template>
          <div class="tab-content">
            <p class="tab-description">Select edges to remove from the graph:</p>
            
            <h4 *ngIf="data.contradictions.length > 0">Contradictions</h4>
            <div class="edges-list" *ngIf="data.contradictions.length > 0">
              <div *ngFor="let edge of data.contradictions; let i = index" 
                   class="edge-item"
                   [class.removed]="isContradictionRemoved(edge)"
                   (click)="toggleRemoveContradiction(edge)">
                <mat-checkbox [checked]="isContradictionRemoved(edge)"
                              (click)="$event.stopPropagation()">
                </mat-checkbox>
                <div class="edge-content">
                  <code>{{ edge.claimA | slice:0:20 }}</code>
                  <mat-icon class="edge-icon contradiction">close</mat-icon>
                  <code>{{ edge.claimB | slice:0:20 }}</code>
                  <span class="edge-weight">({{ edge.weight?.toFixed(2) || '1.00' }})</span>
                </div>
              </div>
            </div>
            
            <h4 *ngIf="data.supports.length > 0">Supports</h4>
            <div class="edges-list" *ngIf="data.supports.length > 0">
              <div *ngFor="let edge of data.supports; let i = index" 
                   class="edge-item"
                   [class.removed]="isSupportRemoved(edge)"
                   (click)="toggleRemoveSupport(edge)">
                <mat-checkbox [checked]="isSupportRemoved(edge)"
                              (click)="$event.stopPropagation()">
                </mat-checkbox>
                <div class="edge-content">
                  <code>{{ edge.claimA | slice:0:20 }}</code>
                  <mat-icon class="edge-icon support">check</mat-icon>
                  <code>{{ edge.claimB | slice:0:20 }}</code>
                  <span class="edge-weight">({{ edge.weight?.toFixed(2) || '1.00' }})</span>
                </div>
              </div>
            </div>
            
            <div *ngIf="data.contradictions.length === 0 && data.supports.length === 0" class="empty-message">
              No edges to remove
            </div>
          </div>
        </mat-tab>
      </mat-tab-group>
      
      <!-- Summary -->
      <div class="modifications-summary" *ngIf="hasModifications()">
        <h4>Modifications Summary</h4>
        <ul>
          <li *ngIf="removedClaims.size > 0">
            <mat-icon>remove_circle</mat-icon>
            Removing {{ removedClaims.size }} claim(s)
          </li>
          <li *ngIf="addedGrounded.size > 0">
            <mat-icon>verified</mat-icon>
            Grounding {{ addedGrounded.size }} claim(s)
          </li>
          <li *ngIf="removedContradictions.length > 0">
            <mat-icon>link_off</mat-icon>
            Removing {{ removedContradictions.length }} contradiction edge(s)
          </li>
          <li *ngIf="removedSupports.length > 0">
            <mat-icon>link_off</mat-icon>
            Removing {{ removedSupports.length }} support edge(s)
          </li>
        </ul>
      </div>
    </mat-dialog-content>
    
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button 
              color="primary" 
              [disabled]="!hasModifications() || isRunning"
              (click)="runSimulation()">
        <mat-spinner *ngIf="isRunning" diameter="20"></mat-spinner>
        <mat-icon *ngIf="!isRunning">science</mat-icon>
        {{ isRunning ? 'Running...' : 'Run Simulation' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .simulation-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: #e3f2fd;
      border-radius: 8px;
      margin-bottom: 16px;
      color: #1565c0;
    }
    
    .simulation-notice mat-icon {
      flex-shrink: 0;
    }
    
    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }
    
    .tab-content {
      padding: 16px 0;
      max-height: 300px;
      overflow-y: auto;
    }
    
    .tab-description {
      margin-bottom: 12px;
      color: #666;
    }
    
    .claims-list, .edges-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .claim-item, .edge-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .claim-item:hover, .edge-item:hover {
      background: #f0f0f0;
    }
    
    .claim-item.removed {
      background: #ffebee;
      text-decoration: line-through;
      opacity: 0.7;
    }
    
    .claim-item.grounded {
      background: #e8f5e9;
    }
    
    .edge-item.removed {
      background: #ffebee;
      opacity: 0.7;
    }
    
    .claim-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }
    
    .claim-speaker {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .speaker-agent {
      color: #1565c0;
    }
    
    .speaker-customer {
      color: #7b1fa2;
    }
    
    .speaker-unknown {
      color: #666;
    }
    
    .claim-text {
      font-size: 13px;
      line-height: 1.4;
    }
    
    .edge-content {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }
    
    .edge-content code {
      background: #e0e0e0;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
    }
    
    .edge-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    
    .edge-icon.contradiction {
      color: #c62828;
    }
    
    .edge-icon.support {
      color: #2e7d32;
    }
    
    .edge-weight {
      color: #666;
      font-size: 12px;
    }
    
    .empty-message {
      color: #666;
      font-style: italic;
      padding: 16px;
      text-align: center;
    }
    
    .modifications-summary {
      margin-top: 16px;
      padding: 16px;
      background: #fff3e0;
      border-radius: 8px;
    }
    
    .modifications-summary h4 {
      margin: 0 0 12px;
      color: #ef6c00;
    }
    
    .modifications-summary ul {
      margin: 0;
      padding-left: 0;
      list-style: none;
    }
    
    .modifications-summary li {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .modifications-summary mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #ef6c00;
    }
    
    mat-dialog-actions button {
      min-width: 140px;
    }
    
    mat-dialog-actions mat-spinner {
      margin-right: 8px;
    }
  `]
})
export class SimulationDialogComponent {
  description = '';
  removedClaims = new Set<string>();
  addedGrounded = new Set<string>();
  removedContradictions: Edge[] = [];
  removedSupports: Edge[] = [];
  isRunning = false;

  constructor(
    public dialogRef: MatDialogRef<SimulationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SimulationDialogData
  ) {}

  toggleRemoveClaim(claimId: string) {
    if (this.removedClaims.has(claimId)) {
      this.removedClaims.delete(claimId);
    } else {
      this.removedClaims.add(claimId);
      // Also remove from grounded if it was there
      this.addedGrounded.delete(claimId);
    }
  }

  toggleAddGrounded(claimId: string) {
    if (this.addedGrounded.has(claimId)) {
      this.addedGrounded.delete(claimId);
    } else {
      this.addedGrounded.add(claimId);
    }
  }

  toggleRemoveContradiction(edge: Edge) {
    const index = this.removedContradictions.findIndex(
      e => e.claimA === edge.claimA && e.claimB === edge.claimB
    );
    if (index >= 0) {
      this.removedContradictions.splice(index, 1);
    } else {
      this.removedContradictions.push(edge);
    }
  }

  toggleRemoveSupport(edge: Edge) {
    const index = this.removedSupports.findIndex(
      e => e.claimA === edge.claimA && e.claimB === edge.claimB
    );
    if (index >= 0) {
      this.removedSupports.splice(index, 1);
    } else {
      this.removedSupports.push(edge);
    }
  }

  isContradictionRemoved(edge: Edge): boolean {
    return this.removedContradictions.some(
      e => e.claimA === edge.claimA && e.claimB === edge.claimB
    );
  }

  isSupportRemoved(edge: Edge): boolean {
    return this.removedSupports.some(
      e => e.claimA === edge.claimA && e.claimB === edge.claimB
    );
  }

  getUngroundedClaims(): Claim[] {
    const groundedSet = new Set(this.data.grounded || []);
    return this.data.claims.filter(c => 
      !groundedSet.has(c.id) && !this.removedClaims.has(c.id)
    );
  }

  hasModifications(): boolean {
    return (
      this.removedClaims.size > 0 ||
      this.addedGrounded.size > 0 ||
      this.removedContradictions.length > 0 ||
      this.removedSupports.length > 0
    );
  }

  runSimulation() {
    const modifications: SimulationModifications = {
      addClaims: [],
      removeClaims: Array.from(this.removedClaims),
      addSupports: [],
      removeSupports: this.removedSupports,
      addContradictions: [],
      removeContradictions: this.removedContradictions,
      addGrounded: Array.from(this.addedGrounded),
      removeGrounded: [],
      description: this.description || 'What-if analysis'
    };

    this.dialogRef.close(modifications);
  }
}

