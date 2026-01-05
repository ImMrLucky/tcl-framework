import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';

interface IssueV2 {
  issueId: string;
  issueKey: string;
  runId: string;
  conversationId: string;
  type: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityDisplay?: 'low' | 'medium' | 'high'; // What UI shows (capped in transcript-only)
  impact?: 'low' | 'medium' | 'high'; // How bad if true (not affected by mode)
  riskScore: number;
  score?: number; // Numeric for sorting (0..100)
  confidence: number;
  reviewRequired: boolean;
  verification: {
    level: string;
    reasonCodes: string[];
  };
  who: {
    speaker: string;
    turnIndex?: number;
  };
  what: {
    primaryClaimId: string;
    relatedClaimIds?: string[];
    claimText?: string;
    issueSummary: string;
    issueDetail: string;
  };
  evidence: {
    refs: Array<{
      sourceType: string;
      sourceId: string;
      quote: string;
      weight?: number;
      turnIndex?: number;
    }>;
    edges?: Array<{
      kind: string;
      claimA: string;
      claimB?: string;
      weight: number;
    }>;
  };
  compliance: {
    tags: string[];
    impactedPolicies?: Array<{ policyId: string; section?: string }>;
    legalHoldSuggested?: boolean;
    disclaimers: string[];
  };
  audit: {
    createdAt: string;
    engineVersion: string;
    scorerId: string;
    modelFingerprint?: any;
    configHash?: string;
    inputHash?: string;
  };
}

