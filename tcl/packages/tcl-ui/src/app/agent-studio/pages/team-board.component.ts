import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { rememberBoardTeam } from '../board-nav';
import { AgentStudioService } from '../agent-studio.service';
import {
  buildSwimlanes,
  dropListId,
  isReviewColumn,
  isTerminalColumn,
  parseBoardSettings,
  parseDropListId,
  pendingGateCount,
  resolveEffectiveReviewMode,
  swimlaneKeyForTask,
  taskApprovalBadge,
  type Swimlane,
  type TaskApprovalBadge,
} from '../board/board-helpers';
import {
  Agent,
  BoardSettings,
  DEFAULT_BOARD_SETTINGS,
  KanbanBoard,
  ReviewGate,
  ReviewGateStatus,
  ReviewGateType,
  ReviewMode,
  SwimlaneMode,
  Task,
  TaskPriority,
  TaskType,
} from '../agent-studio.types';

@Component({
  selector: 'app-team-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    DragDropModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatDividerModule,
    MatSlideToggleModule,
  ],
  template: `
    <section class="page" *ngIf="board; else loadingTpl">
      <div class="pause-banner" *ngIf="pauseBlocked">
        <mat-icon>pause_circle</mat-icon>
        <span *ngIf="orgPaused">Organization pause is active — board moves and task edits are disabled.</span>
        <span *ngIf="!orgPaused && teamPaused">This team is paused — board moves and task edits are disabled.</span>
        <a mat-stroked-button [routerLink]="['/agent-studio', 'teams', teamId]">Team settings</a>
      </div>

      <header class="header">
        <div class="title-block">
          <a mat-icon-button [routerLink]="['/agent-studio', 'teams', teamId]" matTooltip="Back to team">
            <mat-icon>arrow_back</mat-icon>
          </a>
          <div>
            <h2>{{ board.name }}</h2>
            <p class="muted">Agent management Kanban · drag cards · review lane before delivery</p>
          </div>
        </div>
        <div class="header-actions">
          <button mat-stroked-button (click)="showForm = !showForm" [disabled]="pauseBlocked">
            <mat-icon>add</mat-icon>
            New task
          </button>
          <button mat-stroked-button (click)="refresh()">
            <mat-icon>refresh</mat-icon>
            Refresh
          </button>
        </div>
      </header>

      <mat-card class="toolbar">
        <mat-card-content>
          <div class="toolbar-row">
            <mat-form-field appearance="outline" class="tb-field">
              <mat-label>Swimlanes</mat-label>
              <mat-select
                [ngModel]="boardSettings.swimlaneMode"
                (ngModelChange)="onSwimlaneModeChange($event)"
                [disabled]="pauseBlocked"
              >
                <mat-option value="none">None</mat-option>
                <mat-option value="agent">By agent</mat-option>
                <mat-option value="priority">By priority</mat-option>
                <mat-option value="type">By type</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="tb-field">
              <mat-label>Board review policy</mat-label>
              <mat-select
                [ngModel]="boardSettings.reviewPolicy.defaultMode"
                (ngModelChange)="onBoardReviewModeChange($event)"
                [disabled]="pauseBlocked"
              >
                <mat-option value="HUMAN">Human review</mat-option>
                <mat-option value="AGENT">Agent review</mat-option>
                <mat-option value="MIXED">Mixed (per gate)</mat-option>
                <mat-option value="AUTO_APPROVED">Auto-approved</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-slide-toggle
              [ngModel]="boardSettings.reviewPolicy.autoCreateGatesOnEnterReview"
              (ngModelChange)="onAutoCreateGatesChange($event)"
              [disabled]="pauseBlocked"
            >
              Auto-create gates in Review column
            </mat-slide-toggle>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card *ngIf="showForm" class="create-card">
        <mat-card-title>New task</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Title</mat-label>
            <input matInput [(ngModel)]="newTitle" [disabled]="pauseBlocked" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Description</mat-label>
            <textarea matInput rows="2" [(ngModel)]="newDescription" [disabled]="pauseBlocked"></textarea>
          </mat-form-field>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Type</mat-label>
              <mat-select [(ngModel)]="newType" [disabled]="pauseBlocked">
                <mat-option value="STORY">Story</mat-option>
                <mat-option value="BUG">Bug</mat-option>
                <mat-option value="SPIKE">Spike</mat-option>
                <mat-option value="RESEARCH">Research</mat-option>
                <mat-option value="SPEC">Spec</mat-option>
                <mat-option value="REVIEW">Review</mat-option>
                <mat-option value="CHORE">Chore</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Priority</mat-label>
              <mat-select [(ngModel)]="newPriority" [disabled]="pauseBlocked">
                <mat-option value="LOW">Low</mat-option>
                <mat-option value="MEDIUM">Medium</mat-option>
                <mat-option value="HIGH">High</mat-option>
                <mat-option value="CRITICAL">Critical</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Column</mat-label>
              <mat-select [(ngModel)]="newColumnKey" [disabled]="pauseBlocked">
                <mat-option *ngFor="let c of board.columns" [value]="c.key">{{ c.label }}</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Assigned agent</mat-label>
              <mat-select [(ngModel)]="newAgentId" [disabled]="pauseBlocked">
                <mat-option [value]="null">— Unassigned —</mat-option>
                <mat-option *ngFor="let a of agents" [value]="a.id">{{ a.name }}</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-button (click)="showForm = false">Cancel</button>
          <button
            mat-flat-button
            color="primary"
            [disabled]="!newTitle.trim() || creating || pauseBlocked"
            (click)="createTask()"
          >
            {{ creating ? 'Creating…' : 'Create task' }}
          </button>
        </mat-card-actions>
      </mat-card>

      <div class="workspace" [class.drawer-open]="selectedTask">
        <div class="board-scroll">
          <div class="board" [class.has-swimlanes]="boardSettings.swimlaneMode !== 'none'">
            <div
              class="column"
              *ngFor="let col of board.columns"
              [class.col-review]="isReviewCol(col.key)"
              [class.col-terminal]="isTerminalCol(col.key)"
            >
              <header class="col-head">
                <span class="col-label">{{ col.label }}</span>
                <mat-chip *ngIf="isReviewCol(col.key)" class="chip-review-lane">Review lane</mat-chip>
                <mat-chip *ngIf="isTerminalCol(col.key)" class="chip-terminal">Delivery</mat-chip>
                <mat-chip>{{ columnTaskCount(col.key) }}</mat-chip>
              </header>

              <ng-container *ngFor="let lane of swimlanes">
                <div class="lane" *ngIf="boardSettings.swimlaneMode !== 'none'">
                  <div class="lane-label">{{ lane.label }}</div>
                </div>

                <div
                  class="col-body"
                  cdkDropList
                  [id]="listId(col.key, lane.key)"
                  [cdkDropListData]="cellTasks(col.key, lane.key)"
                  [cdkDropListConnectedTo]="connectedListIds"
                  [cdkDropListDisabled]="pauseBlocked"
                  (cdkDropListDropped)="onDrop($event)"
                >
                  <div
                    class="task-card"
                    *ngFor="let task of cellTasks(col.key, lane.key); trackBy: trackTask"
                    cdkDrag
                    [cdkDragDisabled]="pauseBlocked"
                    (click)="openTask(task)"
                  >
                    <div class="task-card-placeholder" *cdkDragPlaceholder></div>
                    <div class="task-top">
                      <span class="task-title">{{ task.title }}</span>
                      <mat-chip
                        *ngIf="approvalBadge(task) as badge"
                        [class]="'badge-' + badge"
                        [matTooltip]="badgeTooltip(task, badge)"
                      >
                        {{ badgeLabel(badge) }}
                      </mat-chip>
                    </div>
                    <div class="task-meta">
                      <mat-chip [class]="'pri-' + task.priority.toLowerCase()">{{ task.priority }}</mat-chip>
                      <mat-chip>{{ task.task_type }}</mat-chip>
                      <mat-chip *ngIf="task.status === 'BLOCKED'" color="warn" selected>blocked</mat-chip>
                    </div>
                    <div class="task-assignee muted" *ngIf="agentName(task.assigned_agent_id) as an">
                      <mat-icon>smart_toy</mat-icon> {{ an }}
                    </div>
                    <div class="task-assignee muted" *ngIf="!task.assigned_agent_id">
                      <mat-icon>person_off</mat-icon> Unassigned
                    </div>
                    <p class="task-desc muted" *ngIf="task.description">{{ task.description }}</p>
                    <div class="task-gates muted" *ngIf="pendingGateCount(gatesFor(task))">
                      {{ pendingGateCount(gatesFor(task)) }} gate(s) pending
                    </div>
                  </div>

                  <div *ngIf="!cellTasks(col.key, lane.key).length" class="empty">Drop tasks here</div>
                </div>
              </ng-container>
            </div>
          </div>
        </div>

        <aside class="drawer" *ngIf="selectedTask as t">
          <header class="drawer-head">
            <h3>{{ t.title }}</h3>
            <button mat-icon-button (click)="closeDrawer()" aria-label="Close">
              <mat-icon>close</mat-icon>
            </button>
          </header>

          <div class="drawer-body">
            <mat-form-field appearance="outline" class="full">
              <mat-label>Description</mat-label>
              <textarea matInput rows="4" [(ngModel)]="drawerDescription" [disabled]="pauseBlocked"></textarea>
            </mat-form-field>

            <div class="drawer-row">
              <mat-form-field appearance="outline">
                <mat-label>Column</mat-label>
                <mat-select [value]="t.column_key" (selectionChange)="moveTaskFromDrawer(t, $event.value)" [disabled]="pauseBlocked">
                  <mat-option *ngFor="let c of board.columns" [value]="c.key">{{ c.label }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Status</mat-label>
                <mat-select [(ngModel)]="drawerStatus" (selectionChange)="patchTask(t, { status: drawerStatus })" [disabled]="pauseBlocked">
                  <mat-option value="PLANNED">Planned</mat-option>
                  <mat-option value="IN_PROGRESS">In progress</mat-option>
                  <mat-option value="BLOCKED">Blocked</mat-option>
                  <mat-option value="REVIEW">Review</mat-option>
                  <mat-option value="DONE">Done</mat-option>
                  <mat-option value="CANCELLED">Cancelled</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <div class="drawer-row">
              <mat-form-field appearance="outline">
                <mat-label>Assigned agent</mat-label>
                <mat-select
                  [value]="t.assigned_agent_id"
                  (selectionChange)="assignAgent(t, $event.value)"
                  [disabled]="pauseBlocked"
                >
                  <mat-option [value]="null">— Unassigned —</mat-option>
                  <mat-option *ngFor="let a of agents" [value]="a.id">{{ a.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Task review override</mat-label>
                <mat-select
                  [ngModel]="taskReviewOverride(t)"
                  (ngModelChange)="setTaskReviewMode(t, $event)"
                  [disabled]="pauseBlocked"
                >
                  <mat-option value="">Use board default ({{ boardSettings.reviewPolicy.defaultMode }})</mat-option>
                  <mat-option value="HUMAN">Human review</mat-option>
                  <mat-option value="AGENT">Agent review</mat-option>
                  <mat-option value="MIXED">Mixed</mat-option>
                  <mat-option value="AUTO_APPROVED">Auto-approved</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <button mat-stroked-button class="full-btn" (click)="saveDrawerDescription(t)" [disabled]="pauseBlocked">
              Save description
            </button>

            <mat-divider></mat-divider>

            <h4 class="section-title">
              <mat-icon>fact_check</mat-icon>
              Review gates
              <mat-chip [class]="'badge-' + approvalBadge(t)">{{ badgeLabel(approvalBadge(t)) }}</mat-chip>
            </h4>
            <p class="muted small">
              Effective mode: <strong>{{ effectiveMode(t) }}</strong>.
              Delivery columns require all blocking gates approved or skipped.
            </p>

            <ul class="gate-list" *ngIf="gatesFor(t).length; else noGates">
              <li *ngFor="let g of gatesFor(t)" class="gate-row">
                <div class="gate-main">
                  <strong>{{ g.gate_type }}</strong>
                  <mat-chip [class]="'gate-' + g.status.toLowerCase()">{{ g.status }}</mat-chip>
                  <span class="muted small" *ngIf="gateReviewerLabel(g)">{{ gateReviewerLabel(g) }}</span>
                </div>
                <div class="gate-actions" *ngIf="g.status === 'PENDING' || g.status === 'CHANGES_REQUESTED'">
                  <button mat-button color="primary" (click)="decideGate(g, 'APPROVED')" [disabled]="pauseBlocked">
                    Approve
                  </button>
                  <button
                    mat-button
                    (click)="decideGate(g, 'APPROVED', 'Agent-approved')"
                    [disabled]="pauseBlocked"
                    *ngIf="canAgentApprove(t, g)"
                  >
                    Agent approve
                  </button>
                  <button mat-button (click)="decideGate(g, 'CHANGES_REQUESTED')" [disabled]="pauseBlocked">
                    Changes
                  </button>
                  <button mat-button color="warn" (click)="decideGate(g, 'REJECTED')" [disabled]="pauseBlocked">
                    Reject
                  </button>
                  <button mat-button (click)="decideGate(g, 'SKIPPED')" [disabled]="pauseBlocked">Skip</button>
                </div>
              </li>
            </ul>
            <ng-template #noGates>
              <p class="muted">No review gates yet.</p>
            </ng-template>

            <div class="gate-add" *ngIf="!pauseBlocked">
              <mat-form-field appearance="outline">
                <mat-label>Add gate</mat-label>
                <mat-select [(ngModel)]="newGateType">
                  <mat-option value="SPEC_REVIEW">Spec review</mat-option>
                  <mat-option value="CODE_REVIEW">Code review</mat-option>
                  <mat-option value="SECURITY_REVIEW">Security review</mat-option>
                  <mat-option value="QA_REVIEW">QA review</mat-option>
                  <mat-option value="RELEASE_APPROVAL">Release approval</mat-option>
                  <mat-option value="CUSTOM">Custom</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" *ngIf="boardSettings.reviewPolicy.defaultMode === 'MIXED'">
                <mat-label>Reviewer</mat-label>
                <mat-select [(ngModel)]="newGateReviewer">
                  <mat-option value="human">Human</mat-option>
                  <mat-option value="agent">Agent</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-stroked-button (click)="addGate(t)">Add gate</button>
            </div>

            <mat-divider></mat-divider>

            <button mat-stroked-button color="warn" class="full-btn" (click)="deleteTask(t)" [disabled]="pauseBlocked">
              <mat-icon>delete</mat-icon>
              Delete task
            </button>
          </div>
        </aside>
      </div>
    </section>

    <ng-template #loadingTpl>
      <p class="muted load-msg">Loading board…</p>
    </ng-template>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-height: 0;
      }
      .pause-banner {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 16px;
        background: #fffbeb;
        border: 1px solid #fcd34d;
        border-radius: 8px;
        color: #92400e;
        font-size: 14px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        flex-wrap: wrap;
      }
      .title-block {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .title-block h2 {
        margin: 0;
        font-size: 1.35rem;
      }
      .header-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .toolbar {
        background: #fff;
        border: 1px solid #e2e8f0;
      }
      .toolbar-row {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: center;
      }
      .tb-field {
        min-width: 180px;
      }
      .full {
        width: 100%;
      }
      .row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
      }
      .create-card {
        background: #fff;
      }
      .workspace {
        display: flex;
        gap: 0;
        min-height: 480px;
        align-items: stretch;
      }
      .workspace.drawer-open .board-scroll {
        flex: 1;
        min-width: 0;
      }
      .board-scroll {
        overflow-x: auto;
        overflow-y: auto;
        flex: 1;
        padding-bottom: 12px;
      }
      .board {
        display: flex;
        gap: 14px;
        min-height: 420px;
        align-items: flex-start;
      }
      .column {
        flex: 0 0 272px;
        background: #f1f5f9;
        border-radius: 12px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        border: 1px solid #e2e8f0;
      }
      .column.col-review {
        background: #eff6ff;
        border-color: #93c5fd;
        box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.15);
      }
      .column.col-terminal {
        background: #f0fdf4;
        border-color: #86efac;
      }
      .col-head {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        font-weight: 600;
        font-size: 13px;
        padding: 4px 4px 8px;
      }
      .col-label {
        flex: 1;
        min-width: 60px;
      }
      .chip-review-lane {
        --mdc-chip-label-text-color: #1e40af;
        font-size: 11px;
        min-height: 24px;
      }
      .chip-terminal {
        --mdc-chip-label-text-color: #166534;
        font-size: 11px;
        min-height: 24px;
      }
      .lane-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
        padding: 4px 6px 2px;
      }
      .col-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 72px;
        padding: 4px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.45);
      }
      .col-body.cdk-drop-list-dragging {
        background: rgba(59, 130, 246, 0.08);
      }
      .task-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 12px;
        cursor: grab;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
        transition: box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .task-card:hover {
        border-color: #93c5fd;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.12);
      }
      .task-card.cdk-drag-preview {
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      }
      .task-card-placeholder {
        min-height: 80px;
        border: 2px dashed #cbd5e1;
        border-radius: 10px;
        background: #f8fafc;
      }
      .task-top {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: flex-start;
        margin-bottom: 6px;
      }
      .task-title {
        font-weight: 600;
        font-size: 14px;
        line-height: 1.3;
        flex: 1;
      }
      .task-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 6px;
      }
      .task-meta mat-chip {
        font-size: 11px;
        min-height: 22px;
      }
      .task-assignee {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        margin-bottom: 4px;
      }
      .task-assignee mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .task-desc {
        font-size: 12px;
        margin: 4px 0 0;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .task-gates {
        font-size: 11px;
        margin-top: 4px;
      }
      .badge-pending {
        background: #fef3c7 !important;
        color: #92400e !important;
      }
      .badge-changes {
        background: #ffedd5 !important;
        color: #9a3412 !important;
      }
      .badge-rejected {
        background: #fee2e2 !important;
        color: #991b1b !important;
      }
      .badge-approved {
        background: #dcfce7 !important;
        color: #166534 !important;
      }
      .badge-auto {
        background: #e0e7ff !important;
        color: #3730a3 !important;
      }
      .badge-none {
        background: #f1f5f9 !important;
        color: #64748b !important;
      }
      .empty {
        color: #94a3b8;
        font-size: 12px;
        font-style: italic;
        padding: 12px 8px;
        text-align: center;
      }
      .drawer {
        width: 380px;
        flex-shrink: 0;
        background: #fff;
        border-left: 1px solid #e2e8f0;
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 200px);
        position: sticky;
        top: 0;
        align-self: flex-start;
        box-shadow: -4px 0 24px rgba(15, 23, 42, 0.06);
      }
      .drawer-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 16px 16px 8px;
        border-bottom: 1px solid #e2e8f0;
      }
      .drawer-head h3 {
        margin: 0;
        font-size: 1.1rem;
        line-height: 1.35;
      }
      .drawer-body {
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .drawer-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .full-btn {
        width: 100%;
      }
      .section-title {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 15px;
      }
      .gate-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .gate-row {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px;
        background: #f8fafc;
      }
      .gate-main {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin-bottom: 6px;
      }
      .gate-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .gate-pending {
        background: #fef3c7 !important;
      }
      .gate-approved {
        background: #dcfce7 !important;
      }
      .gate-rejected {
        background: #fee2e2 !important;
      }
      .gate-skipped {
        background: #f1f5f9 !important;
      }
      .gate-add {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .pri-low {
        background: #e3f2fd;
      }
      .pri-medium {
        background: #fff8e1;
      }
      .pri-high {
        background: #ffe0b2;
      }
      .pri-critical {
        background: #ffcdd2;
      }
      .muted {
        color: #64748b;
      }
      .small {
        font-size: 12px;
      }
      .load-msg {
        padding: 24px;
      }
    `,
  ],
})
export class TeamBoardComponent implements OnInit {
  board: KanbanBoard | null = null;
  boardSettings: BoardSettings = {
    ...DEFAULT_BOARD_SETTINGS,
    reviewPolicy: {
      ...DEFAULT_BOARD_SETTINGS.reviewPolicy,
      defaultGateTypes: [...DEFAULT_BOARD_SETTINGS.reviewPolicy.defaultGateTypes],
    },
  };
  tasks: Task[] = [];
  agents: Agent[] = [];
  gatesByTaskId: Record<string, ReviewGate[]> = {};
  swimlanes: Swimlane[] = [{ key: '_all', label: '' }];
  /** columnKey -> laneKey -> tasks */
  cells: Record<string, Record<string, Task[]>> = {};
  connectedListIds: string[] = [];

