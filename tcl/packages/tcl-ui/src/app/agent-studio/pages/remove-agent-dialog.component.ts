import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';
import { AgentRemovalImpact, AgentTaskDisposition } from '../agent-studio.types';

export interface RemoveAgentDialogData {
  impact: AgentRemovalImpact;
}

export interface RemoveAgentDialogResult {
  confirmed: boolean;
  taskDisposition?: AgentTaskDisposition;
}

@Component({
  selector: 'app-remove-agent-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Remove agent?</h2>
    <mat-dialog-content>
      <p>
        Remove <strong>{{ data.impact.agentName }}</strong> from this team? This deletes the agent and its markdown
        files. This cannot be undone.
      </p>
      <p *ngIf="data.impact.isOrchestrator" class="warn">
        The team orchestrator (Jarvis) cannot be removed. Pause the agent instead.
      </p>
      <ng-container *ngIf="!data.impact.isOrchestrator">
        <p *ngIf="data.impact.assignedOpenTaskCount === 0" class="muted">
          No open board tasks are assigned to this agent.
        </p>
        <p *ngIf="data.impact.assignedOpenTaskCount > 0">
          <strong>{{ data.impact.assignedOpenTaskCount }}</strong>
          open task(s) are assigned to this agent. What should happen to them?
        </p>
        <mat-radio-group
          *ngIf="data.impact.assignedOpenTaskCount > 0"
          [(ngModel)]="taskDisposition"
          class="options"
        >
          <mat-radio-button value="jarvis" *ngIf="data.impact.jarvisAgentId">
            Assign to {{ data.impact.jarvisAgentName || 'Jarvis' }} to re-delegate
          </mat-radio-button>
          <mat-radio-button value="unassign">Leave unassigned (Jarvis can pick up from the board)</mat-radio-button>
        </mat-radio-group>
      </ng-container>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        color="warn"
        [disabled]="data.impact.isOrchestrator"
        (click)="confirm()"
      >
        Remove agent
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-dialog-content {
        min-width: min(420px, 92vw);
        line-height: 1.5;
      }
      .muted {
        color: #64748b;
      }
      .warn {
        color: #b45309;
      }
      .options {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 12px;
      }
    `,
  ],
})
export class RemoveAgentDialogComponent {
  taskDisposition: AgentTaskDisposition;

  constructor(
    private dialogRef: MatDialogRef<RemoveAgentDialogComponent, RemoveAgentDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: RemoveAgentDialogData
  ) {
    this.taskDisposition = data.impact.defaultDisposition;
  }

  confirm(): void {
    this.dialogRef.close({
      confirmed: true,
      taskDisposition: this.data.impact.assignedOpenTaskCount > 0 ? this.taskDisposition : undefined,
    });
  }
}