@Component({
  selector: 'app-issue-v2-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatCardModule,
    MatTabsModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon [class]="'severity-' + data.issue.severity">{{ getSeverityIcon() }}</mat-icon>
      Issue #{{ data.issue.issueId }}
    </h2>
    
    <mat-dialog-content>
      <mat-tab-group>
        <!-- Overview Tab -->
        <mat-tab label="Overview">
          <div class="issue-overview">
            <div class="issue-header">
              <div class="badges">
                <span class="badge severity-{{ data.issue.severity }}">{{ data.issue.severity.toUpperCase() }}</span>
                <span class="badge type-badge">{{ data.issue.type }}</span>
                <span class="badge category-badge">{{ data.issue.category }}</span>
                <span class="badge" [class.transcript-only]="data.issue.verification.level === 'TRANSCRIPT_ONLY'">
                  {{ data.issue.verification.level }}
                </span>
                <span class="badge" *ngIf="data.issue.reviewRequired">Review Required</span>
                <span class="badge" *ngIf="data.issue.compliance.legalHoldSuggested">Legal Hold Suggested</span>
              </div>
              
              <div class="metrics">
                <div class="metric">
                  <strong>Risk Score:</strong> {{ ((data.issue.score ?? (data.issue.riskScore * 100))).toFixed(0) }}%
                </div>
                <div class="metric">
                  <strong>Confidence:</strong> {{ (data.issue.confidence * 100).toFixed(0) }}%
                </div>
                <div class="metric">
                  <strong>Speaker:</strong> {{ data.issue.who.speaker }}
                </div>
                <div class="metric" *ngIf="data.issue.who.turnIndex !== undefined">
                  <strong>Turn:</strong> {{ data.issue.who.turnIndex + 1 }}
                </div>
              </div>
            </div>
            
            <mat-divider></mat-divider>
            
            <div class="issue-content">
              <h3>Summary</h3>
              <p>{{ data.issue.what.issueSummary }}</p>
              
              <h3>Detail</h3>
              <p>{{ data.issue.what.issueDetail }}</p>
              
              <h3>Primary Claim</h3>
              <p><strong>ID:</strong> {{ data.issue.what.primaryClaimId }}</p>
              <p *ngIf="data.issue.what.claimText"><strong>Text:</strong> {{ data.issue.what.claimText }}</p>
              
              <div *ngIf="data.issue.what.relatedClaimIds && data.issue.what.relatedClaimIds.length > 0">
                <h3>Related Claims</h3>
                <ul>
                  <li *ngFor="let claimId of data.issue.what.relatedClaimIds">{{ claimId }}</li>
                </ul>
              </div>
            </div>
          </div>
        </mat-tab>
        
        <!-- Evidence Tab -->
        <mat-tab label="Evidence">
          <div class="evidence-section">
            <h3>Evidence References ({{ data.issue.evidence.refs.length }})</h3>
            <div *ngFor="let ref of data.issue.evidence.refs" class="evidence-item">
              <div class="evidence-header">
                <span class="badge">{{ ref.sourceType }}</span>
                <span class="source-id">{{ ref.sourceId }}</span>
                <span class="weight" *ngIf="ref.weight">Weight: {{ (ref.weight * 100).toFixed(0) }}%</span>
                <span class="turn" *ngIf="ref.turnIndex !== undefined">Turn: {{ ref.turnIndex + 1 }}</span>
              </div>
              <div class="evidence-quote">
                "{{ ref.quote }}"
              </div>
            </div>
            
            <div *ngIf="data.issue.evidence.edges && data.issue.evidence.edges.length > 0">
              <h3>Graph Edges ({{ data.issue.evidence.edges.length }})</h3>
              <div *ngFor="let edge of data.issue.evidence.edges" class="edge-item">
                <strong>{{ edge.kind }}</strong>: {{ edge.claimA }}
                <span *ngIf="edge.claimB"> ↔ {{ edge.claimB }}</span>
                <span class="weight">(weight: {{ (edge.weight * 100).toFixed(0) }}%)</span>
              </div>
            </div>
          </div>
        </mat-tab>
        
        <!-- Compliance Tab -->
        <mat-tab label="Compliance">
          <div class="compliance-section">
            <h3>Compliance Tags</h3>
            <div class="tags">
              <mat-chip *ngFor="let tag of data.issue.compliance.tags">{{ tag }}</mat-chip>
            </div>
            
            <div *ngIf="data.issue.compliance.impactedPolicies && data.issue.compliance.impactedPolicies.length > 0">
              <h3>Impacted Policies</h3>
              <ul>
                <li *ngFor="let policy of data.issue.compliance.impactedPolicies">
                  {{ policy.policyId }}<span *ngIf="policy.section"> - Section {{ policy.section }}</span>
                </li>
              </ul>
            </div>
            
            <div *ngIf="data.issue.compliance.disclaimers.length > 0">
              <h3>Disclaimers</h3>
              <ul>
                <li *ngFor="let disclaimer of data.issue.compliance.disclaimers">{{ disclaimer }}</li>
              </ul>
            </div>
            
            <div *ngIf="data.issue.verification.reasonCodes.length > 0">
              <h3>Verification Reason Codes</h3>
              <ul>
                <li *ngFor="let code of data.issue.verification.reasonCodes">{{ code }}</li>
              </ul>
            </div>
          </div>
        </mat-tab>
        
        <!-- Audit Tab -->
        <mat-tab label="Audit">
          <div class="audit-section">
            <h3>Reproducibility Information</h3>
            <table class="audit-table">
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
              <tr>
                <td>Issue ID</td>
                <td>{{ data.issue.issueId }}</td>
              </tr>
              <tr>
                <td>Issue Key</td>
                <td>{{ data.issue.issueKey }}</td>
              </tr>
              <tr>
                <td>Run ID</td>
                <td>{{ data.issue.runId }}</td>
              </tr>
              <tr>
                <td>Created At</td>
                <td>{{ data.issue.audit.createdAt }}</td>
              </tr>
              <tr>
                <td>Engine Version</td>
                <td>{{ data.issue.audit.engineVersion }}</td>
              </tr>
              <tr>
                <td>Scorer ID</td>
                <td>{{ data.issue.audit.scorerId }}</td>
              </tr>
              <tr *ngIf="data.issue.audit.configHash">
                <td>Config Hash</td>
                <td>{{ data.issue.audit.configHash }}</td>
              </tr>
              <tr *ngIf="data.issue.audit.inputHash">
                <td>Input Hash</td>
                <td>{{ data.issue.audit.inputHash }}</td>
              </tr>
            </table>
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>
    
    <mat-dialog-actions>
      <button mat-button (click)="close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .issue-overview {
      padding: 20px;
    }
    .issue-header {
      margin-bottom: 20px;
    }
    .badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 15px;
    }
    .badge {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .severity-critical { background: #991b1b; color: white; }
    .severity-high { background: #ea580c; color: white; }
    .severity-medium { background: #2563eb; color: white; }
    .severity-low { background: #16a34a; color: white; }
    .type-badge { background: #6366f1; color: white; }
    .category-badge { background: #8b5cf6; color: white; }
    .transcript-only { background: #e3f2fd; color: #1976d2; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 10px;
    }
    .metric {
      padding: 8px;
      background: #f5f5f5;
      border-radius: 4px;
    }
    .issue-content h3 {
      margin-top: 20px;
      color: #333;
    }
    .evidence-section {
      padding: 20px;
    }
    .evidence-item {
      margin: 15px 0;
      padding: 15px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .evidence-header {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    }
    .evidence-quote {
      padding: 10px;
      background: white;
      border-left: 3px solid #2563eb;
      font-style: italic;
    }
    .edge-item {
      padding: 8px;
      background: #f0f0f0;
      margin: 5px 0;
      border-radius: 4px;
    }
    .compliance-section {
      padding: 20px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0;
    }
    .audit-section {
      padding: 20px;
    }
    .audit-table {
      width: 100%;
      border-collapse: collapse;
    }
    .audit-table th,
    .audit-table td {
      padding: 8px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    .audit-table th {
      background: #f5f5f5;
      font-weight: bold;
    }
  `]
})
export class IssueV2DetailModalComponent {
  constructor(
    public dialogRef: MatDialogRef<IssueV2DetailModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { issue: IssueV2; evaluation?: any }
  ) {}

  getSeverityIcon(): string {
    const severity = this.data.issue.severity;
    if (severity === 'critical') return 'error';
    if (severity === 'high') return 'warning';
    if (severity === 'medium') return 'info';
    return 'check_circle';
  }

  close(): void {
    this.dialogRef.close();
  }
}