  orgPaused = false;
  teamPaused = false;

  showForm = false;
  newTitle = '';
  newDescription = '';
  newType: TaskType = 'STORY';
  newPriority: TaskPriority = 'MEDIUM';
  newColumnKey = 'backlog';
  newAgentId: string | null = null;
  creating = false;

  selectedTask: Task | null = null;
  drawerDescription = '';
  drawerStatus: Task['status'] = 'PLANNED';
  newGateType: ReviewGateType = 'CODE_REVIEW';
  newGateReviewer: 'human' | 'agent' = 'human';

  teamId!: string;

  constructor(
    private route: ActivatedRoute,
    private studio: AgentStudioService,
    private snack: MatSnackBar
  ) {}

  get pauseBlocked(): boolean {
    return this.orgPaused || this.teamPaused;
  }

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    rememberBoardTeam(this.teamId);
    this.refresh();
    this.studio.listAgents(this.teamId).subscribe({ next: (r) => (this.agents = r.agents) });
  }

  refresh(): void {
    this.studio.getBoard(this.teamId).subscribe({
      next: (r) => {
        this.board = r.board;
        this.tasks = r.tasks;
        this.gatesByTaskId = r.reviewGatesByTaskId ?? {};
        this.orgPaused = r.pause?.orgPaused ?? false;
        this.teamPaused = r.pause?.teamPaused ?? false;
        this.boardSettings = parseBoardSettings(r.board.settings);
        if (this.board.columns.length && !this.board.columns.some((c) => c.key === this.newColumnKey)) {
          this.newColumnKey = this.board.columns[0].key;
        }
        this.rebuildGrid();
        if (this.selectedTask) {
          const updated = this.tasks.find((t) => t.id === this.selectedTask!.id);
          if (updated) {
            this.openTask(updated);
          } else {
            this.closeDrawer();
          }
        }
      },
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load board', 'OK', { duration: 4000 }),
    });
  }

  rebuildGrid(): void {
    this.swimlanes = buildSwimlanes(this.boardSettings.swimlaneMode, this.tasks, this.agents);
    this.cells = {};
    this.connectedListIds = [];
    if (!this.board) return;
    for (const col of this.board.columns) {
      this.cells[col.key] = {};
      for (const lane of this.swimlanes) {
        this.cells[col.key][lane.key] = [];
        this.connectedListIds.push(this.listId(col.key, lane.key));
      }
    }
    for (const t of this.tasks) {
      const lane = swimlaneKeyForTask(this.boardSettings.swimlaneMode, t);
      if (!this.cells[t.column_key]) {
        this.cells[t.column_key] = {};
      }
      if (!this.cells[t.column_key][lane]) {
        this.cells[t.column_key][lane] = [];
      }
      this.cells[t.column_key][lane].push(t);
    }
    for (const colKey of Object.keys(this.cells)) {
      for (const laneKey of Object.keys(this.cells[colKey])) {
        this.cells[colKey][laneKey].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
      }
    }
  }

  listId(colKey: string, laneKey: string): string {
    return dropListId(colKey, laneKey);
  }

  cellTasks(colKey: string, laneKey: string): Task[] {
    return this.cells[colKey]?.[laneKey] ?? [];
  }

  columnTaskCount(colKey: string): number {
    let n = 0;
    const lanes = this.cells[colKey];
    if (!lanes) return 0;
    for (const k of Object.keys(lanes)) {
      n += lanes[k].length;
    }
    return n;
  }

  isReviewCol = isReviewColumn;
  isTerminalCol = isTerminalColumn;

  trackTask(_i: number, t: Task): string {
    return t.id;
  }

  gatesFor(task: Task): ReviewGate[] {
    return this.gatesByTaskId[task.id] ?? [];
  }

  agentName(agentId: string | null): string | null {
    if (!agentId) return null;
    return this.agents.find((a) => a.id === agentId)?.name ?? null;
  }

  effectiveMode(task: Task): ReviewMode {
    return resolveEffectiveReviewMode(this.boardSettings, task);
  }

  approvalBadge(task: Task): TaskApprovalBadge {
    return taskApprovalBadge(this.gatesFor(task), this.effectiveMode(task));
  }

  badgeLabel(badge: TaskApprovalBadge): string {
    const map: Record<TaskApprovalBadge, string> = {
      none: 'No gates',
      pending: 'Review pending',
      changes: 'Changes requested',
      rejected: 'Rejected',
      approved: 'Approved',
      auto: 'Auto-approved',
    };
    return map[badge] ?? badge;
  }

  badgeTooltip(task: Task, badge: TaskApprovalBadge): string {
    const n = pendingGateCount(this.gatesFor(task));
    if (badge === 'pending') return `${n} gate(s) awaiting decision`;
    if (badge === 'auto') return 'Board/task policy auto-approves gates on delivery';
    return this.badgeLabel(badge);
  }

  pendingGateCount = pendingGateCount;

  onSwimlaneModeChange(mode: SwimlaneMode): void {
    this.boardSettings = { ...this.boardSettings, swimlaneMode: mode };
    this.persistBoardSettings();
    this.rebuildGrid();
  }

  onBoardReviewModeChange(mode: ReviewMode): void {
    this.boardSettings = {
      ...this.boardSettings,
      reviewPolicy: { ...this.boardSettings.reviewPolicy, defaultMode: mode },
    };
    this.persistBoardSettings();
  }

  onAutoCreateGatesChange(v: boolean): void {
    this.boardSettings = {
      ...this.boardSettings,
      reviewPolicy: { ...this.boardSettings.reviewPolicy, autoCreateGatesOnEnterReview: v },
    };
    this.persistBoardSettings();
  }

  persistBoardSettings(): void {
    if (!this.board || this.pauseBlocked) return;
    this.studio.updateBoard(this.board.id, { settings: this.boardSettings }).subscribe({
      error: (err) => {
        if (err?.status === 423) {
          this.snack.open('Cannot save — pause is active.', 'OK', { duration: 4000 });
        } else {
          this.snack.open(err?.error?.error || 'Failed to save board settings', 'OK', { duration: 4000 });
        }
      },
    });
  }

  onDrop(event: CdkDragDrop<Task[]>): void {
    if (this.pauseBlocked || !this.board) return;
    const from = parseDropListId(event.previousContainer.id);
    const to = parseDropListId(event.container.id);
    if (!from || !to) return;

    const prevCol = from.columnKey;
    const nextCol = to.columnKey;
    const task = event.previousContainer.data[event.previousIndex];
    if (!task) return;

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
    }

    const position = event.currentIndex;
    this.applyMove(task, prevCol, nextCol, position);
  }

  applyMove(task: Task, prevCol: string, nextCol: string, position: number): void {
    const prevColumn = task.column_key;
    task.column_key = nextCol;
    task.position = position;

    this.studio.updateTask(task.id, { columnKey: nextCol, position }).subscribe({
      next: (r) => {
        Object.assign(task, r.task);
        if (prevColumn !== nextCol && isReviewColumn(nextCol)) {
          this.maybeAutoCreateGates(task);
        }
        this.syncTasksArray();
        this.rebuildGrid();
      },
      error: (err) => this.handleMoveError(err, task, prevCol),
    });
  }

  handleMoveError(err: { status?: number; error?: { error?: string; message?: string; pendingGates?: unknown[] } }, task: Task, revertCol: string): void {
    task.column_key = revertCol;
    this.refresh();
    if (err?.status === 423) {
      this.snack.open('Cannot move — pause is active.', 'OK', { duration: 5000 });
      return;
    }
    if (err?.status === 409 && err?.error?.error === 'REVIEW_GATE_BLOCKED') {
      this.snack.open(
        err.error.message || 'Pending review gates block delivery. Open the task to approve or skip.',
        'OK',
        { duration: 7000 }
      );
      return;
    }
    this.snack.open(err?.error?.error || 'Move failed', 'OK', { duration: 4000 });
  }

  maybeAutoCreateGates(task: Task): void {
    if (!this.boardSettings.reviewPolicy.autoCreateGatesOnEnterReview) return;
    const existing = this.gatesFor(task);
    const types = this.boardSettings.reviewPolicy.defaultGateTypes;
    const mode = this.effectiveMode(task);
    for (const gateType of types) {
      if (existing.some((g) => g.gate_type === gateType)) continue;
      const reviewerType =
        mode === 'MIXED' ? 'human' : mode === 'AGENT' ? 'agent' : 'human';
      this.studio
        .createReviewGate(task.id, gateType, undefined, { reviewerType })
        .subscribe({
          next: (r) => {
            this.gatesByTaskId[task.id] = [...(this.gatesByTaskId[task.id] ?? []), r.gate];
          },
        });
    }
  }

  syncTasksArray(): void {
    const flat: Task[] = [];
    if (!this.board) return;
    for (const col of this.board.columns) {
      for (const lane of this.swimlanes) {
        for (const t of this.cellTasks(col.key, lane.key)) {
          flat.push(t);
        }
      }
    }
    this.tasks = flat;
  }

  openTask(task: Task): void {
    this.selectedTask = task;
    this.drawerDescription = task.description ?? '';
    this.drawerStatus = task.status;
  }

  closeDrawer(): void {
    this.selectedTask = null;
  }

  moveTaskFromDrawer(task: Task, columnKey: string): void {
    if (task.column_key === columnKey) return;
    const prevCol = task.column_key;
    this.studio.updateTask(task.id, { columnKey }).subscribe({
      next: (r) => {
        Object.assign(task, r.task);
        if (isReviewColumn(columnKey)) {
          this.maybeAutoCreateGates(task);
        }
        this.refresh();
      },
      error: (err) => this.handleMoveError(err, task, prevCol),
    });
  }

  patchTask(task: Task, body: Partial<Task>): void {
    this.studio.updateTask(task.id, body).subscribe({
      next: (r) => {
        Object.assign(task, r.task);
        this.snack.open('Task updated.', 'OK', { duration: 2000 });
      },
      error: (err) => {
        if (err?.status === 423) {
          this.snack.open('Cannot update — pause is active.', 'OK', { duration: 4000 });
        } else {
          this.snack.open(err?.error?.error || 'Update failed', 'OK', { duration: 4000 });
        }
      },
    });
  }

  saveDrawerDescription(task: Task): void {
    this.patchTask(task, { description: this.drawerDescription.trim() || null });
  }

  assignAgent(task: Task, agentId: string | null): void {
    this.studio.updateTask(task.id, { assignedAgentId: agentId }).subscribe({
      next: (r) => {
        Object.assign(task, r.task);
        this.rebuildGrid();
        this.snack.open('Assignment updated.', 'OK', { duration: 2000 });
      },
      error: (err) => {
        if (err?.status === 423) {
          this.snack.open('Cannot assign — pause is active.', 'OK', { duration: 4000 });
        } else {
          this.snack.open(err?.error?.error || 'Assign failed', 'OK', { duration: 4000 });
        }
      },
    });
  }

  taskReviewOverride(task: Task): string {
    const v = task.metadata?.['reviewMode'];
    return typeof v === 'string' ? v : '';
  }

  setTaskReviewMode(task: Task, mode: string): void {
    const metadata = { ...(task.metadata ?? {}) };
    if (!mode) {
      delete metadata['reviewMode'];
    } else {
      metadata['reviewMode'] = mode;
    }
    this.studio.updateTask(task.id, { metadata }).subscribe({
      next: (r) => {
        Object.assign(task, r.task);
        this.snack.open('Review mode override saved.', 'OK', { duration: 2500 });
      },
      error: (err) => {
        this.snack.open(err?.error?.error || 'Failed to save review mode', 'OK', { duration: 4000 });
      },
    });
  }

  gateReviewerLabel(g: ReviewGate): string {
    const t = g.metadata?.['reviewerType'];
    if (t === 'agent') return 'Agent reviewer';
    if (t === 'human') return 'Human reviewer';
    return '';
  }

  canAgentApprove(task: Task, gate: ReviewGate): boolean {
    const mode = this.effectiveMode(task);
    if (mode === 'HUMAN' || mode === 'AUTO_APPROVED') return false;
    if (mode === 'AGENT') return true;
    return gate.metadata?.['reviewerType'] === 'agent';
  }

  decideGate(gate: ReviewGate, status: ReviewGateStatus, comment?: string): void {
    this.studio.decideReviewGate(gate.id, status, comment).subscribe({
      next: (r) => {
        const list = this.gatesByTaskId[r.gate.task_id] ?? [];
        const idx = list.findIndex((g) => g.id === gate.id);
        if (idx >= 0) {
          list[idx] = r.gate;
        } else {
          list.push(r.gate);
        }
        this.gatesByTaskId[r.gate.task_id] = [...list];
        this.snack.open(`Gate ${status.toLowerCase().replace('_', ' ')}.`, 'OK', { duration: 2500 });
      },
      error: (err) => this.snack.open(err?.error?.error || 'Decision failed', 'OK', { duration: 4000 }),
    });
  }

  addGate(task: Task): void {
    const metadata: Record<string, unknown> = {};
    if (this.boardSettings.reviewPolicy.defaultMode === 'MIXED') {
      metadata['reviewerType'] = this.newGateReviewer;
    } else if (this.effectiveMode(task) === 'AGENT') {
      metadata['reviewerType'] = 'agent';
    }
    this.studio.createReviewGate(task.id, this.newGateType, undefined, metadata).subscribe({
      next: (r) => {
        this.gatesByTaskId[task.id] = [...(this.gatesByTaskId[task.id] ?? []), r.gate];
        this.snack.open('Review gate added.', 'OK', { duration: 2500 });
      },
      error: (err) => this.snack.open(err?.error?.error || 'Failed to add gate', 'OK', { duration: 4000 }),
    });
  }

  createTask(): void {
    if (!this.newTitle.trim() || this.pauseBlocked) return;
    this.creating = true;
    this.studio
      .createTask(this.teamId, {
        title: this.newTitle.trim(),
        description: this.newDescription.trim() || undefined,
        columnKey: this.newColumnKey,
        taskType: this.newType,
        priority: this.newPriority,
        assignedAgentId: this.newAgentId ?? undefined,
      })
      .subscribe({
        next: () => {
          this.creating = false;
          this.showForm = false;
          this.newTitle = '';
          this.newDescription = '';
          this.snack.open('Task created.', 'OK', { duration: 2500 });
          this.refresh();
        },
        error: (err) => {
          this.creating = false;
          if (err?.status === 423) {
            this.snack.open('Cannot create — pause is active.', 'OK', { duration: 4000 });
          } else {
            this.snack.open(err?.error?.error || 'Create failed', 'OK', { duration: 4000 });
          }
        },
      });
  }

  deleteTask(task: Task): void {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    this.studio.deleteTask(task.id).subscribe({
      next: () => {
        this.closeDrawer();
        this.snack.open('Task deleted.', 'OK', { duration: 2500 });
        this.refresh();
      },
      error: (err) => this.snack.open(err?.error?.error || 'Delete failed', 'OK', { duration: 4000 }),
    });
  }
}
