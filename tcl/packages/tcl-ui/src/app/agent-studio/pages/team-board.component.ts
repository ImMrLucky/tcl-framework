import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import {
  Agent,
  KanbanBoard,
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
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="page" *ngIf="board; else loadingTpl">
      <header class="header">
        <h2>{{ board.name }}</h2>
        <button mat-flat-button color="primary" (click)="showForm = !showForm">
          <mat-icon>add</mat-icon>
          New task
        </button>
      </header>

      <mat-card *ngIf="showForm" class="create-card">
        <mat-card-title>New task</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Title</mat-label>
            <input matInput [(ngModel)]="newTitle" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Description</mat-label>
            <textarea matInput rows="2" [(ngModel)]="newDescription"></textarea>
          </mat-form-field>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Type</mat-label>
              <mat-select [(ngModel)]="newType">
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
              <mat-select [(ngModel)]="newPriority">
                <mat-option value="LOW">Low</mat-option>
                <mat-option value="MEDIUM">Medium</mat-option>
                <mat-option value="HIGH">High</mat-option>
                <mat-option value="CRITICAL">Critical</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Column</mat-label>
              <mat-select [(ngModel)]="newColumnKey">
                <mat-option *ngFor="let c of board.columns" [value]="c.key">{{ c.label }}</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Assigned agent</mat-label>
              <mat-select [(ngModel)]="newAgentId">
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
            [disabled]="!newTitle.trim() || creating"
            (click)="createTask()"
          >
            {{ creating ? 'Creating…' : 'Create task' }}
          </button>
        </mat-card-actions>
      </mat-card>

      <div class="board">
        <div class="column" *ngFor="let col of board.columns">
          <header class="col-head">
            <span>{{ col.label }}</span>
            <mat-chip>{{ groupedTasks[col.key]?.length || 0 }}</mat-chip>
          </header>

          <div class="col-body">
            <mat-card class="task" *ngFor="let task of groupedTasks[col.key] || []">
              <mat-card-title>{{ task.title }}</mat-card-title>
              <mat-card-subtitle>
                <mat-chip [class]="'pri-' + task.priority.toLowerCase()">{{ task.priority }}</mat-chip>
                <mat-chip>{{ task.task_type }}</mat-chip>
              </mat-card-subtitle>
              <mat-card-content *ngIf="task.description">
                <p class="muted">{{ task.description }}</p>
              </mat-card-content>
              <mat-card-actions>
                <mat-form-field appearance="outline" class="move-field">
                  <mat-label>Move to</mat-label>
                  <mat-select [value]="task.column_key" (selectionChange)="moveTask(task, $event.value)">
                    <mat-option *ngFor="let c of board.columns" [value]="c.key">{{ c.label }}</mat-option>
                  </mat-select>
                </mat-form-field>
              </mat-card-actions>
            </mat-card>

            <div *ngIf="!groupedTasks[col.key]?.length" class="empty">No tasks</div>
          </div>
        </div>
      </div>
    </section>

    <ng-template #loadingTpl>
      <p class="muted" style="padding: 24px;">Loading board…</p>
    </ng-template>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .header { display: flex; justify-content: space-between; align-items: center; }
      .full { width: 100%; }
      .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
      .create-card { background: #fff; }
      .board {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 280px;
        gap: 16px;
        overflow-x: auto;
        padding-bottom: 8px;
      }
      .column { background: #f0f1f6; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
      .col-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
      .col-body { display: flex; flex-direction: column; gap: 8px; min-height: 80px; }
      .task { background: #fff; }
      .move-field { width: 100%; margin-top: 8px; }
      .muted { color: #666; }
      .empty { color: #999; font-style: italic; padding: 8px 4px; }
      .pri-low    { background: #e3f2fd; }
      .pri-medium { background: #fff8e1; }
      .pri-high   { background: #ffe0b2; }
      .pri-critical { background: #ffcdd2; }
    `,
  ],
})
export class TeamBoardComponent implements OnInit {
  board: KanbanBoard | null = null;
  tasks: Task[] = [];
  agents: Agent[] = [];
  groupedTasks: Record<string, Task[]> = {};

  showForm = false;
  newTitle = '';
  newDescription = '';
  newType: TaskType = 'STORY';
  newPriority: TaskPriority = 'MEDIUM';
  newColumnKey = 'backlog';
  newAgentId: string | null = null;
  creating = false;

  private teamId!: string;

  constructor(private route: ActivatedRoute, private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
    this.studio.listAgents(this.teamId).subscribe({ next: (r) => (this.agents = r.agents) });
  }

  refresh(): void {
    this.studio.getBoard(this.teamId).subscribe({
      next: (r) => {
        this.board = r.board;
        this.tasks = r.tasks;
        this.regroup();
        if (this.board.columns.length && !this.board.columns.some((c) => c.key === this.newColumnKey)) {
          this.newColumnKey = this.board.columns[0].key;
        }
      },
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load board', 'OK', { duration: 4000 }),
    });
  }

  regroup(): void {
    this.groupedTasks = {};
    for (const t of this.tasks) {
      (this.groupedTasks[t.column_key] = this.groupedTasks[t.column_key] || []).push(t);
    }
  }

  createTask(): void {
    if (!this.newTitle.trim()) return;
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

  moveTask(task: Task, columnKey: string): void {
    if (task.column_key === columnKey) return;
    this.studio.updateTask(task.id, { columnKey: columnKey as any }).subscribe({
      next: () => this.refresh(),
      error: (err) => {
        if (err?.status === 423) {
          this.snack.open('Cannot move — pause is active.', 'OK', { duration: 4000 });
        } else {
          this.snack.open(err?.error?.error || 'Move failed', 'OK', { duration: 4000 });
        }
        this.refresh();
      },
    });
  }
}
