import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { IssuesService, IssueActivityItem } from '../issues.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { EntitlementsService } from '../entitlements.service';
import { MemberService } from '../member.service';
import { IntegrationsService } from '../integrations/integrations.service';

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
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
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
                <span class="badge severity-{{ data.issue.severity || 'unknown' }}">{{ (data.issue.severity || 'unknown').toUpperCase() }}</span>
                <span class="badge type-badge">{{ data.issue.type || 'UNKNOWN' }}</span>
                <span class="badge category-badge">{{ data.issue.category || 'other' }}</span>
                <span class="badge" [class.transcript-only]="data.issue.verification?.level === 'TRANSCRIPT_ONLY'">
                  {{ data.issue.verification?.level || 'NO_VERIFICATION' }}
                </span>
                <span class="badge" *ngIf="data.issue.reviewRequired">Review Required</span>
                <span class="badge" *ngIf="data.issue.compliance?.legalHoldSuggested">Legal Hold Suggested</span>
                <span class="badge locked-badge" *ngIf="lock">LOCKED</span>
              </div>
              
              <!-- Lock/Unlock Actions -->
              <div *ngIf="hasLegalHold" class="lock-actions" style="margin-top: 16px;">
                <div *ngIf="!lock">
                  <mat-form-field appearance="outline" style="width: 100%; max-width: 400px;">
                    <mat-label>Lock Reason</mat-label>
                    <input matInput [(ngModel)]="lockForm.reason" placeholder="Enter reason for locking this issue...">
                  </mat-form-field>
                  <button 
                    mat-raised-button 
                    color="warn" 
                    (click)="lockIssue()" 
                    [disabled]="locking || !lockForm.reason || !lockForm.reason.trim()">
                    <mat-spinner *ngIf="locking" diameter="20" class="inline-spinner"></mat-spinner>
                    <mat-icon *ngIf="!locking">lock</mat-icon>
                    {{ locking ? 'Locking...' : 'Lock for Legal Hold' }}
                  </button>
                </div>
                <div *ngIf="lock" class="lock-info">
                  <div class="lock-details">
                    <mat-icon>lock</mat-icon>
                    <div>
                      <strong>Locked</strong>
                      <p>Locked at: {{ formatDecisionTime(lock.locked_at) }}</p>
                      <p *ngIf="lock.reason">Reason: {{ lock.reason }}</p>
                      <p *ngIf="lock.snapshot_id">Snapshot ID: {{ lock.snapshot_id }}</p>
                    </div>
                  </div>
                  <button 
                    mat-stroked-button 
                    color="primary" 
                    (click)="unlockIssue()" 
                    [disabled]="unlocking">
                    <mat-spinner *ngIf="unlocking" diameter="20" class="inline-spinner"></mat-spinner>
                    <mat-icon *ngIf="!unlocking">lock_open</mat-icon>
                    {{ unlocking ? 'Unlocking...' : 'Unlock' }}
                  </button>
                </div>
              </div>
              
              <div class="metrics">
                <div class="metric">
                  <strong>Risk Score:</strong> {{ ((data.issue.score ?? (data.issue.riskScore * 100))).toFixed(0) }}%
                </div>
                <div class="metric">
                  <strong>Confidence:</strong> {{ (data.issue.confidence * 100).toFixed(0) }}%
                </div>
                <div class="metric">
                  <strong>Speaker:</strong> {{ data.issue.who?.speaker || 'UNKNOWN' }}
                </div>
                <div class="metric" *ngIf="data.issue.who?.turnIndex !== undefined">
                  <strong>Turn:</strong> {{ (data.issue.who?.turnIndex || 0) + 1 }}
                </div>
              </div>
            </div>
            
            <mat-divider></mat-divider>
            
            <div class="issue-content">
              <h3>Summary</h3>
              <p>{{ data.issue.what?.issueSummary || 'No summary available' }}</p>
              
              <h3>Detail</h3>
              <p>{{ data.issue.what?.issueDetail || 'No detail available' }}</p>
              
              <h3>Primary Claim</h3>
              <p><strong>ID:</strong> {{ data.issue.what?.primaryClaimId || 'N/A' }}</p>
              <p *ngIf="data.issue.what?.claimText"><strong>Text:</strong> {{ data.issue.what.claimText }}</p>
              
              <div *ngIf="data.issue.what?.relatedClaimIds && (data.issue.what?.relatedClaimIds?.length ?? 0) > 0">
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
              <mat-chip *ngFor="let tag of (data.issue.compliance?.tags || [])">{{ tag }}</mat-chip>
            </div>
            
            <div *ngIf="data.issue.compliance?.impactedPolicies && (data.issue.compliance?.impactedPolicies?.length ?? 0) > 0">
              <h3>Impacted Policies</h3>
              <ul>
                <li *ngFor="let policy of data.issue.compliance.impactedPolicies">
                  {{ policy.policyId }}<span *ngIf="policy.section"> - Section {{ policy.section }}</span>
                </li>
              </ul>
            </div>
            
            <div *ngIf="data.issue.compliance?.disclaimers && data.issue.compliance.disclaimers.length > 0">
              <h3>Disclaimers</h3>
              <ul>
                <li *ngFor="let disclaimer of data.issue.compliance.disclaimers">{{ disclaimer }}</li>
              </ul>
            </div>
            
            <div *ngIf="data.issue.verification?.reasonCodes && data.issue.verification.reasonCodes.length > 0">
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
        
        <!-- Decision Tab (Enterprise only) -->
        <mat-tab label="Decision" *ngIf="hasIssueDecisions">
          <div class="decision-section">
            <div *ngIf="loadingDecision" class="loading-decision">
              <mat-spinner diameter="30"></mat-spinner>
              <p>Loading decision...</p>
            </div>
            
            <div *ngIf="!loadingDecision" class="decision-form">
              <h3>Issue Disposition</h3>
              
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Disposition</mat-label>
                <mat-select [(ngModel)]="decisionForm.disposition">
                  <mat-option value="OPEN">Open</mat-option>
                  <mat-option value="ACKNOWLEDGED">Acknowledged</mat-option>
                  <mat-option value="REMEDIATED">Remediated</mat-option>
                  <mat-option value="ACCEPTED_RISK">Accepted Risk</mat-option>
                  <mat-option value="FALSE_POSITIVE">False Positive</mat-option>
                  <mat-option value="REQUIRES_FOLLOWUP">Requires Follow-up</mat-option>
                  <mat-option value="ESCALATED">Escalated</mat-option>
                </mat-select>
              </mat-form-field>
              
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Severity Override (Optional)</mat-label>
                <mat-select [(ngModel)]="decisionForm.severityOverride">
                  <mat-option [value]="null">None (use original)</mat-option>
                  <mat-option value="critical">Critical</mat-option>
                  <mat-option value="high">High</mat-option>
                  <mat-option value="medium">Medium</mat-option>
                  <mat-option value="low">Low</mat-option>
                </mat-select>
              </mat-form-field>
              
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Assign To (Optional)</mat-label>
                <mat-select [(ngModel)]="decisionForm.assignedToUserId">
                  <mat-option [value]="null">Unassigned</mat-option>
                  <mat-option *ngFor="let member of orgMembers" [value]="member.id">
                    {{ member.fullName || member.email }} ({{ member.role }})
                  </mat-option>
                </mat-select>
              </mat-form-field>
              
              <mat-form-field appearance="outline" class="full-width" *ngIf="decisionForm.disposition === 'ACCEPTED_RISK'">
                <mat-label>Expires At (Required for Accepted Risk)</mat-label>
                <input matInput [matDatepicker]="picker" [(ngModel)]="decisionForm.expiresAt" [required]="decisionForm.disposition === 'ACCEPTED_RISK'">
                <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
                <mat-datepicker #picker></mat-datepicker>
              </mat-form-field>
              
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Notes</mat-label>
                <textarea matInput [(ngModel)]="decisionForm.notes" rows="4" placeholder="Add notes about this decision..."></textarea>
              </mat-form-field>
              
              <button 
                mat-raised-button 
                color="primary" 
                (click)="saveDecision()" 
                [disabled]="savingDecision || !decisionForm.disposition">
                <mat-spinner *ngIf="savingDecision" diameter="20" class="inline-spinner"></mat-spinner>
                <mat-icon *ngIf="!savingDecision">save</mat-icon>
                {{ savingDecision ? 'Saving...' : (decision ? 'Update Decision' : 'Create Decision') }}
              </button>
              
              <div *ngIf="decision" class="decision-info">
                <mat-divider></mat-divider>
                <h3>Current Decision</h3>
                <div class="decision-badge">
                  <mat-chip [color]="getDispositionColor(decision.disposition)">{{ decision.disposition }}</mat-chip>
                  <span *ngIf="decision.severity_override">Severity: {{ decision.severity_override }}</span>
                  <span *ngIf="decision.assigned_to_user_id">Assigned to: {{ getMemberName(decision.assigned_to_user_id) }}</span>
                  <span *ngIf="decision.expires_at">Expires: {{ formatDecisionTime(decision.expires_at) }}</span>
                </div>
                <p *ngIf="decision.notes"><strong>Notes:</strong> {{ decision.notes }}</p>
                <p class="decision-meta">Created: {{ formatDecisionTime(decision.created_at) }} | Updated: {{ formatDecisionTime(decision.updated_at) }}</p>
              </div>
            </div>
            
            <mat-divider></mat-divider>
            
            <div class="decision-history">
              <h3>Decision History</h3>
              <div *ngIf="decisionHistory.length === 0" class="no-history">
                <p>No decision history yet.</p>
              </div>
              <div *ngFor="let event of decisionHistory" class="history-item">
                <div class="history-header">
                  <mat-icon>{{ getEventIcon(event.event_type) }}</mat-icon>
                  <span class="event-type">{{ event.event_type }}</span>
                  <span class="event-time">{{ formatDecisionTime(event.created_at) }}</span>
                </div>
                <div class="history-body" *ngIf="event.payload_json">
                  <div *ngIf="event.payload_json.disposition">
                    <strong>Disposition:</strong> {{ event.payload_json.disposition }}
                  </div>
                  <div *ngIf="event.payload_json.notes">
                    <strong>Notes:</strong> {{ event.payload_json.notes }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </mat-tab>
        
        <!-- Signoffs Tab (Enterprise only, requires decision) -->
        <mat-tab label="Signoffs" *ngIf="hasReviewerSignoff && decision">
          <div class="signoffs-section">
            <div *ngIf="loadingSignoffs" class="loading-signoffs">
              <mat-spinner diameter="30"></mat-spinner>
              <p>Loading signoffs...</p>
            </div>
            
            <div *ngIf="!loadingSignoffs" class="signoffs-content">
              <h3>Review Signoffs</h3>
              <p class="signoffs-description">Sign off on this issue decision to indicate review completion.</p>
              
              <!-- Signoff Status -->
              <div class="signoff-status">
                <div class="signoff-role" *ngFor="let role of ['QA', 'COMPLIANCE', 'LEGAL', 'MANAGER']">
                  <mat-icon [class.completed]="hasSignoffForRole(role)" [class.pending]="!hasSignoffForRole(role)">
                    {{ hasSignoffForRole(role) ? 'check_circle' : 'radio_button_unchecked' }}
                  </mat-icon>
                  <span class="role-name">{{ role }}</span>
                  <span *ngIf="hasSignoffForRole(role)" class="signoff-info">
                    Signed by: {{ getMemberName(getSignoffForRole(role).signed_by_user_id) }}
                    on {{ formatDecisionTime(getSignoffForRole(role).signed_at) }}
                  </span>
                  <span *ngIf="!hasSignoffForRole(role)" class="signoff-info pending">Pending</span>
                </div>
              </div>
              
              <mat-divider></mat-divider>
              
              <!-- Create Signoff Form -->
              <div class="signoff-form">
                <h3>Add Signoff</h3>
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Role</mat-label>
                  <mat-select [(ngModel)]="signoffForm.role">
                    <mat-option value="QA" [disabled]="hasSignoffForRole('QA')">QA</mat-option>
                    <mat-option value="COMPLIANCE" [disabled]="hasSignoffForRole('COMPLIANCE')">Compliance</mat-option>
                    <mat-option value="LEGAL" [disabled]="hasSignoffForRole('LEGAL')">Legal</mat-option>
                    <mat-option value="MANAGER" [disabled]="hasSignoffForRole('MANAGER')">Manager</mat-option>
                  </mat-select>
                </mat-form-field>
                
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Note (Optional)</mat-label>
                  <textarea matInput [(ngModel)]="signoffForm.note" rows="3" placeholder="Add a note about this signoff..."></textarea>
                </mat-form-field>
                
                <button 
                  mat-raised-button 
                  color="primary" 
                  (click)="createSignoff()" 
                  [disabled]="signingOff || !signoffForm.role || hasSignoffForRole(signoffForm.role)">
                  <mat-spinner *ngIf="signingOff" diameter="20" class="inline-spinner"></mat-spinner>
                  <mat-icon *ngIf="!signingOff">check_circle</mat-icon>
                  {{ signingOff ? 'Signing off...' : 'Sign Off' }}
                </button>
              </div>
              
              <!-- Signoffs History -->
              <div class="signoffs-history" *ngIf="signoffs.length > 0">
                <mat-divider></mat-divider>
                <h3>Signoff History</h3>
                <div *ngFor="let signoff of signoffs" class="signoff-item">
                  <div class="signoff-header">
                    <mat-icon>check_circle</mat-icon>
                    <span class="signoff-role-badge">{{ signoff.role }}</span>
                    <span class="signoff-actor">{{ getMemberName(signoff.signed_by_user_id) }}</span>
                    <span class="signoff-time">{{ formatDecisionTime(signoff.signed_at) }}</span>
                  </div>
                  <div class="signoff-note" *ngIf="signoff.note">
                    <strong>Note:</strong> {{ signoff.note }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </mat-tab>
        
        <!-- Comments & Activity Tab -->
        <mat-tab label="Comments & Activity">
          <div class="activity-section">
            <!-- Add Comment Form -->
            <div class="comment-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Add a comment</mat-label>
                <textarea matInput [(ngModel)]="newComment" rows="3" placeholder="Enter your comment..."></textarea>
              </mat-form-field>
              <button mat-raised-button color="primary" (click)="addComment()" [disabled]="!newComment || newComment.trim().length === 0 || addingComment">
                <mat-icon>send</mat-icon>
                Add Comment
              </button>
            </div>
            
            <mat-divider></mat-divider>
            
            <!-- Activity Feed -->
            <div class="activity-feed" *ngIf="!loadingActivity">
              <div *ngFor="let item of activity" class="activity-item" [class.comment]="item.type === 'comment'" [class.action]="item.type === 'action'">
                <div class="activity-header">
                  <mat-icon *ngIf="item.type === 'comment'">comment</mat-icon>
                  <mat-icon *ngIf="item.type === 'action'">history</mat-icon>
                  <span class="actor-name">{{ item.actor.full_name || item.actor.email || 'Unknown User' }}</span>
                  <span class="activity-time">{{ formatActivityTime(item.createdAt) }}</span>
                </div>
                <div class="activity-body" *ngIf="item.type === 'comment'">
                  {{ item.body }}
                </div>
                <div class="activity-body" *ngIf="item.type === 'action'">
                  <strong>{{ formatActionType(item.actionType) }}</strong>
                  <span *ngIf="item.payload">{{ formatActionPayload(item.actionType, item.payload) }}</span>
                </div>
              </div>
              <div *ngIf="activity.length === 0" class="no-activity">
                <p>No comments or activity yet.</p>
              </div>
            </div>
            
            <div *ngIf="loadingActivity" class="loading-activity">
              <mat-spinner diameter="30"></mat-spinner>
              <p>Loading activity...</p>
            </div>
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>
    
    <mat-dialog-actions>
      <button 
        *ngIf="hasIntegrations" 
        mat-raised-button 
        color="primary" 
        (click)="exportToJira()" 
        [disabled]="exportingToJira">
        <mat-spinner *ngIf="exportingToJira" diameter="20" class="inline-spinner"></mat-spinner>
        <mat-icon *ngIf="!exportingToJira">bug_report</mat-icon>
        {{ exportingToJira ? 'Exporting...' : 'Export to Jira' }}
      </button>
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
    .activity-section {
      padding: 20px;
    }
    .comment-form {
      margin-bottom: 20px;
    }
    .full-width {
      width: 100%;
      margin-bottom: 12px;
    }
    .activity-feed {
      margin-top: 20px;
    }
    .activity-item {
      padding: 16px;
      margin-bottom: 12px;
      border-radius: 8px;
      border-left: 3px solid #ddd;
    }
    .activity-item.comment {
      background: #f9f9f9;
      border-left-color: #1976d2;
    }
    .activity-item.action {
      background: #fafafa;
      border-left-color: #666;
    }
    .activity-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .activity-header mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .actor-name {
      font-weight: 500;
      flex: 1;
    }
    .activity-time {
      font-size: 12px;
      color: #666;
    }
    .activity-body {
      margin-left: 26px;
      color: #333;
    }
    .no-activity {
      text-align: center;
      padding: 40px;
      color: #999;
    }
    .loading-activity {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px;
      gap: 12px;
    }
    .decision-section {
      padding: 20px;
    }
    .loading-decision {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px;
      gap: 12px;
    }
    .decision-form {
      margin-bottom: 20px;
    }
    .decision-info {
      margin-top: 20px;
      padding: 15px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .decision-badge {
      display: flex;
      gap: 10px;
      align-items: center;
      margin: 10px 0;
      flex-wrap: wrap;
    }
    .decision-meta {
      font-size: 0.85em;
      color: #666;
      margin-top: 10px;
    }
    .decision-history {
      margin-top: 20px;
    }
    .history-item {
      padding: 12px;
      margin-bottom: 10px;
      background: #fafafa;
      border-left: 3px solid #1976d2;
      border-radius: 4px;
    }
    .history-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .history-header mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .event-type {
      font-weight: 500;
      flex: 1;
    }
    .event-time {
      font-size: 12px;
      color: #666;
    }
    .history-body {
      margin-left: 26px;
      color: #333;
    }
    .no-history {
      text-align: center;
      padding: 20px;
      color: #999;
    }
    .inline-spinner {
      display: inline-block;
      margin-right: 8px;
    }
    .signoffs-section {
      padding: 20px;
    }
    .loading-signoffs {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px;
      gap: 12px;
    }
    .signoffs-content {
      margin-top: 20px;
    }
    .signoffs-description {
      color: #666;
      margin-bottom: 20px;
    }
    .signoff-status {
      margin: 20px 0;
    }
    .signoff-role {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px;
      margin-bottom: 8px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .signoff-role mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }
    .signoff-role mat-icon.completed {
      color: #16a34a;
    }
    .signoff-role mat-icon.pending {
      color: #999;
    }
    .role-name {
      font-weight: 500;
      min-width: 120px;
    }
    .signoff-info {
      font-size: 0.9em;
      color: #666;
    }
    .signoff-info.pending {
      color: #999;
      font-style: italic;
    }
    .signoff-form {
      margin-top: 20px;
      padding: 20px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .signoffs-history {
      margin-top: 20px;
    }
    .signoff-item {
      padding: 12px;
      margin-bottom: 10px;
      background: #fafafa;
      border-left: 3px solid #16a34a;
      border-radius: 4px;
    }
    .signoff-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .signoff-header mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #16a34a;
    }
    .signoff-role-badge {
      font-weight: 500;
      padding: 2px 8px;
      background: #e0f2fe;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .signoff-actor {
      flex: 1;
      font-weight: 500;
    }
    .signoff-time {
      font-size: 0.85em;
      color: #666;
    }
    .signoff-note {
      margin-left: 30px;
      color: #333;
      font-size: 0.9em;
    }
    .locked-badge {
      background: #991b1b;
      color: white;
    }
    .lock-actions {
      padding: 16px;
      background: #fff3cd;
      border-radius: 4px;
      border-left: 3px solid #ffc107;
    }
    .lock-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .lock-details {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex: 1;
    }
    .lock-details mat-icon {
      color: #991b1b;
      margin-top: 4px;
    }
    .lock-details p {
      margin: 4px 0;
      font-size: 0.9em;
      color: #666;
    }
  `]
})
export class IssueV2DetailModalComponent implements OnInit {
  activity: IssueActivityItem[] = [];
  loadingActivity = false;
  newComment = '';
  addingComment = false;
  
  // Decision fields
  hasIssueDecisions = false;
  decision: any = null;
  decisionHistory: any[] = [];
  loadingDecision = false;
  savingDecision = false;
  
  // Signoff fields
  hasReviewerSignoff = false;
  signoffs: any[] = [];
  loadingSignoffs = false;
  signingOff = false;
  signoffForm = {
    role: 'QA' as 'QA' | 'COMPLIANCE' | 'LEGAL' | 'MANAGER',
    note: '',
  };
  
  // Lock fields
  hasLegalHold = false;
  lock: any = null;
  loadingLock = false;
  locking = false;
  unlocking = false;
  lockForm = {
    reason: '',
  };
  
  // Jira export fields
  hasIntegrations = false;
  exportingToJira = false;
  decisionForm = {
    disposition: 'OPEN',
    severityOverride: null as string | null,
    assignedToUserId: null as string | null,
    notes: '',
    expiresAt: null as Date | null,
  };
  orgMembers: Array<{ id: string; email: string; fullName?: string; role: string }> = [];
  loadingMembers = false;

  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(
    public dialogRef: MatDialogRef<IssueV2DetailModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { issue: IssueV2; evaluation?: any },
    private issuesService: IssuesService,
    private snackBar: MatSnackBar,
    private http: HttpClient,
    private entitlementsService: EntitlementsService,
    private memberService: MemberService,
    private integrationsService: IntegrationsService
  ) {}

  async ngOnInit() {
    this.loadActivity();
    
    // Check if issueDecisions entitlement is enabled
    this.hasIssueDecisions = this.entitlementsService.hasFeature('issueDecisions');
    
    // Check if reviewerSignoff entitlement is enabled
    this.hasReviewerSignoff = this.entitlementsService.hasFeature('reviewerSignoff');
    
    // Check if legalHold entitlement is enabled
    this.hasLegalHold = this.entitlementsService.hasFeature('legalHold');
    
    // Check if integrations entitlement is enabled
    this.hasIntegrations = this.entitlementsService.hasFeature('integrations');
    
    if (this.hasIssueDecisions) {
      await this.loadDecision();
      await this.loadOrgMembers();
    }
    
    if (this.hasReviewerSignoff) {
      await this.loadSignoffs();
    }
    
    if (this.hasLegalHold) {
      await this.loadLock();
    }
  }
  
  async exportToJira() {
    if (!this.hasIntegrations) {
      this.snackBar.open('Jira integration is not available for your plan', 'Close', { duration: 5000 });
      return;
    }
    
    this.exportingToJira = true;
    try {
      const response = await firstValueFrom(
        this.integrationsService.createJiraTicketFromIssue(
          this.data.issue.issueId,
          this.data.evaluation?.id
        )
      );
      
      if (response.success) {
        this.snackBar.open(`Jira ticket created: ${response.ticket.key}`, 'Close', { duration: 5000 });
      }
    } catch (error: any) {
      console.error('Failed to export to Jira:', error);
      this.snackBar.open('Failed to export to Jira: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.exportingToJira = false;
    }
  }
  
  async loadLock() {
    this.loadingLock = true;
    try {
      const response = await firstValueFrom(
        this.http.get<{ lock: any }>(`${this.apiUrl}/api/issues/${this.data.issue.issueId}/lock`)
      );
      this.lock = response.lock;
    } catch (error: any) {
      if (error.status !== 404) {
        console.error('Failed to load lock:', error);
      }
      // 404 is fine - no lock exists
    } finally {
      this.loadingLock = false;
    }
  }
  
  async lockIssue() {
    if (!this.lockForm.reason || !this.lockForm.reason.trim()) {
      this.snackBar.open('Reason is required for locking', 'Close', { duration: 3000 });
      return;
    }
    
    this.locking = true;
    try {
      // Get current issue data for snapshot
      const issueSnapshot = {
        ...this.data.issue,
        // Include full issue state
      };
      
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; lock: any; snapshot: any }>(
          `${this.apiUrl}/api/issues/${this.data.issue.issueId}/lock`,
          {
            reason: this.lockForm.reason,
            issueSnapshot,
            evaluationId: this.data.evaluation?.id,
            projectId: this.data.evaluation?.project_id,
            evidenceSetHash: this.data.issue.audit?.configHash, // Use configHash as evidence set hash
            inputHash: this.data.issue.audit?.inputHash,
            engineVersion: this.data.issue.audit?.engineVersion,
          }
        )
      );
      
      if (response.success) {
        this.lock = response.lock;
        this.lockForm.reason = '';
        this.snackBar.open('Issue locked successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Failed to lock issue:', error);
      this.snackBar.open('Failed to lock issue: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.locking = false;
    }
  }
  
  async unlockIssue() {
    if (!confirm('Are you sure you want to unlock this issue?')) {
      return;
    }
    
    this.unlocking = true;
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; lock: any }>(
          `${this.apiUrl}/api/issues/${this.data.issue.issueId}/unlock`,
          {}
        )
      );
      
      if (response.success) {
        this.lock = null;
        this.snackBar.open('Issue unlocked successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Failed to unlock issue:', error);
      this.snackBar.open('Failed to unlock issue: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.unlocking = false;
    }
  }
  
  async loadSignoffs() {
    this.loadingSignoffs = true;
    try {
      const response = await firstValueFrom(
        this.http.get<{ signoffs: any[] }>(`${this.apiUrl}/api/issues/${this.data.issue.issueId}/signoffs`)
      );
      this.signoffs = response.signoffs || [];
    } catch (error: any) {
      if (error.status !== 404) {
        console.error('Failed to load signoffs:', error);
      }
    } finally {
      this.loadingSignoffs = false;
    }
  }
  
  async createSignoff() {
    if (!this.signoffForm.role) {
      this.snackBar.open('Role is required', 'Close', { duration: 3000 });
      return;
    }
    
    this.signingOff = true;
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; signoff: any }>(
          `${this.apiUrl}/api/issues/${this.data.issue.issueId}/signoff`,
          {
            role: this.signoffForm.role,
            note: this.signoffForm.note || null,
          }
        )
      );
      
      if (response.success) {
        this.signoffForm.note = '';
        this.snackBar.open('Signoff created successfully', 'Close', { duration: 3000 });
        await this.loadSignoffs();
        // Reload decision history to show signoff event
        if (this.hasIssueDecisions) {
          await this.loadDecisionHistory();
        }
      }
    } catch (error: any) {
      console.error('Failed to create signoff:', error);
      this.snackBar.open('Failed to create signoff: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.signingOff = false;
    }
  }
  
  hasSignoffForRole(role: string): boolean {
    return this.signoffs.some(s => s.role === role);
  }
  
  getSignoffForRole(role: string): any {
    return this.signoffs.find(s => s.role === role);
  }
  
  async loadDecision() {
    this.loadingDecision = true;
    try {
      const response = await firstValueFrom(
        this.http.get<{ decision: any }>(`${this.apiUrl}/api/issues/${this.data.issue.issueId}/decision`)
      );
      
      if (response.decision) {
        this.decision = response.decision;
        this.decisionForm.disposition = response.decision.disposition;
        this.decisionForm.severityOverride = response.decision.severity_override;
        this.decisionForm.assignedToUserId = response.decision.assigned_to_user_id;
        this.decisionForm.notes = response.decision.notes || '';
        this.decisionForm.expiresAt = response.decision.expires_at ? new Date(response.decision.expires_at) : null;
      }
      
      // Load decision history
      await this.loadDecisionHistory();
    } catch (error: any) {
      if (error.status !== 404) {
        console.error('Failed to load decision:', error);
      }
      // 404 is fine - no decision exists yet
    } finally {
      this.loadingDecision = false;
    }
  }
  
  async loadDecisionHistory() {
    try {
      const response = await firstValueFrom(
        this.http.get<{ events: any[] }>(`${this.apiUrl}/api/issues/${this.data.issue.issueId}/decision/history`)
      );
      this.decisionHistory = response.events || [];
    } catch (error: any) {
      console.error('Failed to load decision history:', error);
    }
  }
  
  async loadOrgMembers() {
    this.loadingMembers = true;
    try {
      // Get current user to determine org
      const currentUser = (this.memberService as any).authService?.getCurrentUser?.();
      if (!currentUser?.id) {
        return;
      }
      
      // Get user's orgs and load members from first org
      const orgsResponse = await firstValueFrom(
        this.memberService.getUserOrgs(currentUser.id)
      );
      
      if (orgsResponse.orgs && orgsResponse.orgs.length > 0) {
        const orgId = orgsResponse.orgs[0].id;
        const membersResponse = await firstValueFrom(
          this.http.get<{ members: any[] }>(`${this.apiUrl}/api/orgs/${orgId}/members`)
        );
        this.orgMembers = (membersResponse as any).members || [];
      }
    } catch (error: any) {
      console.error('Failed to load org members:', error);
    } finally {
      this.loadingMembers = false;
    }
  }
  
  async saveDecision() {
    if (!this.decisionForm.disposition) {
      this.snackBar.open('Disposition is required', 'Close', { duration: 3000 });
      return;
    }
    
    if (this.decisionForm.disposition === 'ACCEPTED_RISK' && !this.decisionForm.expiresAt) {
      this.snackBar.open('Expiry date is required for ACCEPTED_RISK disposition', 'Close', { duration: 3000 });
      return;
    }
    
    this.savingDecision = true;
    try {
      const payload: any = {
        disposition: this.decisionForm.disposition,
        notes: this.decisionForm.notes || null,
      };
      
      if (this.decisionForm.severityOverride) {
        payload.severityOverride = this.decisionForm.severityOverride;
      }
      if (this.decisionForm.assignedToUserId) {
        payload.assignedToUserId = this.decisionForm.assignedToUserId;
      }
      if (this.decisionForm.expiresAt) {
        payload.expiresAt = this.decisionForm.expiresAt.toISOString();
      }
      if (this.data.evaluation?.id) {
        payload.evaluationId = this.data.evaluation.id;
      }
      
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; decision: any }>(
          `${this.apiUrl}/api/issues/${this.data.issue.issueId}/decision`,
          payload
        )
      );
      
      if (response.success) {
        this.decision = response.decision;
        this.snackBar.open('Decision saved successfully', 'Close', { duration: 3000 });
        await this.loadDecisionHistory();
      }
    } catch (error: any) {
      console.error('Failed to save decision:', error);
      this.snackBar.open('Failed to save decision: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.savingDecision = false;
    }
  }
  
  formatDecisionTime(date: string): string {
    const d = new Date(date);
    return d.toLocaleString();
  }
  
  getDispositionColor(disposition: string): string {
    switch (disposition) {
      case 'OPEN': return 'primary';
      case 'ACKNOWLEDGED': return 'accent';
      case 'REMEDIATED': return '';
      case 'ACCEPTED_RISK': return 'warn';
      case 'FALSE_POSITIVE': return '';
      case 'REQUIRES_FOLLOWUP': return 'accent';
      case 'ESCALATED': return 'warn';
      default: return '';
    }
  }

  async loadActivity() {
    this.loadingActivity = true;
    try {
      const response = await this.issuesService.getActivity(this.data.issue.issueId).toPromise();
      if (response) {
        this.activity = response.activity || [];
      }
    } catch (error: any) {
      console.error('Failed to load activity:', error);
      const snackBarRef = this.snackBar.open('Failed to load activity: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loadingActivity = false;
    }
  }

  async addComment() {
    if (!this.newComment || this.newComment.trim().length === 0) {
      return;
    }

    this.addingComment = true;
    try {
      await this.issuesService.addComment(this.data.issue.issueId, this.newComment).toPromise();
      this.newComment = '';
      const snackBarRef = this.snackBar.open('Comment added successfully', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.loadActivity();
    } catch (error: any) {
      console.error('Failed to add comment:', error);
      const snackBarRef = this.snackBar.open('Failed to add comment: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.addingComment = false;
    }
  }

  formatActivityTime(date: string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  }

  formatActionType(actionType: string | undefined): string {
    if (!actionType) return 'Action';
    return actionType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  formatActionPayload(actionType: string | undefined, payload: any): string {
    if (!payload) return '';
    if (actionType === 'STATUS_CHANGE' || actionType === 'BULK_STATUS_CHANGE') {
      return `: ${payload.oldStatus || 'N/A'} → ${payload.newStatus || payload.status || 'N/A'}`;
    }
    if (actionType === 'ASSIGNMENT' || actionType === 'BULK_ASSIGNMENT') {
      if (payload.newAssignee || payload.assigneeUserId) {
        return `: Assigned to user`;
      } else {
        return `: Unassigned`;
      }
    }
    return '';
  }

  getSeverityIcon(): string {
    const severity = this.data.issue.severity;
    if (severity === 'critical') return 'error';
    if (severity === 'high') return 'warning';
    if (severity === 'medium') return 'info';
    return 'check_circle';
  }
  
  getEventIcon(eventType: string): string {
    switch (eventType) {
      case 'CREATED': return 'add_circle';
      case 'UPDATED': return 'edit';
      case 'COMMENTED': return 'comment';
      case 'SIGNED_OFF': return 'check_circle';
      case 'LOCKED': return 'lock';
      case 'UNLOCKED': return 'lock_open';
      default: return 'history';
    }
  }
  
  getMemberName(userId: string): string {
    const member = this.orgMembers.find(m => m.id === userId);
    return member ? (member.fullName || member.email) : userId;
  }

  close(): void {
    this.dialogRef.close();
  }
}

